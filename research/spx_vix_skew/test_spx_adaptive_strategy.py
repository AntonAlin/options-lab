"""Tests on a fake market: no network, and above all no peeking at tomorrow.

Run: python -m pytest research/spx_vix_skew -q
"""
import numpy as np
import pandas as pd
import pytest

from spx_adaptive_strategy import AdaptiveSPXStrategy, Config, build_features, deflated_sharpe, \
    expert_report, optimize_allocation, replay_allocation, summarize, synthetic_market_data

# Small windows so the suite finishes before anyone's patience does.
FAST = dict(warmup_days=400, refit_every=63, hmm_window=750, hmm_inits=1, hmm_iter=50,
            kalman_window=500, garch_window=750)


@pytest.fixture(scope="module")
def data():
    return synthetic_market_data("2000-01-03", "2006-12-29", seed=3)


@pytest.fixture(scope="module")
def full_run(data):
    return AdaptiveSPXStrategy(Config(**FAST)).process(data, verbose=False)


def test_features_are_causal(data):
    full = build_features(data)
    cut = build_features(data.iloc[:1000])
    pd.testing.assert_frame_equal(full.iloc[:1000], cut)


def test_decisions_never_use_future_data(data, full_run):
    # If yesterday's position changes when tomorrow's data shows up, something is cheating.
    short = AdaptiveSPXStrategy(Config(**FAST)).process(data.iloc[:1300], verbose=False)
    common = short.index
    cols = ["position", "signal", "garch_vol", "p_up"] + [c for c in short if c.startswith("w_")]
    np.testing.assert_allclose(full_run.loc[common, cols].to_numpy(), short[cols].to_numpy(),
                               rtol=1e-9, atol=1e-12)


def test_resume_from_pickle_matches_one_run(data, full_run, tmp_path):
    s = AdaptiveSPXStrategy(Config(**FAST))
    s.process(data.iloc[:1300], verbose=False)
    s.save(tmp_path / "state.pkl")
    resumed = AdaptiveSPXStrategy.load(tmp_path / "state.pkl").process(data, verbose=False)
    cols = ["position", "strategy_ret", "signal"]
    pd.testing.assert_frame_equal(resumed[cols], full_run[cols])


def test_weights_and_positions_are_sane(full_run):
    w = full_run[[c for c in full_run if c.startswith("w_")]]
    np.testing.assert_allclose(w.sum(axis=1), 1.0, atol=1e-9)
    assert (w > 0).all().all()
    cfg = Config(**FAST)
    assert full_run["position"].between(-cfg.max_short - 1e-12, cfg.max_leverage + 1e-12).all()
    assert full_run[[c for c in full_run if c.startswith("sig_")]].abs().le(1).all().all()


def test_pnl_is_yesterdays_position_times_todays_return(full_run):
    r = full_run.dropna(subset=["strategy_ret"])
    expected = r["position"] * r["next_ret"] - r["cost"]
    np.testing.assert_allclose(r["strategy_ret"], expected, atol=1e-15)
    # And next_ret really is the following day's close-to-close return.
    nxt = full_run["close"].shift(-1) / full_run["close"] - 1
    np.testing.assert_allclose(r["next_ret"], nxt.loc[r.index], rtol=1e-6, atol=1e-14)


def test_summary_has_both_columns(full_run):
    m = summarize(full_run)
    assert list(m.columns) == ["Strategy", "Buy & hold SPX"]
    assert np.isfinite(m.loc["Sharpe (rf=0)", "Strategy"])


def test_replay_reproduces_the_live_allocation(full_run):
    # The optimiser is only honest if replaying the signals gives exactly what the loop did.
    rep = replay_allocation(full_run, Config(**FAST))
    cols = ["position", "signal", "cost", "strategy_ret"] + [c for c in rep if c.startswith("w_")]
    np.testing.assert_allclose(rep[cols].to_numpy(), full_run[cols].to_numpy(dtype=float),
                               rtol=1e-9, atol=1e-12)


def test_new_allocation_matches_a_full_rerun(data):
    knobs = dict(base_exposure=0.5, signal_scale=2.5, smooth_halflife=0.0, hedge_eta=0.3,
                 rebalance_band=0.05, max_short=0.25)
    rerun = AdaptiveSPXStrategy(Config(**FAST, **knobs)).process(data.iloc[:1500], verbose=False)
    s = AdaptiveSPXStrategy(Config(**FAST))
    s.process(data.iloc[:1500], verbose=False)
    s.set_allocation(**knobs)
    cols = ["position", "strategy_ret", "signal"]
    np.testing.assert_allclose(s.results()[cols].to_numpy(dtype=float),
                               rerun[cols].to_numpy(dtype=float), rtol=1e-9, atol=1e-12)
    # ...and tomorrow carries on from the replayed state, not the old one.
    s.process(data, verbose=False)
    full = AdaptiveSPXStrategy(Config(**FAST, **knobs)).process(data, verbose=False)
    np.testing.assert_allclose(s.results()["position"], full["position"], rtol=1e-9, atol=1e-12)


def test_set_allocation_refuses_model_knobs(data):
    s = AdaptiveSPXStrategy(Config(**FAST))
    s.process(data.iloc[:1200], verbose=False)
    with pytest.raises(ValueError):
        s.set_allocation(hmm_states=4)


def test_optimizer_chooses_on_design_only(full_run):
    out = optimize_allocation(full_run, Config(**FAST), n_trials=15, verbose=False)
    t = out["table"]
    assert t["design Sharpe (rf=0)"].is_monotonic_decreasing
    assert 0.0 <= out["deflated_sharpe"] <= 1.0
    # Shuffle the holdout returns: the chosen setting must not change.
    shuffled = full_run.copy()
    after = shuffled.index > out["split"]
    hold = shuffled.loc[after, "next_ret"]
    shuffled.loc[after, "next_ret"] = hold.sample(frac=1, random_state=1).to_numpy()
    again = optimize_allocation(shuffled, Config(**FAST), n_trials=15, verbose=False)
    assert again["best_knobs"] == out["best_knobs"]


def test_expert_report_has_baselines(full_run):
    rep = expert_report(full_run, Config(**FAST))
    labels = {i[0] for i in rep.index}
    assert {"Buy & hold SPX", "Vol-managed only (no experts)", "Ensemble (current knobs)",
            "Only hmm"} <= labels


def test_deflated_sharpe_punishes_many_trials():
    rng = np.random.default_rng(0)
    r = pd.Series(rng.normal(0.0004, 0.01, 2000))
    few = deflated_sharpe(r, rng.normal(0, 0.01, 2))
    many = deflated_sharpe(r, rng.normal(0, 0.01, 500))
    assert many < few


def test_notebook_is_built_from_the_current_script():
    # If this fails, someone edited the .py and forgot: python build_notebook.py
    nbformat = pytest.importorskip("nbformat")
    from pathlib import Path
    import build_notebook

    committed = nbformat.read(Path(__file__).with_name("spx_adaptive_strategy.ipynb"), as_version=4)
    fresh = build_notebook.build()
    assert [c.source for c in committed.cells] == [c.source for c in fresh.cells]
