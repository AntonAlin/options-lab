"""
SPX adaptive regime strategy: S&P 500 traded on its own trend plus what VIX and SKEW say.

Everything is downloaded from Yahoo Finance with yfinance (^GSPC, ^VIX, ^SKEW) and run day by
day, walk-forward, so a decision at the close of day t only uses data up to and including day t
and earns the return from t to t+1.

Five "experts" each give a signal in [-1, 1]:

    hmm        Gaussian hidden Markov model on (return, log VIX): filtered regime probabilities
               -> expected risk-adjusted return tomorrow. Forward filter only, never smoothed.
    kalman     Local linear trend model on log SPX, parameters by maximum likelihood,
               state updated with a Kalman filter every day -> annualised trend Sharpe.
    vol_skew   Options-market view: variance risk premium (VIX^2 - realised variance),
               fading VIX spikes, and SKEW that is high while VIX is low (quiet crash hedging).
    logit      Online logistic regression (SGD) on all features, predicting the sign of the
               next `label_horizon` days. Trained every day as labels mature; wrong calls on
               big moves get extra weight.
    momentum   Volatility-scaled time-series momentum (3 and 12 months) and the 200-day gap.

How it learns from its mistakes:

    1. Hedge / exponentiated-gradient weights with fixed share: every day each expert is paid
       signal * return / forecast vol; weights move toward the experts that were right, and the
       fixed share keeps a floor so a demoted expert can come back when the regime changes.
    2. The logistic model is updated online with every matured label, misclassifications on
       large moves count up to (1 + mistake_boost) times.
    3. A Page-Hinkley detector watches the logistic model's log-loss; when it jumps (the world
       changed), the HMM, Kalman and GARCH models are refitted at once and the ensemble weights
       are pulled halfway back to uniform.
    4. Scheduled refits of HMM, Kalman and GJR-GARCH every `refit_every` days on rolling windows.

Position = clip(base_exposure + signal_scale * ensemble signal, -max_short, max_direction)
           * vol_target / GJR-GARCH vol, capped at max_leverage, smoothed, with a no-trade band
           and transaction costs. The experts tilt a default long position (base_exposure = 1)
           rather than having to vote the strategy into the market.

The allocation layer is separate from the models, so `optimize_allocation` can replay hundreds of
allocation settings on the stored signals in seconds, choose on a design period and report the
untouched holdout, with a deflated Sharpe ratio for the number of trials.

Usage (Colab / Fabric notebook):
    !pip install yfinance hmmlearn arch scikit-learn statsmodels scipy matplotlib
    from spx_adaptive_strategy import run_backtest, live_signal
    results, metrics, strat = run_backtest(save_state="spx_state.pkl")
    live_signal("spx_state.pkl")          # next day: ingest new data, learn, print target exposure

Command line:
    python spx_adaptive_strategy.py backtest --out out --save-state out/state.pkl
    python spx_adaptive_strategy.py live --state out/state.pkl
    python spx_adaptive_strategy.py backtest --synthetic    # offline, fake market, for testing

Not investment advice. The backtest trades the price index (no dividends, cash earns nothing),
which is conservative for both the strategy and buy-and-hold.
"""
from __future__ import annotations

import argparse
import logging
import math
import pickle
import warnings
from dataclasses import dataclass, asdict, replace
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize

TICKERS = {"spx": "^GSPC", "vix": "^VIX", "skew": "^SKEW"}
EXPERTS = ["hmm", "kalman", "vol_skew", "logit", "momentum"]
REGIMES = ["calm", "normal", "stress"]
FEATURE_COLS = [
    "rv_ratio", "vix_z", "vix_chg5", "vix_rv", "vrp_z", "skew_z", "skew_chg5", "skew_vix",
    "mom21", "mom63", "mom252", "ma_gap", "drawdown",
]
TRADING_DAYS = 252


@dataclass
class Config:
    start: str = "1990-01-02"
    end: str | None = None
    warmup_days: int = 1260            # five years of watching before we're allowed to touch money
    refit_every: int = 63              # quarterly refits, like a very dull board meeting
    seed: int = 7

    hmm_states: int = 3
    hmm_window: int = 2520
    hmm_inits: int = 3
    hmm_iter: int = 100

    kalman_window: int = 1260
    garch_window: int = 2520

    label_horizon: int = 5
    sgd_eta0: float = 0.01
    sgd_alpha: float = 1e-4
    pretrain_epochs: int = 3
    mistake_boost: float = 2.0
    logit_gain: float = 6.0

    hedge_eta: float = 0.10
    fixed_share: float = 0.01

    drift_delta: float = 0.005
    drift_lambda: float = 10.0
    drift_cooldown: int = 63

    # Allocation: direction = clip(base_exposure + signal_scale * ensemble, -max_short, max_direction)
    # The experts tilt a default long position instead of having to argue the model into the
    # market every morning. Set base_exposure=0 for pure market timing, if you like suffering.
    base_exposure: float = 1.0
    signal_scale: float = 1.5
    max_direction: float = 1.0
    vol_target: float = 0.15
    max_leverage: float = 1.5
    max_short: float = 0.0             # SPX drifts up; shorting it is a hobby, not a strategy
    smooth_halflife: float = 2.0       # days; an EMA on the target so noise doesn't become turnover
    rebalance_band: float = 0.10
    cost_bps: float = 2.0


# The knobs the allocator reads. Changing only these never requires refitting a single model,
# which is what makes optimize_allocation() fast.
ALLOCATION_FIELDS = ("hedge_eta", "fixed_share", "base_exposure", "signal_scale", "max_direction",
                     "vol_target", "max_leverage", "max_short", "smooth_halflife",
                     "rebalance_band", "cost_bps")


# --------------------------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------------------------

def load_market_data(start: str = "1990-01-02", end: str | None = None) -> pd.DataFrame:
    """Daily closes of SPX, VIX and SKEW from Yahoo, cleaned and aligned on SPX trading days."""
    import yfinance as yf

    raw = yf.download(list(TICKERS.values()), start=start, end=end, auto_adjust=False,
                      progress=False, group_by="column")
    if raw is None or raw.empty:
        raise RuntimeError("yfinance returned nothing. Yahoo is either down or sulking.")
    close = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw
    df = close.rename(columns={v: k for k, v in TICKERS.items()})
    missing = [k for k in TICKERS if k not in df.columns]
    if missing:
        raise RuntimeError(f"Missing series from Yahoo: {missing}")
    df = df[list(TICKERS)].copy()
    df.index = pd.to_datetime(df.index).tz_localize(None)
    return clean_market_data(df)


