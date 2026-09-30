"""
Weekly two-stage SPX strategy: one model finds the trend, a second one decides whether to trade it.

This is meta-labeling (Lopez de Prado, Advances in Financial Machine Learning, ch. 3):

    Stage 1, trend model    Gradient-boosted trees predict whether SPX is higher in
                            `trend_horizon` weeks. Its call sets the side: long, or out
                            (or short, if you allow it).
    Stage 2, trading model  A second gradient-boosted model is trained on one question only:
                            "when the trend model says go, is it right this time?" Its inputs
                            are the market state plus the trend model's own probability and its
                            recent hit rate, so it literally learns the trend model's mistakes.
                            Its probability sets the bet size.

Trades happen once a week, at the close of the week's last trading day, and the position is held
until the next one. Both models are retrained walk-forward every `retrain_every` weeks on
everything whose outcome is already known (labels are purged so no training row peeks past the
decision date), with recent weeks weighted more.

Inputs come from the daily strategy in spx_adaptive_strategy.py: its causal features (VIX, SKEW,
momentum...) and its expert outputs (HMM regime probabilities, Kalman trend, GARCH vol...), sampled
on each week's last day. Run the daily backtest first, then:

    weekly = run_weekly(results, data)
    weekly["metrics"]          # two-stage vs trend model alone vs vol-managed long vs buy & hold
    weekly["diagnostics"]      # out-of-sample AUCs, and whether the vetoes were any good

Not investment advice.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict

import numpy as np
import pandas as pd
from scipy.stats import norm

from spx_adaptive_strategy import EXPERTS, FEATURE_COLS, REGIMES, build_features, performance


@dataclass
class WeeklyConfig:
    trend_horizon: int = 4              # weeks ahead the trend model tries to call
    min_train_weeks: int = 156          # three years of labelled weeks before stage 1 may speak
    min_meta_weeks: int = 104           # two years of stage-1 calls before stage 2 may judge them
    retrain_every: int = 4              # weeks between retrains
    decay_halflife: float | None = 260  # weeks; recent history counts more. None = all equal
    hit_window: int = 13                # weeks of the trend model's track record fed to stage 2
    seed: int = 7

    max_depth: int = 3
    learning_rate: float = 0.05
    max_iter: int = 150
    min_samples_leaf: int = 40
    l2_regularization: float = 1.0
    max_bins: int = 32                  # coarse bins: faster, and weekly data has no 255-level detail

    entry_threshold: float = 0.5        # stage 1 says long above this
    # Enter at threshold + h, leave at threshold - h: a probability dithering around 0.5
    # shouldn't flip the position every Friday.
    hysteresis: float = 0.03
    meta_threshold: float = 0.5         # stage 2 must be at least this sure, or no trade
    # binary: full size once approved; linear: ramps up to full at full_size_at;
    # lopez: 2*N(z)-1, Lopez de Prado's sizing, which is very timid on a single index.
    sizing: str = "binary"
    full_size_at: float = 0.65
    allow_short: bool = False           # short when stage 1 < 1 - entry_threshold
    min_exposure: float = 0.0           # floor when not trading; 0 = go to cash
    rebalance_band: float = 0.10        # skip trades smaller than this

    vol_target: float = 0.15
    max_leverage: float = 1.5
    cost_bps: float = 2.0


# --------------------------------------------------------------------------------------------
# Weekly data: one row per week, taken on the week's last trading day
# --------------------------------------------------------------------------------------------

TREND_COLS = FEATURE_COLS + [f"sig_{n}" for n in EXPERTS] + [f"p_{k}" for k in REGIMES] + \
    ["garch_vol", "ret_1w", "ret_4w", "ret_13w", "vol_4w"]
META_EXTRA = ["p_trend", "p_trend_chg", "trend_hit_rate"]


def weekly_frame(results: pd.DataFrame, data: pd.DataFrame, horizon: int) -> pd.DataFrame:
    """Sample the daily strategy's outputs on each week's last trading day.

    Everything in a row is known at that day's close. The two fwd_ columns are the future and
    exist only as labels; the walk-forward loop only reads them once they have happened.
    """
    daily = results.join(build_features(data)[FEATURE_COLS], how="left")
    # A holiday Friday just makes Thursday the last day of the week. Calendars are hard.
    week = daily.index.to_period("W-FRI")
    W = daily.groupby(week).tail(1).copy()
    W["week_complete"] = W.index.dayofweek == 4
    W.loc[W.index[:-1], "week_complete"] = True    # only the latest week can be unfinished
    logc = np.log(W["close"])
    W["ret_1w"] = logc.diff(1)
    W["ret_4w"] = logc.diff(4)
    W["ret_13w"] = logc.diff(13)
    W["vol_4w"] = W["ret_1w"].rolling(4).std() * math.sqrt(52)
    W["fwd_1w"] = W["close"].shift(-1) / W["close"] - 1
    W["fwd_trend"] = W["close"].shift(-horizon) / W["close"] - 1
    return W


# --------------------------------------------------------------------------------------------
# The two models and the bet size
# --------------------------------------------------------------------------------------------

def _model(cfg: WeeklyConfig):
    from sklearn.ensemble import HistGradientBoostingClassifier

    # Shallow trees, small steps, fat leaves: markets punish clever models with deep pockets.
    return HistGradientBoostingClassifier(
        max_depth=cfg.max_depth, learning_rate=cfg.learning_rate, max_iter=cfg.max_iter,
        min_samples_leaf=cfg.min_samples_leaf, l2_regularization=cfg.l2_regularization,
        max_bins=cfg.max_bins, early_stopping=False, random_state=cfg.seed)


def _fit(cfg: WeeklyConfig, X: np.ndarray, y: np.ndarray, age: np.ndarray):
    if len(np.unique(y)) < 2:
        return None  # a model that has only ever seen up-weeks has nothing to teach anyone
    w = None if cfg.decay_halflife is None else 0.5 ** (age / cfg.decay_halflife)
    return _model(cfg).fit(X, y, sample_weight=w)


def bet_size(p: float) -> float:
    """Lopez de Prado's sizing: how many standard errors p sits above a coin flip, squashed."""
    if not math.isfinite(p) or p <= 0.5:
        return 0.0
    if p >= 1.0:
        return 1.0
    z = (p - 0.5) / math.sqrt(p * (1 - p))
    return float(2 * norm.cdf(z) - 1)


