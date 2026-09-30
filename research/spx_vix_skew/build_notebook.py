"""
Builds spx_adaptive_strategy.ipynb from spx_adaptive_strategy.py, so the notebook and the script
never drift apart. Edit the .py, then run:  python build_notebook.py

The notebook is self-contained: every line of the strategy lives in its cells, nothing to upload.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import nbformat as nbf

HERE = Path(__file__).parent
SRC = HERE / "spx_adaptive_strategy.py"
OUT = HERE / "spx_adaptive_strategy.ipynb"
COLAB_URL = ("https://colab.research.google.com/github/AntonAlin/options-lab/blob/main/"
             "research/spx_vix_skew/spx_adaptive_strategy.ipynb")

# One markdown intro per section of the script, keyed on the section's header line.
SECTION_NOTES = {
    "Data": """## 2. Data från Yahoo Finance

`^GSPC` (S&P 500), `^VIX` och `^SKEW`, justerade till SPX handelsdagar. SKEW-historiken på Yahoo har
enstaka orimliga värden; allt utanför 90–200 kastas och korta luckor fylls framåt (max 5 dagar,
bara bakåtblickande). `synthetic_market_data` är en påhittad marknad för test utan nätverk.""",
    "Features": """## 3. Features

Alla är kausala: rullande fönster och differenser tittar bara bakåt. Volatilitetsskalad momentum,
realiserad vol, VIX-z-score, variansriskpremie (VIX² − realiserad varians), VIX mot realiserad vol,
SKEW-z-score och SKEW relativt VIX (dyrt kraschskydd medan VIX sover), avstånd till 200-dagars
snitt och drawdown.""",
    "Model 1": """## 4. Modell 1: dold Markov-modell (regimer)

Tre regimer (lugn, normal, stress) på (avkastning, log VIX). Anpassas med Baum-Welch i `hmmlearn`,
men sannolikheterna räknas med ett eget **framåtfilter**. `predict_proba` används inte: den
utjämnar med framtida data och ger en backtest som ljuger.""",
    "Model 2": """## 5. Modell 2: Kalmanfilter (trend)

Lokal linjär trend på log SPX. Brusvarianserna skattas med maximum likelihood (Nelder-Mead),
tillståndet (nivå, lutning) uppdateras varje dag. Signalen är trendens årliga Sharpe.""",
    "Model 3": """## 6. Modell 3: GJR-GARCH (positionsstorlek)

GJR-GARCH(1,1) med Student-t-fel via `arch`: fångar att fall höjer volatiliteten mer än uppgångar.
Prognosen för morgondagens vol skalar positionen mot volatilitetsmålet.""",
    "Model 4": """## 7. Modell 4: online logistisk regression

Förutsäger om SPX är högre om 5 dagar. Tränas varje dag när en etikett mognar; fel gissningar på
stora rörelser väger upp till 3× mer. Skalningen av features lärs också online (Welford).""",
    "The judge": """## 8. Domaren: Hedge-viktning och driftlarm

**Hedge med fixed share**: varje expert betalas signal × avkastning / prognosvol, vikterna flyttas
mot dem som hade rätt, och ett golv gör att en nedviktad expert kan komma tillbaka.
**Page-Hinkley** övervakar den logistiska modellens log-loss; när den hoppar görs alla modeller om
direkt och vikterna dras halvvägs mot lika.""",
    "Allocation": """## 9. Allokering: från signaler till position

Experterna *lutar* en lång grundposition (`base_exposure = 1`) i stället för att behöva rösta in
strategin på marknaden varje dag, vilket var det största skälet till svag avkastning i första
versionen: snittexponeringen låg runt 0,55. Målet glättas med ett EMA och en no-trade-band
minskar omsättningen. Allokeringen vet inget om modellerna, så `replay_allocation` kan köra om
den på sparade signaler på bråkdelen av en sekund.""",
    "The strategy": """## 10. Strategin

Går framåt en dag i taget: betygsätter gårdagen, lär sig av mogna etiketter, rullar filtren,
gör om modellerna vid behov och bestämmer morgondagens position. Hela objektet kan sparas med
pickle och fortsätta imorgon.""",
    "Scorekeeping": """## 11. Nyckeltal och grafer""",
    "Optimisation": """## 12. Optimering utan självbedrägeri

Slumpsökning över allokeringsinställningarna. Valet görs **bara** på designperioden (de första
60 %); holdout-perioden poängsätts men används aldrig för att välja. Den deflaterade
Sharpe-kvoten (Bailey & López de Prado) justerar för hur många inställningar som prövats.
`expert_report` visar varje expert ensam mot två baslinjer: köp-och-behåll och enbart
volatilitetsstyrning. Slår en expert inte den senare tillför den brus, inte information.""",
    "Entry points": """## 13. Körfunktioner

`run_backtest` kör hela historiken, `live_signal` laddar sparat tillstånd, lär sig av nya dagar
och ger morgondagens exponering.""",
}