def clean_market_data(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_index()
    df = df[~df.index.duplicated(keep="last")]
    df = df[df["spx"].notna() & (df["spx"] > 0)]
    # Yahoo's SKEW history has the occasional value from another planet. Deport them.
    df.loc[(df["skew"] < 90) | (df["skew"] > 200), "skew"] = np.nan
    df.loc[(df["vix"] < 5) | (df["vix"] > 150), "vix"] = np.nan
    # Short gaps get forward-filled (past data only, no peeking); long gaps stay NaN and get dropped.
    df[["vix", "skew"]] = df[["vix", "skew"]].ffill(limit=5)
    return df.dropna()


def synthetic_market_data(start: str = "1990-01-02", end: str = "2026-09-30",
                          seed: int = 0) -> pd.DataFrame:
    """A fake market with three regimes, for testing without a network. Do not trade it."""
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(start, end)
    n = len(idx)
    mu = np.array([0.0006, 0.0002, -0.0012])
    sig = np.array([0.006, 0.011, 0.028])
    trans = np.array([[0.990, 0.009, 0.001],
                      [0.012, 0.978, 0.010],
                      [0.010, 0.040, 0.950]])
    state = np.zeros(n, dtype=int)
    for t in range(1, n):
        state[t] = rng.choice(3, p=trans[state[t - 1]])
    r = mu[state] + sig[state] * rng.standard_t(5, n) / math.sqrt(5 / 3)
    spx = 350 * np.exp(np.cumsum(r))
    log_vix = np.log(sig[state] * math.sqrt(TRADING_DAYS) * 100 * 1.15)
    noise = np.zeros(n)
    for t in range(1, n):
        noise[t] = 0.9 * noise[t - 1] + 0.05 * rng.standard_normal()
    vix = np.exp(log_vix + noise)
    vix = pd.Series(vix).ewm(span=3).mean().to_numpy()
    skew = 118 + 6 * (state == 0) - 3 * (state == 2) + np.cumsum(rng.standard_normal(n)) * 0.2
    skew = 118 + (skew - pd.Series(skew).rolling(250, min_periods=1).mean().to_numpy())
    skew = skew + 4 * rng.standard_normal(n)
    return clean_market_data(pd.DataFrame({"spx": spx, "vix": vix, "skew": skew}, index=idx))


# --------------------------------------------------------------------------------------------
# Features. Every one of them is causal: rolling windows and diffs only look backwards.
# --------------------------------------------------------------------------------------------

def _z(x: pd.Series, n: int) -> pd.Series:
    m = x.rolling(n, min_periods=n // 2).mean()
    s = x.rolling(n, min_periods=n // 2).std()
    return (x - m) / s.replace(0, np.nan)


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    logp = np.log(df["spx"])
    r = logp.diff()
    rv5 = r.rolling(5).std() * math.sqrt(TRADING_DAYS)
    rv21 = r.rolling(21).std() * math.sqrt(TRADING_DAYS)
    rv63 = r.rolling(63).std() * math.sqrt(TRADING_DAYS)
    vix = df["vix"] / 100
    log_vix = np.log(vix)

    f = pd.DataFrame(index=df.index)
    f["logp"] = logp
    f["ret"] = r
    f["log_vix"] = log_vix
    f["rv21"] = rv21
    f["rv_ratio"] = np.log(rv5 / rv63)
    f["vix_z"] = _z(log_vix, TRADING_DAYS)
    f["vix_chg5"] = log_vix.diff(5)
    f["vix_rv"] = np.log(vix / rv21)
    f["vrp_z"] = _z(vix ** 2 - rv21 ** 2, TRADING_DAYS)
    f["skew_z"] = _z(df["skew"], TRADING_DAYS)
    f["skew_chg5"] = df["skew"].pct_change(5)
    # Crash insurance getting pricier while headline fear is asleep. Someone knows something.
    f["skew_vix"] = f["skew_z"] - f["vix_z"]
    for n, rv in ((21, rv21), (63, rv63), (252, rv63)):
        f[f"mom{n}"] = logp.diff(n) / (rv * math.sqrt(n / TRADING_DAYS))
    f["ma_gap"] = (logp - logp.rolling(200).mean()) / (rv63 * math.sqrt(200 / TRADING_DAYS))
    f["drawdown"] = logp - logp.rolling(TRADING_DAYS, min_periods=21).max()
    return f.replace([np.inf, -np.inf], np.nan)


# --------------------------------------------------------------------------------------------
# Model 1: Gaussian HMM regimes, fitted with hmmlearn, filtered forward by hand
# --------------------------------------------------------------------------------------------

class RegimeHMM:
    """Fits with Baum-Welch, but infers with the forward filter only.

    hmmlearn's predict_proba uses forward-backward, which quietly reads the future. Lovely for
    a paper, useless for a trading desk, so the filter below is written out by hand.
    """

    def __init__(self, n_states: int, n_iter: int, n_inits: int, seed: int):
        self.k, self.n_iter, self.n_inits, self.seed = n_states, n_iter, n_inits, seed
        self.fitted = False
        self.alpha = None

    def fit(self, X: np.ndarray) -> bool:
        from hmmlearn.hmm import GaussianHMM

        # hmmlearn narrates every tiny EM wobble through logging. We believe you, EM. Hush.
        logging.getLogger("hmmlearn").setLevel(logging.ERROR)
        m, s = X.mean(0), X.std(0)
        s[s == 0] = 1.0
        Z = (X - m) / s
        best, best_ll = None, -np.inf
        for i in range(self.n_inits):
            model = GaussianHMM(n_components=self.k, covariance_type="full", n_iter=self.n_iter,
                                tol=1e-4, random_state=self.seed + i)
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    model.fit(Z)
                    ll = model.score(Z)
            except (ValueError, np.linalg.LinAlgError):
                continue
            if np.isfinite(ll) and ll > best_ll:
                best, best_ll = model, ll
        if best is None:
            return False  # every init face-planted; keep yesterday's model and pretend nothing happened

        # States come out in random order each fit. Sort by mean VIX: calm, normal, stress.
        order = np.argsort(best.means_[:, 1])
        self.scale_m, self.scale_s = m, s
        self.means = best.means_[order]
        self.covs = best.covars_[order]
        self.trans = best.transmat_[order][:, order]
        self.start = best.startprob_[order]
        self.inv = np.linalg.inv(self.covs)
        self.logdet = np.linalg.slogdet(self.covs)[1]
        # Per-state return moments back in percent units, for the expected-return calculation.
        self.ret_mu = self.means[:, 0] * s[0] + m[0]
        self.ret_var = self.covs[:, 0, 0] * s[0] ** 2
        self.fitted = True

        self.alpha = self.start.copy()
        for x in X:
            self.step(x)
        return True

    def _loglik(self, x: np.ndarray) -> np.ndarray:
        z = (x - self.scale_m) / self.scale_s
        d = z - self.means
        maha = np.einsum("ki,kij,kj->k", d, self.inv, d)
        return -0.5 * (len(z) * math.log(2 * math.pi) + self.logdet + maha)

    def step(self, x: np.ndarray) -> None:
        if not self.fitted or not np.all(np.isfinite(x)):
            return
        prior = self.alpha @ self.trans
        ll = self._loglik(x)
        log_post = np.log(np.maximum(prior, 1e-300)) + ll
        log_post -= log_post.max()
        post = np.exp(log_post)
        self.alpha = post / post.sum()

    def probs(self) -> np.ndarray:
        return self.alpha if self.fitted else np.full(self.k, np.nan)

    def signal(self) -> float:
        if not self.fitted:
            return 0.0
        p = self.alpha @ self.trans              # tomorrow's regime odds
        mu = p @ self.ret_mu
        var = p @ (self.ret_var + self.ret_mu ** 2) - mu ** 2
        sharpe = mu / math.sqrt(max(var, 1e-12)) * math.sqrt(TRADING_DAYS)
        return math.tanh(sharpe / 2)


# --------------------------------------------------------------------------------------------
# Model 2: local linear trend, Kalman filter, MLE parameters
# --------------------------------------------------------------------------------------------

def _kalman_run(y: np.ndarray, ql: float, qs: float, r: float, burn: int = 20):
    """2x2 Kalman filter unrolled into scalars, because numpy on 2x2 matrices is a snail."""
    a, b = y[0], 0.0
    p11, p12, p22 = 100.0, 0.0, 1.0
    ll = 0.0
    for t in range(1, len(y)):
        # Predict: level += slope, slope stays put (it's a slope, it has commitment issues otherwise)
        a = a + b
        p11 = p11 + 2 * p12 + p22 + ql
        p12 = p12 + p22
        p22 = p22 + qs
        # Update
        v = y[t] - a
        S = p11 + r
        k1, k2 = p11 / S, p12 / S
        a += k1 * v
        b += k2 * v
        p22 -= k2 * p12
        p12 -= k1 * p12
        p11 -= k1 * p11
        if t >= burn:
            ll -= 0.5 * (math.log(2 * math.pi * S) + v * v / S)
    return ll, (a, b, p11, p12, p22)


class KalmanTrend:
    BOUNDS = np.array([[-6.0, 3.0], [-14.0, -4.0], [-10.0, 3.0]])

    def __init__(self):
        self.theta = np.array([0.0, -10.0, -3.0])   # log(q_level), log(q_slope), log(r)
        self.state = None

    def _params(self, theta):
        th = np.clip(theta, self.BOUNDS[:, 0], self.BOUNDS[:, 1])
        return np.exp(th)

    def fit(self, logp: np.ndarray) -> None:
        y = logp * 100  # percent units keep the numbers from being microscopic

        def nll(theta):
            ql, qs, r = self._params(theta)
            return -_kalman_run(y, ql, qs, r)[0]

        res = minimize(nll, self.theta, method="Nelder-Mead",
                       options={"maxiter": 250, "xatol": 1e-3, "fatol": 1e-3})
        if np.isfinite(res.fun):
            self.theta = np.clip(res.x, self.BOUNDS[:, 0], self.BOUNDS[:, 1])
        ql, qs, r = self._params(self.theta)
        self.state = _kalman_run(y, ql, qs, r)[1]

    def step(self, logp: float) -> None:
        if self.state is None or not math.isfinite(logp):
            return
        ql, qs, r = self._params(self.theta)
        _, self.state = _kalman_run_from(self.state, logp * 100, ql, qs, r)

    def slope(self) -> float:
        return self.state[1] if self.state is not None else 0.0

    def signal(self) -> float:
        if self.state is None:
            return 0.0
        ql, _, r = self._params(self.theta)
        trend_sharpe = self.state[1] * math.sqrt(TRADING_DAYS) / math.sqrt(ql + r)
        return math.tanh(trend_sharpe)


def _kalman_run_from(state, y: float, ql: float, qs: float, r: float):
    a, b, p11, p12, p22 = state
    a = a + b
    p11 = p11 + 2 * p12 + p22 + ql
    p12 = p12 + p22
    p22 = p22 + qs
    v = y - a
    S = p11 + r
    k1, k2 = p11 / S, p12 / S
    a += k1 * v
    b += k2 * v
    p22 -= k2 * p12
    p12 -= k1 * p12
    p11 -= k1 * p11
    return v, (a, b, p11, p12, p22)


# --------------------------------------------------------------------------------------------
# Model 3: GJR-GARCH(1,1) with Student-t errors, for sizing
# --------------------------------------------------------------------------------------------

class GJRGarch:
    def __init__(self):
        self.params = None
        self.sigma2_next = None     # variance forecast for tomorrow, in percent^2
        self.ewma = None            # fallback for when arch throws a tantrum

    def fit(self, r: np.ndarray) -> None:
        from arch import arch_model

        y = r * 100
        self.ewma = float(np.var(y[-63:]))
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                res = arch_model(y, mean="Constant", vol="GARCH", p=1, o=1, q=1, dist="t",
                                 rescale=False).fit(disp="off", show_warning=False)
            p = res.params
            self.params = (p["mu"], p["omega"], p["alpha[1]"], p["gamma[1]"], p["beta[1]"])
            mu, omega, alpha, gamma, beta = self.params
            e = y[-1] - mu
            s2 = float(res.conditional_volatility[-1]) ** 2
            self.sigma2_next = omega + (alpha + gamma * (e < 0)) * e * e + beta * s2
        except Exception:  # noqa: BLE001 - arch has many ways to fail and we respect them all
            self.params = None
            self.sigma2_next = self.ewma

    def step(self, r: float) -> None:
        if not math.isfinite(r) or self.sigma2_next is None:
            return
        y = r * 100
        if self.params is None:
            self.sigma2_next = 0.94 * self.sigma2_next + 0.06 * y * y
            return
        mu, omega, alpha, gamma, beta = self.params
        e = y - mu
        self.sigma2_next = omega + (alpha + gamma * (e < 0)) * e * e + beta * self.sigma2_next

    def daily_vol(self) -> float:
        """Forecast daily vol for tomorrow as a fraction (0.01 = 1 %)."""
        return math.sqrt(max(self.sigma2_next, 1e-6)) / 100 if self.sigma2_next else 0.01


# --------------------------------------------------------------------------------------------
# Model 4: online logistic regression that remembers its failures
# --------------------------------------------------------------------------------------------

class RunningScaler:
    """Welford mean/variance: learns the feature scale one day at a time, never from the future."""

    def __init__(self, n: int):
        self.n, self.mean, self.m2 = 0, np.zeros(n), np.zeros(n)

    def update(self, x: np.ndarray) -> None:
        ok = np.isfinite(x)
        if not ok.all():
            x = np.where(ok, x, self.mean)
        self.n += 1
        d = x - self.mean
        self.mean += d / self.n
        self.m2 += d * (x - self.mean)

    def transform(self, x: np.ndarray) -> np.ndarray:
        sd = np.sqrt(self.m2 / max(self.n - 1, 1))
        sd[sd == 0] = 1.0
        z = (np.where(np.isfinite(x), x, self.mean) - self.mean) / sd
        return np.clip(z, -5, 5)


class OnlineLogit:
    def __init__(self, n_features: int, eta0: float, alpha: float, seed: int):
        from sklearn.linear_model import SGDClassifier

        self.clf = SGDClassifier(loss="log_loss", penalty="l2", alpha=alpha,
                                 learning_rate="constant", eta0=eta0, random_state=seed)
        self.scaler = RunningScaler(n_features)
        self.ready = False

    def learn(self, X: np.ndarray, y: np.ndarray, w: np.ndarray | None = None) -> None:
        self.clf.partial_fit(X, y, classes=np.array([0, 1]), sample_weight=w)
        self.ready = True

    def prob_up(self, z: np.ndarray) -> float:
        if not self.ready:
            return 0.5
        return float(self.clf.predict_proba(z.reshape(1, -1))[0, 1])


# --------------------------------------------------------------------------------------------
# The judge: Hedge with fixed share, and a Page-Hinkley alarm for when the world changes
# --------------------------------------------------------------------------------------------

class HedgeEnsemble:
    def __init__(self, names: list[str], eta: float, share: float,
                 w0: np.ndarray | None = None):
        self.names, self.eta, self.share = names, eta, share
        self.w = np.full(len(names), 1 / len(names)) if w0 is None else np.asarray(w0, float)
        self.frozen = w0 is not None and eta == 0 and share == 0

    def combine(self, s: np.ndarray) -> float:
        return float(self.w @ s)

    def update(self, s: np.ndarray, ret: float, vol: float) -> None:
        if self.frozen:
            return
        gain = np.clip(s * ret / max(vol, 1e-4), -4, 4)
        logw = np.log(self.w) + self.eta * gain
        logw -= logw.max()
        w = np.exp(logw)
        w /= w.sum()
        # Fixed share: nobody gets fired for good, they just get a very small desk by the window.
        self.w = (1 - self.share) * w + self.share / len(w)

    def soften(self, amount: float = 0.5) -> None:
        if self.frozen:
            return
        self.w = (1 - amount) * self.w + amount / len(self.w)


class PageHinkley:
    def __init__(self, delta: float, lam: float):
        self.delta, self.lam = delta, lam
        self.reset()

    def reset(self) -> None:
        self.n, self.mean, self.cum, self.cum_min = 0, 0.0, 0.0, 0.0

    def update(self, x: float) -> bool:
        self.n += 1
        self.mean += (x - self.mean) / self.n
        self.cum += x - self.mean - self.delta
        self.cum_min = min(self.cum_min, self.cum)
        if self.n > 30 and self.cum - self.cum_min > self.lam:
            self.reset()
            return True
        return False


# --------------------------------------------------------------------------------------------
# Allocation: from expert signals to a position. Knows nothing about the models.
# --------------------------------------------------------------------------------------------

class Allocator:
    """Everything that depends on the portfolio knobs and nothing that depends on the models.

    The live loop and replay_allocation() both drive this same class, so a replayed setting is
    exactly what the live strategy would have done with it. No second implementation to drift.
    """

    def __init__(self, cfg: Config, w0: np.ndarray | None = None):
        self.cfg = cfg
        eta, share = (0.0, 0.0) if w0 is not None else (cfg.hedge_eta, cfg.fixed_share)
        self.ensemble = HedgeEnsemble(EXPERTS, eta, share, w0)
        self.prev: dict | None = None     # yesterday's decision, waiting to be graded
        self.smoothed: float | None = None

    def settle(self, r: float) -> tuple[float, float] | None:
        """Grade yesterday's decision with today's log return r. Returns (return, P&L)."""
        if self.prev is None:
            return None
        p = self.prev
        self.ensemble.update(p["signals"], r, p["vol"])
        ret = math.expm1(r)
        return ret, p["position"] * ret - p["cost"]

    def on_drift(self) -> None:
        self.ensemble.soften(0.5)

    def decide(self, signals: np.ndarray, vol: float) -> dict:
        c = self.cfg
        combined = self.ensemble.combine(signals)
        direction = float(np.clip(c.base_exposure + c.signal_scale * combined,
                                  -c.max_short, c.max_direction))
        sizing = min(c.vol_target / (vol * math.sqrt(TRADING_DAYS)), c.max_leverage)
        target = float(np.clip(direction * sizing, -c.max_leverage, c.max_leverage))
        if self.smoothed is None or c.smooth_halflife <= 0:
            self.smoothed = target
        else:
            a = 1 - 0.5 ** (1 / c.smooth_halflife)
            self.smoothed += a * (target - self.smoothed)
        old = self.prev["position"] if self.prev else 0.0
        position = old if abs(self.smoothed - old) < c.rebalance_band else self.smoothed
        cost = abs(position - old) * c.cost_bps / 1e4
        self.prev = {"signals": signals, "vol": vol, "position": position, "cost": cost}
        return {"combined": combined, "target": target, "position": position, "cost": cost}


def replay_allocation(results: pd.DataFrame, cfg: Config, w0: np.ndarray | None = None,
                      return_allocator: bool = False):
    """Rerun only the allocation layer on stored expert signals. Milliseconds per year.

    Model outputs (signals, GARCH vol, drift dates) don't depend on the allocation knobs, so
    this gives exactly the result a full rerun with `cfg` would, without refitting anything.
    """
    S = results[[f"sig_{n}" for n in EXPERTS]].to_numpy()
    vol = results["garch_vol"].to_numpy() / math.sqrt(TRADING_DAYS)
    nxt = results["next_ret"].to_numpy()
    drift = results["drift_refit"].to_numpy() if "drift_refit" in results else np.zeros(len(S), bool)
    n = len(S)
    alloc = Allocator(cfg, w0)
    out = {k: np.full(n, np.nan) for k in ("signal", "target", "position", "cost", "strategy_ret")}
    weights = np.empty((n, len(EXPERTS)))
    for k in range(n):
        if k > 0:
            _, pnl = alloc.settle(math.log1p(nxt[k - 1]))
            out["strategy_ret"][k - 1] = pnl
        if drift[k]:
            alloc.on_drift()
        d = alloc.decide(S[k], vol[k])
        out["signal"][k], out["target"][k] = d["combined"], d["target"]
        out["position"][k], out["cost"][k] = d["position"], d["cost"]
        weights[k] = alloc.ensemble.w
    res = pd.DataFrame(out, index=results.index)
    res["next_ret"] = nxt
    for j, name in enumerate(EXPERTS):
        res[f"w_{name}"] = weights[:, j]
    return (res, alloc) if return_allocator else res


# --------------------------------------------------------------------------------------------
# The strategy: walks forward one day at a time and can be pickled and resumed tomorrow
# --------------------------------------------------------------------------------------------

def vol_skew_signal(row: pd.Series) -> float:
    vrp = np.clip(row["vrp_z"], -3, 3)
    # A VIX spike that has started to fade: the panic is over, the discount is not.
    fade = max(row["vix_z"], 0.0) * (1.0 if row["vix_chg5"] < 0 else -0.5)
    # Realised above implied: the market is moving more than insurers expected. Not great.
    stress = min(row["vix_rv"], 0.0)
    complacent = max(row["skew_vix"], 0.0)
    # No constant here: the equity premium lives in base_exposure, not smuggled into one expert.
    x = 0.5 * vrp + 0.6 * fade + 1.0 * stress - 0.4 * complacent
    return math.tanh(0 if not math.isfinite(x) else x)


def momentum_signal(row: pd.Series) -> float:
    x = 0.4 * row["mom63"] + 0.4 * row["mom252"] + 0.2 * row["ma_gap"]
    return math.tanh(0 if not math.isfinite(x) else x / 1.5)


class AdaptiveSPXStrategy:
    def __init__(self, cfg: Config | None = None):
        self.cfg = cfg or Config()
        c = self.cfg
        self.hmm = RegimeHMM(c.hmm_states, c.hmm_iter, c.hmm_inits, c.seed)
        self.kalman = KalmanTrend()
        self.garch = GJRGarch()
        self.logit = OnlineLogit(len(FEATURE_COLS), c.sgd_eta0, c.sgd_alpha, c.seed)
        self.alloc = Allocator(c)
        self.drift = PageHinkley(c.drift_delta, c.drift_lambda)

        self.last_date: pd.Timestamp | None = None
        self.started = False
        self.last_refit = -10 ** 9
        self.last_drift = -10 ** 9
        self.pending: list[tuple[pd.Timestamp, np.ndarray, float, float]] = []
        self.records: list[dict] = []
        self.refit_log: list[tuple[pd.Timestamp, str]] = []

    # -- helpers ---------------------------------------------------------------------------

    def _refit(self, f: pd.DataFrame, i: int, reason: str) -> None:
        c = self.cfg
        hist = f.iloc[: i + 1]
        X = hist[["ret", "log_vix"]].dropna().to_numpy()[-c.hmm_window:]
        X = X * np.array([100.0, 1.0])
        self.hmm.fit(X)
        self.kalman.fit(hist["logp"].to_numpy()[-c.kalman_window:])
        self.garch.fit(hist["ret"].dropna().to_numpy()[-c.garch_window:])
        self.last_refit = i
        self.refit_log.append((f.index[i], reason))

    def _learn_matured(self, f: pd.DataFrame, i: int) -> bool:
        """Grade every logit prediction whose horizon just ended. Returns True on drift."""
        c = self.cfg
        date_i = f.index[i]
        drift = False
        keep = []
        for (d, z, p, vol) in self.pending:
            j = f.index.get_loc(d)
            if i - j < c.label_horizon:
                keep.append((d, z, p, vol))
                continue
            fwd = f["logp"].iat[j + c.label_horizon] - f["logp"].iat[j]
            y = int(fwd > 0)
            wrong = (p > 0.5) != bool(y)
            size = min(abs(fwd) / (vol * math.sqrt(c.label_horizon)), 3.0) / 3.0
            w = 1.0 + c.mistake_boost * size * wrong
            self.logit.learn(z.reshape(1, -1), np.array([y]), np.array([w]))
            loss = -math.log(max(p if y else 1 - p, 1e-6))
            if self.drift.update(loss):
                drift = True
        self.pending = keep
        if drift:
            self.refit_log.append((date_i, "drift alarm"))
        return drift

    def _pretrain(self, f: pd.DataFrame, i: int) -> None:
        c = self.cfg
        X, y, dates, vols = [], [], [], []
        feats = f[FEATURE_COLS].to_numpy()
        rv = (f["rv21"] / math.sqrt(TRADING_DAYS)).to_numpy()
        for j in range(i + 1):
            x = feats[j]
            if np.isnan(x).mean() > 0.5:
                continue
            self.logit.scaler.update(x)
            z = self.logit.scaler.transform(x)
            if j + c.label_horizon <= i:
                X.append(z)
                y.append(int(f["logp"].iat[j + c.label_horizon] > f["logp"].iat[j]))
            elif j < i:  # day i itself is queued by the main loop, once is plenty
                dates.append(f.index[j])
                vols.append(rv[j] if math.isfinite(rv[j]) else 0.01)
        if len(set(y)) == 2:
            X, y = np.array(X), np.array(y)
            for _ in range(c.pretrain_epochs):
                self.logit.learn(X, y)
        for d, v in zip(dates, vols):
            z = self.logit.scaler.transform(f.loc[d, FEATURE_COLS].to_numpy(dtype=float))
            self.pending.append((d, z, self.logit.prob_up(z), v))

    # -- the main loop ---------------------------------------------------------------------

    def process(self, df: pd.DataFrame, verbose: bool = True) -> pd.DataFrame:
        """Walk forward over every date after the last one seen. Call again with more data later."""
        c = self.cfg
        f = build_features(df)
        first_valid = f[FEATURE_COLS].dropna().index
        if len(first_valid) == 0:
            raise ValueError("Not enough history to build features.")
        warm_end = f.index.get_loc(first_valid[0]) + c.warmup_days
        if warm_end >= len(f):
            raise ValueError(f"Need more than {warm_end} rows; got {len(f)}.")

        start_i = 0 if self.last_date is None else f.index.searchsorted(self.last_date, "right")
        feats = f[FEATURE_COLS].to_numpy()
        n_new = 0

        for i in range(start_i, len(f)):
            date = f.index[i]
            if i < warm_end:
                continue
            row = f.iloc[i]
            r = row["ret"]
            drift_refit = False

            if not self.started:
                self._refit(f, i, "initial fit")
                self._pretrain(f, i)
                self.started = True
            else:
                # 1) Grade yesterday: pay the experts, book the P&L.
                settled = self.alloc.settle(r)
                if settled is not None:
                    self.records[-1]["next_ret"], self.records[-1]["strategy_ret"] = settled
                # 2) Learn from matured logit calls; maybe the world changed.
                drift = self._learn_matured(f, i)
                # 3) Roll the filters forward with today's close.
                self.hmm.step(np.array([r * 100, row["log_vix"]]))
                self.kalman.step(row["logp"])
                self.garch.step(r)
                x = feats[i]
                self.logit.scaler.update(x)
                # 4) Refit on schedule, or right now if the alarm went off.
                if drift and i - self.last_drift >= c.drift_cooldown:
                    self.last_drift = i
                    self._refit(f, i, "drift refit")
                    self.alloc.on_drift()
                    drift_refit = True
                elif i - self.last_refit >= c.refit_every:
                    self._refit(f, i, "scheduled")

            # 5) Decide tomorrow's position.
            z = self.logit.scaler.transform(feats[i])
            p_up = self.logit.prob_up(z)
            vol = self.garch.daily_vol()
            self.pending.append((date, z, p_up, vol))
            signals = np.array([
                self.hmm.signal(),
                self.kalman.signal(),
                vol_skew_signal(row),
                math.tanh(c.logit_gain * (p_up - 0.5)),
                momentum_signal(row),
            ])
            d = self.alloc.decide(signals, vol)
            position = d["position"]

            probs = self.hmm.probs()
            rec = {
                "date": date, "close": float(df["spx"].iat[i]), "vix": float(df["vix"].iat[i]),
                "skew": float(df["skew"].iat[i]), "signal": d["combined"], "target": d["target"],
                "position": position, "cost": d["cost"], "garch_vol": vol * math.sqrt(TRADING_DAYS),
                "p_up": p_up, "kalman_slope": self.kalman.slope(), "drift_refit": drift_refit,
                "next_ret": np.nan, "strategy_ret": np.nan,
            }
            rec.update({f"sig_{n}": s for n, s in zip(EXPERTS, signals)})
            rec.update({f"w_{n}": w for n, w in zip(EXPERTS, self.alloc.ensemble.w)})
            rec.update({f"p_{REGIMES[k] if k < len(REGIMES) else k}": probs[k]
                        for k in range(len(probs))})
            self.records.append(rec)
            self.last_date = date
            n_new += 1
            if verbose and n_new % 1000 == 0:
                print(f"  {date.date()}  position {position:+.2f}  "
                      f"weights {dict(zip(EXPERTS, np.round(self.alloc.ensemble.w, 2).tolist()))}")
        return self.results()

    def results(self) -> pd.DataFrame:
        if not self.records:
            return pd.DataFrame()
        return pd.DataFrame(self.records).set_index("date")

    def set_allocation(self, **knobs) -> None:
        """Switch to new allocation knobs (e.g. from optimize_allocation) without refitting.

        History is replayed with the new knobs so the ensemble weights, the smoothed target and
        tomorrow's position are what they would have been had you used them all along.
        """
        bad = set(knobs) - set(ALLOCATION_FIELDS)
        if bad:
            raise ValueError(f"Not allocation knobs: {sorted(bad)}. Those need a full rerun.")
        self.cfg = replace(self.cfg, **knobs)
        res, self.alloc = replay_allocation(self.results(), self.cfg, return_allocator=True)
        cols = ["signal", "target", "position", "cost", "strategy_ret"] + \
               [f"w_{n}" for n in EXPERTS]
        for rec, row in zip(self.records, res[cols].itertuples(index=False)):
            rec.update(zip(cols, row))

    def save(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as fh:
            pickle.dump(self, fh)

    @staticmethod
    def load(path: str | Path) -> "AdaptiveSPXStrategy":
        # Only unpickle state files you made yourself. Pickle will happily run anyone's code.
        with open(path, "rb") as fh:
            return pickle.load(fh)


# --------------------------------------------------------------------------------------------
# Scorekeeping
# --------------------------------------------------------------------------------------------

def performance(returns: pd.Series, exposure: pd.Series | None = None) -> dict:
    r = returns.dropna()
    if r.empty:
        return {}
    eq = (1 + r).cumprod()
    years = len(r) / TRADING_DAYS
    cagr = eq.iat[-1] ** (1 / years) - 1
    vol = r.std() * math.sqrt(TRADING_DAYS)
    downside = r[r < 0].std() * math.sqrt(TRADING_DAYS)
    dd = eq / eq.cummax() - 1
    out = {
        "CAGR": cagr,
        "Volatility": vol,
        "Sharpe (rf=0)": r.mean() / r.std() * math.sqrt(TRADING_DAYS) if r.std() > 0 else np.nan,
        "Sortino": r.mean() * TRADING_DAYS / downside if downside > 0 else np.nan,
        "Max drawdown": dd.min(),
        "Calmar": cagr / abs(dd.min()) if dd.min() < 0 else np.nan,
        "Hit rate": (r > 0).mean(),
        "Worst day": r.min(),
        "Years": years,
    }
    if exposure is not None:
        e = exposure.reindex(r.index)
        out["Avg exposure"] = e.mean()
        out["Turnover / year"] = e.diff().abs().sum() / years
    return out


def summarize(res: pd.DataFrame) -> pd.DataFrame:
    done = res.dropna(subset=["strategy_ret"])
    strat = performance(done["strategy_ret"], done["position"])
    bh = performance(done["next_ret"])
    return pd.DataFrame({"Strategy": strat, "Buy & hold SPX": bh})


def plot_results(res: pd.DataFrame, refits: list, out: str | Path | None = None):
    import matplotlib.pyplot as plt

    # Reference categorical palette, fixed order: one colour per expert, never recycled.
    colors = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"]
    ink, ink2, grid = "#0b0b0b", "#52514e", "#e4e3df"
    done = res.dropna(subset=["strategy_ret"])
    eq_s = (1 + done["strategy_ret"]).cumprod()
    eq_b = (1 + done["next_ret"]).cumprod()

    plt.rcParams.update({"axes.edgecolor": grid, "axes.labelcolor": ink2, "xtick.color": ink2,
                         "ytick.color": ink2, "axes.titlecolor": ink, "axes.titlesize": 11,
                         "axes.titleweight": "bold", "font.size": 9})
    legend_style = {"frameon": True, "facecolor": "#fcfcfb", "edgecolor": "none", "framealpha": 0.9}
    fig, ax = plt.subplots(4, 1, figsize=(13, 13), sharex=True,
                           gridspec_kw={"height_ratios": [3, 1.3, 1.5, 1.8]})
    for a in ax:
        a.set_facecolor("#fcfcfb")
        a.grid(True, color=grid, linewidth=0.6)
        a.spines[["top", "right"]].set_visible(False)
        a.set_axisbelow(True)

    ax[0].plot(eq_s.index, eq_s, color=colors[0], lw=2, label="Strategy")
    ax[0].plot(eq_b.index, eq_b, color=colors[1], lw=2, label="Buy & hold SPX")
    ax[0].set_yscale("log")
    for d, reason in refits:
        if reason == "drift refit" and d in eq_s.index:
            ax[0].axvline(d, color=ink2, lw=0.6, ls=":", alpha=0.6)
    ax[0].set_title("Growth of 1 (log scale). Dotted lines: drift alarm triggered a refit")
    ax[0].legend(loc="upper left", **legend_style)

    dd_s = eq_s / eq_s.cummax() - 1
    dd_b = eq_b / eq_b.cummax() - 1
    ax[1].plot(dd_s.index, dd_s, color=colors[0], lw=1.5, label="Strategy")
    ax[1].plot(dd_b.index, dd_b, color=colors[1], lw=1.5, label="Buy & hold SPX")
    ax[1].set_title("Drawdown")
    ax[1].legend(loc="lower left", **legend_style)

    ax[2].plot(res.index, res["position"], color=colors[0], lw=1.2, label="Exposure")
    if "p_stress" in res:
        ax[2].fill_between(res.index, 0, res["p_stress"] * res["position"].max(),
                           color=ink2, alpha=0.15, lw=0, label="HMM P(stress), scaled")
    ax[2].set_title("SPX exposure and the stress regime")
    ax[2].legend(loc="upper left", **legend_style, ncol=2)

    w = res[[f"w_{n}" for n in EXPERTS]]
    ax[3].stackplot(w.index, w.T.to_numpy(), colors=colors, labels=EXPERTS,
                    edgecolor="#fcfcfb", linewidth=0.3)
    ax[3].set_ylim(0, 1)
    ax[3].set_title("Ensemble weights: who the model currently trusts")
    ax[3].legend(loc="upper left", **legend_style, ncol=6)

    fig.tight_layout()
    if out:
        Path(out).mkdir(parents=True, exist_ok=True)
        fig.savefig(Path(out) / "spx_adaptive_strategy.png", dpi=130)
    return fig


# --------------------------------------------------------------------------------------------
# Optimisation: tune the allocation on a design period, judge it on data it never saw
# --------------------------------------------------------------------------------------------

def _stats(r: pd.Series, pos: pd.Series | None = None) -> dict:
    m = performance(r, pos)
    keep = ["CAGR", "Volatility", "Sharpe (rf=0)", "Max drawdown", "Calmar"]
    out = {k: m.get(k, np.nan) for k in keep}
    if pos is not None:
        out["Avg exposure"] = m["Avg exposure"]
        out["Turnover / year"] = m["Turnover / year"]
    return out


def expert_report(results: pd.DataFrame, cfg: Config, split: pd.Timestamp | None = None
                  ) -> pd.DataFrame:
    """Every expert alone, the ensemble, and the two baselines that keep everyone honest.

    "Vol-managed only" is the same sizing with the experts switched off. If an expert can't beat
    that, it isn't adding information; it's adding turnover.
    """
    rows = {}
    runs = {"Buy & hold SPX": None,
            "Vol-managed only (no experts)": (replace(cfg, signal_scale=0.0), None),
            "Ensemble (current knobs)": (cfg, None)}
    for j, name in enumerate(EXPERTS):
        w0 = np.zeros(len(EXPERTS))
        w0[j] = 1.0
        runs[f"Only {name}"] = (cfg, w0)
    for label, spec in runs.items():
        if spec is None:
            r, pos = results["next_ret"], None
        else:
            rep = replay_allocation(results, spec[0], spec[1])
            r, pos = rep["strategy_ret"], rep["position"]
        periods = {"all": slice(None)} if split is None else {
            "design": slice(None, split), "holdout": slice(split + pd.Timedelta(days=1), None)}
        for per, sl in periods.items():
            st = _stats(r.loc[sl].dropna(), None if pos is None else pos.loc[sl])
            rows[(label, per)] = st
    return pd.DataFrame(rows).T


def deflated_sharpe(returns: pd.Series, trial_sharpes: np.ndarray) -> float:
    """Probability that the best Sharpe is real after trying this many settings.

    Bailey & Lopez de Prado (2014). Try 200 settings on noise and the best one will look like
    genius; this asks how much better than the expected best-of-noise it actually is.
    """
    from scipy.stats import norm

    r = returns.dropna()
    n = len(trial_sharpes)
    sr = r.mean() / r.std()
    var_sr = np.var(trial_sharpes, ddof=1) if n > 1 else 0.0
    gamma = 0.5772156649
    if n > 1 and var_sr > 0:
        sr0 = math.sqrt(var_sr) * ((1 - gamma) * norm.ppf(1 - 1 / n)
                                   + gamma * norm.ppf(1 - 1 / (n * math.e)))
    else:
        sr0 = 0.0
    skew, kurt = r.skew(), r.kurt() + 3
    denom = math.sqrt(max(1 - skew * sr + (kurt - 1) / 4 * sr ** 2, 1e-12))
    return float(norm.cdf((sr - sr0) * math.sqrt(len(r) - 1) / denom))


SEARCH_SPACE = {
    "base_exposure":   lambda g: g.choice([0.0, 0.5, 0.75, 1.0]),
    "signal_scale":    lambda g: g.uniform(0.25, 3.0),
    "max_direction":   lambda g: g.choice([1.0, 1.25, 1.5]),
    "hedge_eta":       lambda g: math.exp(g.uniform(math.log(0.01), math.log(0.5))),
    "fixed_share":     lambda g: math.exp(g.uniform(math.log(0.001), math.log(0.05))),
    "vol_target":      lambda g: g.choice([0.10, 0.12, 0.15, 0.18, 0.20]),
    "max_leverage":    lambda g: g.choice([1.0, 1.25, 1.5, 2.0]),
    "max_short":       lambda g: g.choice([0.0, 0.0, 0.25, 0.5]),
    "smooth_halflife": lambda g: g.choice([0.0, 1.0, 2.0, 3.0, 5.0, 10.0]),
    "rebalance_band":  lambda g: g.uniform(0.02, 0.25),
}
OBJECTIVES = {"sharpe": "Sharpe (rf=0)", "calmar": "Calmar", "cagr": "CAGR"}


def optimize_allocation(results: pd.DataFrame, cfg: Config, n_trials: int = 200,
                        design_frac: float = 0.6, objective: str = "sharpe", seed: int = 0,
                        max_turnover: float | None = 12.0, verbose: bool = True) -> dict:
    """Random search over the allocation knobs, chosen on the design period only.

    The holdout (the last 1 - design_frac of the history) is scored once per trial but never
    used to choose. If the winner's holdout falls apart, the "improvement" was curve fitting,
    and you've learned that for free instead of with money.
    """
    if objective not in OBJECTIVES:
        raise ValueError(f"objective must be one of {list(OBJECTIVES)}")
    key = OBJECTIVES[objective]
    done = results.dropna(subset=["next_ret"])
    split = done.index[int(len(done) * design_frac)]
    design, hold = slice(None, split), slice(split + pd.Timedelta(days=1), None)
    rng = np.random.default_rng(seed)

    trials = [{k: getattr(cfg, k) for k in SEARCH_SPACE}]          # trial 0: current settings
    trials += [{k: float(f(rng)) for k, f in SEARCH_SPACE.items()} for _ in range(n_trials)]
    rows, daily_sr = [], []
    for t, knobs in enumerate(trials):
        rep = replay_allocation(results, replace(cfg, **knobs))
        r, pos = rep["strategy_ret"], rep["position"]
        d = _stats(r.loc[design].dropna(), pos.loc[design])
        h = _stats(r.loc[hold].dropna(), pos.loc[hold])
        rd = r.loc[design].dropna()
        daily_sr.append(rd.mean() / rd.std() if rd.std() > 0 else 0.0)
        ok = max_turnover is None or d["Turnover / year"] <= max_turnover
        rows.append({"trial": t, **knobs, "eligible": ok,
                     **{f"design {k}": v for k, v in d.items()},
                     **{f"holdout {k}": v for k, v in h.items()}})
        if verbose and (t + 1) % 50 == 0:
            print(f"  {t + 1}/{len(trials)} settings tried")
    table = pd.DataFrame(rows).set_index("trial")
    ranked = table[table["eligible"]].sort_values(f"design {key}", ascending=False)
    if ranked.empty:
        raise ValueError("No setting met max_turnover. Loosen it or widen rebalance_band.")
    best = int(ranked.index[0])
    best_knobs = {k: float(table.at[best, k]) for k in SEARCH_SPACE}
    best_rep = replay_allocation(results, replace(cfg, **best_knobs))
    dsr = deflated_sharpe(best_rep["strategy_ret"].loc[design], np.array(daily_sr))

    bh_d = _stats(done["next_ret"].loc[design])
    bh_h = _stats(done["next_ret"].loc[hold])
    summary = pd.DataFrame({
        ("design", "Buy & hold"): bh_d,
        ("design", "Current knobs"): {k: table.at[0, f"design {k}"] for k in bh_d},
        ("design", "Best on design"): {k: table.at[best, f"design {k}"] for k in bh_d},
        ("holdout", "Buy & hold"): bh_h,
        ("holdout", "Current knobs"): {k: table.at[0, f"holdout {k}"] for k in bh_h},
        ("holdout", "Best on design"): {k: table.at[best, f"holdout {k}"] for k in bh_h},
        ("holdout", "Median of top 10"): ranked.head(10)[[f"holdout {k}" for k in bh_h]]
            .median().set_axis(list(bh_h)).to_dict(),
    })
    out = {"best_knobs": best_knobs, "summary": summary, "table": ranked,
           "split": split, "deflated_sharpe": dsr, "objective": objective}
    if verbose:
        print(f"Design: {done.index[0].date()} to {split.date()}, holdout: after {split.date()}. "
              f"{len(trials)} settings, objective {objective}.")
        print(f"Deflated Sharpe ratio of the winner: {dsr:.2f} "
              f"(chance its design Sharpe beats the best of {len(trials)} lucky tries; "
              f"below 0.95, treat it as luck)")
    return out


# --------------------------------------------------------------------------------------------
# Entry points
# --------------------------------------------------------------------------------------------

def run_backtest(cfg: Config | None = None, data: pd.DataFrame | None = None,
                 out: str | Path | None = "out", save_state: str | Path | None = None,
                 plot: bool = True, verbose: bool = True):
    cfg = cfg or Config()
    if data is None:
        if verbose:
            print(f"Downloading {', '.join(TICKERS.values())} from Yahoo...")
        data = load_market_data(cfg.start, cfg.end)
    if verbose:
        print(f"{len(data)} days, {data.index[0].date()} to {data.index[-1].date()}. "
              f"Walking forward (grab a coffee, the HMM likes to think)...")
    strat = AdaptiveSPXStrategy(cfg)
    res = strat.process(data, verbose=verbose)
    metrics = summarize(res)
    if verbose:
        with pd.option_context("display.float_format", "{:,.3f}".format):
            print(metrics)
        n_drift = sum(1 for _, r in strat.refit_log if r == "drift refit")
        print(f"Refits: {len(strat.refit_log)} ({n_drift} triggered by drift). "
              f"Final weights: {dict(zip(EXPERTS, np.round(strat.alloc.ensemble.w, 3).tolist()))}")
    if out:
        Path(out).mkdir(parents=True, exist_ok=True)
        res.to_csv(Path(out) / "spx_adaptive_results.csv")
        metrics.to_csv(Path(out) / "spx_adaptive_metrics.csv")
        with open(Path(out) / "config.txt", "w") as fh:
            fh.write(repr(asdict(cfg)))
    if plot:
        plot_results(res, strat.refit_log, out)
    if save_state:
        strat.save(save_state)
    return res, metrics, strat


def live_signal(state_path: str | Path, data: pd.DataFrame | None = None,
                save: bool = True) -> dict:
    """Load yesterday's brain, feed it the new days, let it learn, and ask for tomorrow's exposure."""
    strat = AdaptiveSPXStrategy.load(state_path)
    if data is None:
        data = load_market_data(strat.cfg.start, None)
    before = strat.last_date
    res = strat.process(data, verbose=False)
    last = res.iloc[-1]
    out = {
        "as_of": res.index[-1].date().isoformat(),
        "new_days_learned": int((res.index > before).sum()) if before is not None else len(res),
        "target_exposure": round(float(last["position"]), 3) + 0.0,  # no "-0.0" drama
        "ensemble_signal": round(float(last["signal"]), 3),
        "garch_vol_annual": round(float(last["garch_vol"]), 3),
        "regime_probs": {k: round(float(last[f"p_{k}"]), 3) for k in REGIMES
                         if f"p_{k}" in last},
        "weights": {n: round(float(last[f"w_{n}"]), 3) for n in EXPERTS},
        "signals": {n: round(float(last[f"sig_{n}"]), 3) for n in EXPERTS},
    }
    if save:
        strat.save(state_path)
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    sub = ap.add_subparsers(dest="cmd")
    bt = sub.add_parser("backtest")
    bt.add_argument("--start", default=Config.start)
    bt.add_argument("--end", default=None)
    bt.add_argument("--out", default="out")
    bt.add_argument("--save-state", default=None)
    bt.add_argument("--synthetic", action="store_true", help="fake market, no network needed")
    bt.add_argument("--no-plot", action="store_true")
    lv = sub.add_parser("live")
    lv.add_argument("--state", required=True)
    # parse_known_args so Jupyter's "-f kernel.json" doesn't crash the party in Colab/Fabric.
    args, _ = ap.parse_known_args(argv)

    if args.cmd == "live":
        import json
        print(json.dumps(live_signal(args.state), indent=2))
        return

    cfg = Config(start=getattr(args, "start", Config.start), end=getattr(args, "end", None))
    data = synthetic_market_data(cfg.start) if getattr(args, "synthetic", False) else None
    run_backtest(cfg, data=data, out=getattr(args, "out", "out"),
                 save_state=getattr(args, "save_state", None),
                 plot=not getattr(args, "no_plot", False))


if __name__ == "__main__":
    main()