# --------------------------------------------------------------------------------------------
# Walk-forward: every week, retrain on what is already known, then call and size the trade
# --------------------------------------------------------------------------------------------

def walk_forward(W: pd.DataFrame, cfg: WeeklyConfig, verbose: bool = True) -> pd.DataFrame:
    import importlib

    from threadpoolctl import threadpool_limits

    importlib.import_module("sklearn.ensemble")

    # A few thousand rows is too small to share between threads: they spend more time arguing
    # about who goes next than working (up to 4 s per fit instead of 0.07 s on a busy machine).
    # The import above matters: threadpoolctl can only limit an OpenMP runtime already loaded.
    with threadpool_limits(1):
        return _walk_forward(W, cfg, verbose)


def _walk_forward(W: pd.DataFrame, cfg: WeeklyConfig, verbose: bool) -> pd.DataFrame:
    n, H = len(W), cfg.trend_horizon
    X1 = W[TREND_COLS].to_numpy(dtype=float)
    fwd1 = W["fwd_1w"].to_numpy(dtype=float)
    fwdH = W["fwd_trend"].to_numpy(dtype=float)
    y1 = (fwdH > 0).astype(int)

    p1 = np.full(n, np.nan)
    p2 = np.full(n, np.nan)
    side = np.zeros(n)
    hit = np.full(n, np.nan)
    X2 = np.full((n, X1.shape[1] + len(META_EXTRA)), np.nan)
    m1 = m2 = None
    last_fit = -10 ** 9
    fits = 0

    for t in range(n):
        if t - last_fit >= cfg.retrain_every:
            # Stage 1 rows: the H-week outcome must be over by today (j + H <= t). Purged.
            rows1 = np.arange(0, max(t - H + 1, 0))
            if len(rows1) >= cfg.min_train_weeks:
                fitted = _fit(cfg, X1[rows1], y1[rows1], t - rows1)
                m1 = fitted if fitted is not None else m1
                last_fit, fits = t, fits + 1
            # Stage 2 rows: weeks where stage 1 made a real out-of-sample call and the following
            # week is over (j + 1 <= t). This is where the trend model's mistakes become lessons.
            rows2 = np.array([j for j in range(t) if side[j] != 0 and np.isfinite(fwd1[j])],
                             dtype=int)
            if len(rows2) >= cfg.min_meta_weeks:
                y2 = (side[rows2] * fwd1[rows2] > 0).astype(int)
                fitted = _fit(cfg, X2[rows2], y2, t - rows2)
                m2 = fitted if fitted is not None else m2

        if m1 is None:
            continue
        p1[t] = m1.predict_proba(X1[t:t + 1])[0, 1]
        was = side[t - 1] if t > 0 else 0
        up, h = cfg.entry_threshold, cfg.hysteresis
        if p1[t] > up + h or (was == 1 and p1[t] > up - h):
            side[t] = 1
        elif cfg.allow_short and (p1[t] < 1 - up - h or (was == -1 and p1[t] < 1 - up + h)):
            side[t] = -1

        # The trend model's recent report card, from weeks whose result is already in.
        past = [j for j in range(max(0, t - cfg.hit_window), t)
                if np.isfinite(p1[j]) and np.isfinite(fwd1[j])]
        if past:
            calls = np.sign(np.array([p1[j] - 0.5 for j in past]))
            hit[t] = float(np.mean(calls == np.sign(fwd1[past])))
        prev = p1[t - 1] if t > 0 and np.isfinite(p1[t - 1]) else p1[t]
        X2[t] = np.concatenate([X1[t], [p1[t], p1[t] - prev, hit[t]]])
        if m2 is not None and side[t] != 0:
            p2[t] = m2.predict_proba(X2[t:t + 1])[0, 1]

        if verbose and t % 250 == 0:
            print(f"  week {t}/{n}  {W.index[t].date()}  P(trend up) {p1[t]:.2f}")

    out = W[["close", "garch_vol", "week_complete", "fwd_1w", "fwd_trend"]].copy()
    out["p_trend"], out["p_meta"], out["side"], out["trend_hit_rate"] = p1, p2, side, hit
    out["meta_ready"] = False
    first_meta = np.flatnonzero(np.isfinite(p2))
    if len(first_meta):
        out.iloc[first_meta[0]:, out.columns.get_loc("meta_ready")] = True
    out.attrs["fits"] = fits
    return out


