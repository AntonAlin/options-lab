# SPX adaptive regime strategy (VIX + SKEW)

A self-learning trading strategy on the S&P 500 index, using VIX and CBOE SKEW, with all data from Yahoo Finance via `yfinance` (`^GSPC`, `^VIX`, `^SKEW`). It is a research script and is not part of the portfolio site: `scripts/assemble-site.sh` leaves `research/` out of the published site and the release zips.

Not investment advice.

## What it does

The strategy walks forward one day at a time. The decision at the close of day *t* uses data up to and including *t* and earns the return from *t* to *t+1*.

| Expert | Model | Signal |
|---|---|---|
| `hmm` | 3-state Gaussian HMM on (daily return, log VIX), fitted with Baum-Welch (`hmmlearn`) and inferred with a hand-written **forward filter**. `predict_proba` is not used because it smooths with future data. | Expected risk-adjusted return tomorrow under the predicted regime mix |
| `kalman` | Local linear trend state-space model on log SPX, with noise variances estimated by maximum likelihood and the state updated daily by a Kalman filter | Annualised trend Sharpe |
| `vol_skew` | Variance risk premium (VIX² − realised variance), fading VIX spikes, realised vol above implied, and SKEW high while VIX is low | Options-market view |
| `logit` | Online logistic regression (SGD) on 13 causal features, predicting the sign of the next 5 days | 2·(p − 0.5), scaled |
| `momentum` | Volatility-scaled 3- and 12-month momentum and the gap to the 200-day average | Trend |
| `long` | Always 1 | The benchmark: the ensemble has to earn every deviation from it |

**Sizing:** a GJR-GARCH(1,1) model with Student-t errors (`arch`) forecasts tomorrow's volatility, and the position is scaled to a 15 % annual volatility target, capped at 1.5× leverage. The strategy is long/flat by default (`max_short = 0`). It uses a no-trade band of 0.10 and charges 2 bp per unit of turnover.

## How it learns from its mistakes

1. **Hedge weights with fixed share.** Every day, each expert is scored on signal × return / forecast vol. Weights shift towards the experts that were right. The fixed share keeps a floor, so a demoted expert can come back when the regime changes.
2. **Online logistic regression.** The model is updated every time a 5-day label matures. A wrong call on a large move counts up to 3× as much as a right one.
3. **Drift detection.** A Page-Hinkley test watches the logistic model's log-loss. When the loss jumps, the HMM, Kalman and GARCH models are refitted immediately and the ensemble weights are pulled halfway back to uniform.
4. **Scheduled refits.** The HMM, Kalman and GARCH models are refitted every 63 days on rolling windows (10, 5 and 10 years).
5. **Persistent state.** `live_signal()` loads yesterday's pickled strategy, processes and learns from the new days, returns tomorrow's target exposure and saves the state again.

## Run it

**Colab notebook:** [`spx_adaptive_strategy.ipynb`](spx_adaptive_strategy.ipynb) holds the full strategy in its cells, so there is nothing to upload. Open it in Colab (*File → Open notebook → GitHub*, or use the badge in the notebook once it is on `main`) and run *Runtime → Run all*. Besides the backtest, it shows the raw data, the features, year-by-year returns, what each regime delivered, the drift refits, today's decision per expert, a daily update cell (with the option of saving the state on Google Drive) and a look-ahead self-test. The notebook is generated from the script: edit `spx_adaptive_strategy.py`, then run `python build_notebook.py`. A test fails if the two differ.

Importing the script in Colab or a Microsoft Fabric notebook:

```python
!pip install yfinance hmmlearn arch scikit-learn scipy matplotlib
from spx_adaptive_strategy import run_backtest, live_signal, Config

results, metrics, strat = run_backtest(Config(), out="out", save_state="out/state.pkl")
metrics

# Every trading day after that:
live_signal("out/state.pkl")
```

In Fabric, put the state on the lakehouse (for example `/lakehouse/default/Files/spx/state.pkl`) so it survives between sessions. Only load state files you created yourself, because unpickling runs code.

Command line:

```bash
pip install -r requirements.txt
python spx_adaptive_strategy.py backtest --out out --save-state out/state.pkl
python spx_adaptive_strategy.py live --state out/state.pkl
python spx_adaptive_strategy.py backtest --synthetic     # fake market, no network
python -m pytest -q                                      # tests, synthetic data
```

A full backtest from 1990 takes about 1.5 minutes. Trading starts after roughly 6 years: 1 year to build the features plus a 5-year warm-up.

## Outputs

- `out/spx_adaptive_results.csv`: one row per day with the position, the signal of every expert, the ensemble weights, the regime probabilities, the GARCH volatility and the P&L.
- `out/spx_adaptive_metrics.csv`: CAGR, volatility, Sharpe, Sortino, max drawdown, Calmar, hit rate, average exposure and turnover, for the strategy and for buy-and-hold.
- `out/spx_adaptive_strategy.png`: equity curve against buy-and-hold with the drift refits marked, drawdowns, exposure together with the stress-regime probability, and the ensemble weights over time.

## What the tests check

The tests in `test_spx_adaptive_strategy.py` check that:

- the features are causal;
- truncating the data does not change a single earlier position, signal or weight (no look-ahead);
- a pickled and resumed run is identical to one uninterrupted run;
- the P&L is yesterday's position times today's return, minus costs;
- the notebook matches the script.

## Limitations

- **The price index is traded without dividends, and cash earns 0.** Both the strategy and buy-and-hold are affected the same way. A real implementation would trade futures or SPY.
- **The `vol_skew` weights and the signal scaling are set by hand** from economic reasoning, not fitted. The ensemble decides how much to trust them, but the settings in `Config` are still a choice, and tuning them against the backtest overfits.
- **Turnover is high**: about 14× per year on synthetic data. Increase `rebalance_band` or `cost_bps` to see how sensitive the result is.
- **Yahoo's SKEW history has gaps and outliers.** Values outside 90–200 are removed and gaps are forward-filled for at most 5 days.
- **The logistic model is pre-trained on the warm-up data.** This is in-sample before the first trade, but no trade is taken on that data.