INTRO = f"""# SPX adaptiv regimstrategi med VIX och SKEW

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)]({COLAB_URL})

En självlärande strategi på S&P 500 med data från Yahoo Finance (`^GSPC`, `^VIX`, `^SKEW`).
Fem experter ger var sin signal i [-1, 1] och en Hedge-ensemble viktar dem efter hur rätt de
haft:

| Expert | Modell |
|---|---|
| `hmm` | Dold Markov-modell, 3 regimer, framåtfiltrerad |
| `kalman` | Lokal linjär trend, Kalmanfilter, ML-skattade parametrar |
| `vol_skew` | Variansriskpremie, VIX-toppar som klingar av, SKEW mot VIX |
| `logit` | Online logistisk regression som viktar upp sina misstag |
| `momentum` | Volatilitetsskalad 3- och 12-månaders momentum |

Experterna lutar en lång grundposition, som skalas med GJR-GARCH mot 15 % årsvol (max 1,5×
hävstång, lång/kassa som standard). Allokeringsinställningarna kan optimeras på några sekunder
utan att modellerna körs om, med en holdout-period som aldrig används för valet.
Allt körs walk-forward: beslutet vid stängning dag *t* använder bara data till och med *t*.

**Kör:** *Runtime → Run all*. Hela backtesten från 1990 tar ett par minuter.

*Genererad från `spx_adaptive_strategy.py` med `build_notebook.py`; ändra i .py-filen och bygg om.
Inte investeringsrådgivning.*"""

INSTALL = """%pip install -q yfinance hmmlearn arch scikit-learn scipy pandas matplotlib"""

SETTINGS = """# The knobs. Everything else is in Config above; change it here, not up there.
USE_SYNTHETIC = False      # True = fake market, for when Yahoo decides to take the day off
SAVE_TO_DRIVE = False      # True = keep the learned state on Google Drive between sessions
RUN_SELF_TEST = True       # the look-ahead check at the bottom, ~20 seconds

cfg = Config()
# cfg = Config(max_short=0.5)                  # allow shorts, if you enjoy pain
# cfg = Config(rebalance_band=0.2, cost_bps=5) # stress the trading costs
# cfg = Config(start="2000-01-03")             # shorter history, faster run

if SAVE_TO_DRIVE:
    from google.colab import drive
    drive.mount("/content/drive")
    STATE_PATH = "/content/drive/MyDrive/spx_strategy/state.pkl"
else:
    STATE_PATH = "out/state.pkl"
print(cfg)"""

LOAD = """data = synthetic_market_data(cfg.start) if USE_SYNTHETIC else load_market_data(cfg.start, cfg.end)
print(f"{len(data)} days, {data.index[0].date()} to {data.index[-1].date()}")
data.tail()"""

RAW_PLOT = """import matplotlib.pyplot as plt

# Three panels, one axis each. A dual-axis chart would be faster to write and slower to trust.
fig, ax = plt.subplots(3, 1, figsize=(13, 7), sharex=True)
for a, col, title, log in zip(ax, ["spx", "vix", "skew"],
                              ["S&P 500 (log scale)", "VIX", "CBOE SKEW"], [True, False, False]):
    a.plot(data.index, data[col], color="#2a78d6", lw=1.2)
    a.set_title(title, loc="left", fontsize=10, fontweight="bold")
    a.grid(True, color="#e4e3df", lw=0.6)
    a.set_axisbelow(True)
    a.spines[["top", "right"]].set_visible(False)
    if log:
        a.set_yscale("log")
fig.tight_layout()
plt.show()"""

FEATURES_PEEK = """features = build_features(data)
features[FEATURE_COLS].dropna().describe().T.round(3)"""

RUN = """import os
os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
results, metrics, strat = run_backtest(cfg, data=data, out="out", save_state=STATE_PATH, plot=False)
metrics.style.format("{:,.3f}")"""