def _direction(out: pd.DataFrame, cfg: WeeklyConfig, mode: str) -> pd.Series:
    """Direction before vol scaling. mode: two_stage, trend_only or long."""
    if mode == "long":
        return pd.Series(1.0, index=out.index)
    side = out["side"]
    if mode == "trend_only":
        size = side.abs()
    else:
        p = out["p_meta"].fillna(0.0)
        if cfg.sizing == "binary":
            size = pd.Series(1.0, index=out.index)
        elif cfg.sizing == "linear":
            span = max(cfg.full_size_at - cfg.meta_threshold, 1e-9)
            size = ((p - cfg.meta_threshold) / span).clip(0.0, 1.0)
        elif cfg.sizing == "lopez":
            # Built for many small simultaneous bets. On one index it sizes p = 0.55 at 8 %.
            size = p.map(bet_size)
        else:
            raise ValueError(f"Unknown sizing '{cfg.sizing}'")
        size = size.where(p >= cfg.meta_threshold, 0.0)
    floor = cfg.min_exposure
    d = np.where(side > 0, floor + (1 - floor) * size,
                 np.where(side < 0, -size, floor))
    return pd.Series(d, index=out.index)


def weekly_positions(out: pd.DataFrame, cfg: WeeklyConfig, mode: str = "two_stage") -> pd.Series:
    scale = np.minimum(cfg.vol_target / out["garch_vol"], cfg.max_leverage)
    target = (_direction(out, cfg, mode) * scale).clip(-cfg.max_leverage, cfg.max_leverage)
    target = target.where(out["meta_ready"])
    held, pos = 0.0, np.full(len(target), np.nan)
    for k, x in enumerate(target.to_numpy()):
        if not np.isfinite(x):
            continue
        # Going to or from zero always trades: "almost in cash" is not a position, it's a mood.
        if abs(x - held) >= cfg.rebalance_band or (x == 0) != (held == 0):
            held = x
        pos[k] = held
    return pd.Series(pos, index=target.index)


