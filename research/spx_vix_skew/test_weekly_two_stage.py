"""Tests for the weekly two-stage strategy, on a fake market. The main event: no peeking.

Run: python -m pytest research/spx_vix_skew -q
"""
import numpy as np
import pandas as pd
import pytest

from spx_adaptive_strategy import AdaptiveSPXStrategy, Config, synthetic_market_data
from weekly_two_stage import WeeklyConfig, bet_size, daily_returns, run_weekly, walk_forward, \
    weekly_frame, weekly_positions

DAILY = dict(warmup_days=300, refit_every=63, hmm_window=750, hmm_inits=1, hmm_iter=50,
             kalman_window=500, garch_window=750)
WEEKLY = dict(min_train_weeks=60, min_meta_weeks=25, retrain_every=4, max_iter=60)


@pytest.fixture(scope="module")
def data():
    return synthetic_market_data("2000-01-03", "2008-12-31", seed=5)


@pytest.fixture(scope="module")
def results(data):
    return AdaptiveSPXStrategy(Config(**DAILY)).process(data, verbose=False)


@pytest.fixture(scope="module")
def weekly(results, data):
    return run_weekly(results, data, WeeklyConfig(**WEEKLY), plot=False, verbose=False)


def test_one_row_per_week_on_its_last_trading_day(results, data):
    W = weekly_frame(results, data, 4)
    assert W.index.to_period("W-FRI").is_unique
    daily_weeks = results.index.to_period("W-FRI")
    last_days = pd.Series(results.index, index=daily_weeks).groupby(level=0).max()
    assert (W.index == last_days.loc[W.index.to_period("W-FRI")].to_numpy()).all()


def test_no_look_ahead(results, data):
    # Cut the history mid-week. Every finished week before the cut must come out identical.
    cut = results.index[int(len(results) * 0.8)]
    while cut.dayofweek != 2:
        cut = results.index[results.index.get_loc(cut) + 1]
    cfg = WeeklyConfig(**WEEKLY)
    full = walk_forward(weekly_frame(results, data, cfg.trend_horizon), cfg, verbose=False)
    short = walk_forward(weekly_frame(results.loc[:cut], data.loc[:cut], cfg.trend_horizon),
                         cfg, verbose=False)
    common = short.index[:-1]  # the last short week is unfinished, so it's a different day
    for col in ["p_trend", "p_meta", "side", "trend_hit_rate"]:
        np.testing.assert_allclose(full.loc[common, col].to_numpy(), short.loc[common, col].to_numpy(),
                                   rtol=1e-12, atol=1e-12, err_msg=col)
    for mode in ["two_stage", "trend_only"]:
        np.testing.assert_allclose(weekly_positions(full, cfg, mode).loc[common].to_numpy(),
                                   weekly_positions(short, cfg, mode).loc[common].to_numpy(),
                                   rtol=1e-12, atol=1e-12)


def test_positions_are_held_for_the_week(weekly, results):
    out, daily = weekly["weekly"], weekly["daily"]["Two-stage (trend + meta)"]
    pos = out["pos_two_stage"].dropna()
    # The position on any day equals the latest Friday decision at or before it.
    expected = pos.reindex(daily.index, method="ffill")
    np.testing.assert_allclose(daily["position"], expected)
    # And P&L is that position times the next day's return, minus costs on decision days.
    gross = daily["position"] * results.loc[daily.index, "next_ret"]
    assert ((gross - daily["strategy_ret"]) >= -1e-15).all()


def test_costs_only_on_decision_days(results):
    idx = results.index[:30]
    fridays = idx[idx.dayofweek == 4]
    pos = pd.Series([1.0, 0.0, 1.0, 1.0][:len(fridays)], index=fridays[:4])
    df = daily_returns(results.loc[idx], pos, cost_bps=10)
    net_cost = df["position"] * df["next_ret"] - df["strategy_ret"]
    charged = net_cost[net_cost.abs() > 1e-15].index
    assert set(charged) <= set(fridays)


def test_bet_size_is_monotone_and_bounded():
    ps = np.linspace(0.0, 1.0, 101)
    s = np.array([bet_size(p) for p in ps])
    assert (s[ps <= 0.5] == 0).all()
    assert (np.diff(s) >= 0).all()
    assert 0 <= s.min() and s.max() <= 1


def test_sizing_modes_and_band(results, data):
    base = WeeklyConfig(**WEEKLY)
    out = walk_forward(weekly_frame(results, data, base.trend_horizon), base, verbose=False)
    for sizing in ["binary", "linear", "lopez"]:
        cfg = WeeklyConfig(**WEEKLY, sizing=sizing)
        pos = weekly_positions(out, cfg).dropna()
        assert pos.abs().max() <= cfg.max_leverage + 1e-12
    # The band suppresses small trades: every change is either big or to/from zero.
    cfg = WeeklyConfig(**WEEKLY, rebalance_band=0.2)
    pos = weekly_positions(out, cfg, "long").dropna()
    changes = pos.diff().dropna()
    moved = changes[changes != 0]
    assert ((moved.abs() >= 0.2 - 1e-12) | (pos.loc[moved.index] == 0)).all()
    with pytest.raises(ValueError):
        weekly_positions(out, WeeklyConfig(**WEEKLY, sizing="yolo"))


def test_report_has_all_variants(weekly):
    assert list(weekly["metrics"].columns) == ["Two-stage (trend + meta)", "Trend model alone",
                                               "Weekly vol-managed long", "Buy & hold SPX"]
    d = weekly["diagnostics"]
    assert 0 <= d["Stage 1 AUC (trend, OOS)"] <= 1
    assert weekly["decision"]["target_exposure"] >= 0