PLOT = """fig = plot_results(results, strat.refit_log, out="out")
plt.show()"""

ANNUAL = """# Year by year, because a 30-year Sharpe ratio can hide a decade of misery.
done = results.dropna(subset=["strategy_ret"])
yearly = pd.DataFrame({
    "Strategy": done["strategy_ret"].groupby(done.index.year).apply(lambda r: (1 + r).prod() - 1),
    "Buy & hold": done["next_ret"].groupby(done.index.year).apply(lambda r: (1 + r).prod() - 1),
    "Avg exposure": done["position"].groupby(done.index.year).mean(),
})
yearly["Difference"] = yearly["Strategy"] - yearly["Buy & hold"]
yearly.style.format("{:+.1%}", subset=["Strategy", "Buy & hold", "Difference"]) \\
            .format("{:.2f}", subset=["Avg exposure"])"""

REGIMES_CELL = """# What each regime actually delivered the next day. Filtered probabilities, so no hindsight.
p_cols = [f"p_{k}" for k in REGIMES]
regime = done[p_cols].idxmax(axis=1).str[2:]
stats = done.groupby(regime).agg(
    days=("next_ret", "size"),
    mean_next_ret=("next_ret", "mean"),
    vol_next_ret=("next_ret", "std"),
    avg_exposure=("position", "mean"),
    avg_vix=("vix", "mean"),
).reindex(REGIMES)
stats["share"] = stats["days"] / stats["days"].sum()
stats["ann_return"] = stats["mean_next_ret"] * TRADING_DAYS
stats["ann_vol"] = stats["vol_next_ret"] * (TRADING_DAYS ** 0.5)
stats[["days", "share", "ann_return", "ann_vol", "avg_exposure", "avg_vix"]].style.format(
    {"share": "{:.1%}", "ann_return": "{:+.1%}", "ann_vol": "{:.1%}", "avg_exposure": "{:.2f}",
     "avg_vix": "{:.1f}"})"""

REFITS = """# Every refit and why: scheduled, or the drift alarm going off.
refits = pd.DataFrame(strat.refit_log, columns=["date", "reason"])
print(refits["reason"].value_counts().to_string())
refits[refits["reason"] != "scheduled"].tail(20)"""

OPT_MD = """## 15. Optimera allokeringen

Tar ungefär en halv minut för 200 inställningar: modellerna körs inte om, bara allokeringen.
Titta på **holdout**-kolumnerna, inte design. Designsiffrorna är alltid bra; det är det som
är problemet med dem."""

OPTIMIZE = """opt = optimize_allocation(results, cfg, n_trials=200, objective="sharpe", design_frac=0.6)
opt["summary"].style.format("{:,.3f}")"""

TOP = """# The ten best on design, with what they did afterwards. If the holdout ranking looks random,
# the search found noise.
knob_cols = list(SEARCH_SPACE)
show = knob_cols + ["design Sharpe (rf=0)", "holdout Sharpe (rf=0)", "design CAGR", "holdout CAGR",
                    "holdout Max drawdown", "design Turnover / year"]
opt["table"].head(10)[show].round(3)"""

REPORT = """# Who actually earns their keep, before and after the split.
expert_report(results, cfg, split=opt["split"]).style.format("{:,.3f}")"""

APPLY = """# Adopt the winner only if the holdout held up. It's your money; look before you leap.
APPLY_BEST = False

if APPLY_BEST:
    strat.set_allocation(**opt["best_knobs"])   # replays history, no refitting
    cfg, results = strat.cfg, strat.results()
    strat.save(STATE_PATH)
    display(summarize(results).style.format("{:,.3f}"))
    plot_results(results, strat.refit_log, out="out")
    plt.show()
else:
    print("Not applied. Best knobs on design:", {k: round(v, 3) for k, v in opt["best_knobs"].items()})"""

TODAY = """# The latest decision, i.e. the exposure to hold into the next session.
last = results.iloc[-1]
print(f"As of {results.index[-1].date()}: target exposure {last['position']:+.2f} "
      f"(ensemble signal {last['signal']:+.2f}, GARCH vol {last['garch_vol']:.1%})")
pd.DataFrame({
    "signal": [last[f"sig_{n}"] for n in EXPERTS],
    "weight": [last[f"w_{n}"] for n in EXPERTS],
}, index=EXPERTS).assign(contribution=lambda d: d.signal * d.weight).round(3)"""