def daily_returns(results: pd.DataFrame, weekly_pos: pd.Series, cost_bps: float) -> pd.DataFrame:
    """Hold each Friday's position through the following week, day by day, with costs."""
    live = weekly_pos.dropna()
    if live.empty:
        return pd.DataFrame(columns=["position", "strategy_ret"])
    idx = results.index[results.index >= live.index[0]]
    pos = live.reindex(idx).ffill()
    trades = live.diff().abs().fillna(live.abs())
    cost = (trades * cost_bps / 1e4).reindex(idx).fillna(0.0)
    df = pd.DataFrame({"position": pos, "next_ret": results.loc[idx, "next_ret"]})
    df["strategy_ret"] = df["position"] * df["next_ret"] - cost
    return df.dropna(subset=["next_ret"])


# --------------------------------------------------------------------------------------------
# Report card
# --------------------------------------------------------------------------------------------

def _auc(y: np.ndarray, p: np.ndarray) -> float:
    from sklearn.metrics import roc_auc_score

    ok = np.isfinite(p) & np.isfinite(y)
    if ok.sum() < 20 or len(np.unique(y[ok])) < 2:
        return np.nan
    return float(roc_auc_score(y[ok], p[ok]))


def diagnostics(out: pd.DataFrame, cfg: WeeklyConfig) -> pd.Series:
    """Out-of-sample only. AUC 0.5 is a coin; above ~0.55 on weekly markets is already good."""
    o = out[out["meta_ready"]]
    y_trend = (o["fwd_trend"] > 0).astype(float).where(o["fwd_trend"].notna())
    longs = o[o["side"] != 0].dropna(subset=["fwd_1w"])
    y_meta = (longs["side"] * longs["fwd_1w"] > 0).astype(float)
    taken = longs["p_meta"] >= cfg.meta_threshold
    return pd.Series({
        "Weeks traded (meta ready)": len(o),
        "Stage 1 AUC (trend, OOS)": _auc(y_trend.to_numpy(), o["p_trend"].to_numpy()),
        "Stage 1 hit rate": float(((o["p_trend"] > 0.5) == (o["fwd_trend"] > 0))
                                  [o["fwd_trend"].notna()].mean()),
        "Share of weeks stage 1 says go": float((o["side"] != 0).mean()),
        "Stage 2 AUC (is the call right?, OOS)": _auc(y_meta.to_numpy(), longs["p_meta"].to_numpy()),
        "Share of go-calls stage 2 vetoes": float((~taken).mean()) if len(longs) else np.nan,
        "Avg next-week return, approved": float((longs["side"] * longs["fwd_1w"])[taken].mean()),
        "Avg next-week return, vetoed": float((longs["side"] * longs["fwd_1w"])[~taken].mean()),
        "Retrains": out.attrs.get("fits", np.nan),
    })


