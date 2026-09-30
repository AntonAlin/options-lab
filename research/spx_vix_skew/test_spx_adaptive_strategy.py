"""Tests on a fake market: no network, and above all no peeking at tomorrow.

Run: python -m pytest research/spx_vix_skew -q
"""
import numpy as np
import pandas as pd
import pytest

from spx_adaptive_strategy import AdaptiveSPXStrategy, Config, build_features, summarize, \
    synthetic_market_data

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