LIVE_MD = """## 16. Daglig uppdatering

Kör efter stängning. Laddar sparat tillstånd, hämtar ny data, låter modellen lära sig av dagarna
sedan sist och ger morgondagens exponering. I en ny session: kör alla definitionsceller först
(avsnitt 1–13), sedan bara den här. Ladda bara tillståndsfiler du skapat själv: pickle kör kod."""

LIVE = """import json
print(json.dumps(live_signal(STATE_PATH), indent=2))"""

SELF_TEST = """# Look-ahead check: run on less data, then on more. If an old position changes when new data
# arrives, the model has been reading tomorrow's newspaper and the backtest is fiction.
if RUN_SELF_TEST:
    import numpy as np
    small = dict(warmup_days=400, hmm_window=750, hmm_inits=1, hmm_iter=50,
                 kalman_window=500, garch_window=750)
    fake = synthetic_market_data("2000-01-03", "2006-12-29", seed=3)
    full = AdaptiveSPXStrategy(Config(**small)).process(fake, verbose=False)
    cut = AdaptiveSPXStrategy(Config(**small)).process(fake.iloc[:1300], verbose=False)
    cols = ["position", "signal"] + [c for c in cut if c.startswith("w_")]
    np.testing.assert_allclose(full.loc[cut.index, cols].to_numpy(), cut[cols].to_numpy(),
                               rtol=1e-9, atol=1e-12)
    print(f"No look-ahead: {len(cut)} days identical with and without the future.")"""


def split_sections(text: str) -> tuple[str, list[tuple[str, str]]]:
    """Split the script on its '# ----' / '# Title' / '# ----' headers."""
    lines = text.splitlines()
    rule = re.compile(r"^# -{20,}$")
    heads = [i for i in range(len(lines) - 2)
             if rule.match(lines[i]) and rule.match(lines[i + 2])]
    preamble = "\n".join(lines[:heads[0]])
    sections = []
    for n, h in enumerate(heads):
        end = heads[n + 1] if n + 1 < len(heads) else len(lines)
        title = lines[h + 1][2:].strip()
        body = "\n".join(lines[h:end])
        sections.append((title, body))
    return preamble, sections


def clean_preamble(preamble: str) -> str:
    # Drop the module docstring (the intro cell covers it) and the __future__ import, which only
    # works on a cell's first line and isn't needed on the Python versions Colab runs.
    code = re.sub(r'^""".*?"""\n', "", preamble, flags=re.S)
    code = code.replace("from __future__ import annotations\n", "")
    return code.strip() + "\n"


def clean_entry_points(body: str) -> str:
    # The CLI is for terminals; the notebook has cells for that.
    return body.split("\ndef main(")[0].rstrip() + "\n"


def build() -> nbf.NotebookNode:
    preamble, sections = split_sections(SRC.read_text())
    md, code = nbf.v4.new_markdown_cell, nbf.v4.new_code_cell
    cells = [
        md(INTRO),
        md("## 1. Installation och inställningar"),
        code(INSTALL),
        code(clean_preamble(preamble)),
    ]
    for title, body in sections:
        key = next((k for k in SECTION_NOTES if title.startswith(k)), None)
        if key is None:
            sys.exit(f"No notebook text for section '{title}'. Add it to SECTION_NOTES.")
        if key == "Entry points":
            body = clean_entry_points(body)
        cells += [md(SECTION_NOTES[key]), code(body.strip() + "\n")]
    cells += [
        md("## 14. Kör backtesten\n\nÄndra inställningarna här, inte i `Config`-cellen."),
        code(SETTINGS),
        code(LOAD),
        code(RAW_PLOT),
        code(FEATURES_PEEK),
        code(RUN),
        code(PLOT),
        md("### År för år"),
        code(ANNUAL),
        md("### Vad regimerna levererade"),
        code(REGIMES_CELL),
        md("### När modellen gjordes om"),
        code(REFITS),
        md("### Dagens beslut"),
        code(TODAY),
        md(OPT_MD),
        code(OPTIMIZE),
        code(TOP),
        code(REPORT),
        code(APPLY),
        md(LIVE_MD),
        code(LIVE),
        md("## 17. Självtest"),
        code(SELF_TEST),
    ]
    nb = nbf.v4.new_notebook(cells=cells)
    nb.metadata = {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python"},
        "colab": {"provenance": [], "toc_visible": True},
    }
    return nb


if __name__ == "__main__":
    nbf.write(build(), OUT)
    print(f"Wrote {OUT}")