def run_weekly(results: pd.DataFrame, data: pd.DataFrame, cfg: WeeklyConfig | None = None,
               plot: bool = True, verbose: bool = True) -> dict:
    cfg = cfg or WeeklyConfig()
    W = weekly_frame(results, data, cfg.trend_horizon)
    if verbose:
        print(f"{len(W)} weeks. Training walk-forward, retrain every {cfg.retrain_every} weeks...")
    out = walk_forward(W, cfg, verbose=verbose)
    if not out["meta_ready"].any():
        raise ValueError("Not enough history for both models. Lower min_train_weeks/min_meta_weeks.")

    variants = {"Two-stage (trend + meta)": "two_stage",
                "Trend model alone": "trend_only",
                "Weekly vol-managed long": "long"}
    daily = {}
    for label, mode in variants.items():
        pos = weekly_positions(out, cfg, mode)
        out[f"pos_{mode}"] = pos
        daily[label] = daily_returns(results, pos, cfg.cost_bps)
    start = daily["Two-stage (trend + meta)"].index
    daily["Buy & hold SPX"] = pd.DataFrame({"strategy_ret": results.loc[start, "next_ret"],
                                            "position": 1.0})
    metrics = pd.DataFrame({k: performance(v["strategy_ret"], v["position"] if k != "Buy & hold SPX"
                                           else None) for k, v in daily.items()})
    diag = diagnostics(out, cfg)
    last = out.iloc[-1]
    decision = {
        "as_of": out.index[-1].date().isoformat(),
        "week_complete": bool(last["week_complete"]),
        "p_trend_up": round(float(last["p_trend"]), 3),
        "p_trend_call_right": None if not np.isfinite(last["p_meta"]) else round(float(last["p_meta"]), 3),
        "target_exposure": round(float(last["pos_two_stage"]), 3) + 0.0,
        "config": asdict(cfg),
    }
    if verbose:
        with pd.option_context("display.float_format", "{:,.3f}".format):
            print(metrics)
            print(diag)
        flag = "" if decision["week_complete"] else "  (week not finished: trade on its last day)"
        print(f"Latest decision {decision['as_of']}: exposure {decision['target_exposure']:+.2f}{flag}")
    fig = plot_weekly(out, daily) if plot else None
    return {"weekly": out, "daily": daily, "metrics": metrics, "diagnostics": diag,
            "decision": decision, "figure": fig}


def plot_weekly(out: pd.DataFrame, daily: dict):
    import matplotlib.pyplot as plt

    colors = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]
    ink2, grid, surface = "#52514e", "#e4e3df", "#fcfcfb"
    legend_style = {"frameon": True, "facecolor": surface, "edgecolor": "none", "framealpha": 0.9}
    fig, ax = plt.subplots(3, 1, figsize=(13, 10), sharex=True,
                           gridspec_kw={"height_ratios": [3, 1.2, 1.2]})
    for a in ax:
        a.set_facecolor(surface)
        a.grid(True, color=grid, lw=0.6)
        a.set_axisbelow(True)
        a.spines[["top", "right"]].set_visible(False)
    for (label, df), col in zip(daily.items(), colors):
        eq = (1 + df["strategy_ret"]).cumprod()
        ax[0].plot(eq.index, eq, color=col, lw=2 if label.startswith("Two") else 1.4, label=label)
    ax[0].set_yscale("log")
    ax[0].set_title("Growth of 1 (log scale), weekly trading", loc="left", fontweight="bold")
    ax[0].legend(loc="upper left", **legend_style)

    live = out[out["meta_ready"]]
    ax[1].plot(live.index, live["p_trend"], color=colors[0], lw=1.2, label="Stage 1: P(trend up)")
    ax[1].plot(live.index, live["p_meta"], color=colors[1], lw=1.2,
               label="Stage 2: P(the call is right)")
    ax[1].axhline(0.5, color=ink2, lw=0.8, ls=":")
    ax[1].set_ylim(0, 1)
    ax[1].set_title("What the two models think", loc="left", fontweight="bold")
    ax[1].legend(loc="upper left", ncol=2, **legend_style)

    ax[2].step(live.index, live["pos_two_stage"], where="post", color=colors[0], lw=1.2)
    ax[2].set_title("Two-stage exposure, set each Friday", loc="left", fontweight="bold")
    fig.tight_layout()
    return fig
