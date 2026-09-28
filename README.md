# Nexus Portfolio Lab

Free portfolio analytics for fund managers, in English and Swedish. It runs entirely in the browser: holdings are stored in `localStorage`, nothing goes to a server, and there are no accounts.

*Svenska nedan.*

## What it does

| Area | Contents |
|---|---|
| **Holdings** | 15 instrument types: equity, ETF, mutual fund, government bond, corporate bond, FRN, money market / T-bill, cash, future, listed option, FX forward/swap, interest rate swap, CDS, commodity/ETC and alternative/unlisted. Each type gets its own form, validation and live valuation preview. |
| **Bulk upload** | CSV, TSV, XLSX/XLS/ODS, or cells pasted from Excel. Detects the delimiter, decimal comma vs. decimal point, the header row and column names in English or Swedish. Every row is validated before import. Import modes are *add*, *update existing* (matches on ISIN, then ticker, then name, so a daily ISIN + price file refreshes prices) and *replace*. Downloadable Excel template with an instruction sheet. |
| **Custom file formats** | JSON (records at any depth, nested fields flattened) and XML (the repeating record element is found automatically) next to CSV and Excel. Map any layout by hand: fixed values for fields the file lacks, value scaling (×100, ÷1000, sign flip), per-column date formats, your own type codes (e.g. `EQ_ORD` → Equity, `CASH` → skip), and rows to skip (`Total; Summa`). A **Mandatory datapoints** checklist shows each required field for the instrument types in the file and where it comes from. Save the mapping as an **import template**: it is matched on the column headers, even if the columns are reordered, and applied automatically to the next file. Templates can be downloaded and uploaded as JSON to share with colleagues. |
| **Price history** | Wide or long price files, merged by date. Holdings are matched by ticker, ISIN or name, or mapped by hand. FX series (`USDSEK` etc.) and a benchmark column are supported. |
| **Exposure** | Market value vs. economic exposure by asset class (the derivative overlay), sector, region, country, instrument type, issuer, currency before and after hedges, top-10 weight, HHI and effective N. |
| **Risk** | Parametric factor VaR/ES (equity, rates per currency, credit, FX, commodities, implied vol, stock-specific risk) and historical VaR/ES, with confidence, horizon and headline method all selectable. Euler risk contributions by factor and by position, factor sensitivities, option Greeks and a correlation matrix. |
| **Fixed income** | Yield, modified and spread duration, convexity, DV01/CS01, portfolio duration including swaps and bond futures, maturity and rating profiles, DV01 ladder and rate risk per currency. |
| **Performance** | Back-cast of current holdings over the loaded history: CAGR, volatility, Sharpe, Sortino, max drawdown, Calmar, VaR/ES, skew/kurtosis, and against a benchmark beta, alpha, tracking error, information ratio and up/down capture. Also rolling volatility, drawdown chart and a monthly return table. |
| **Stress tests** | 11 scenarios (GFC 2008, euro crisis 2011, Covid 2020, 2022 rate shock, parallel rate and spread shifts, base-currency moves, stagflation) plus a custom scenario built with sliders. Options are fully repriced. |
| **Liquidity** | Days-to-liquidate from average daily volume and a participation rate, or type defaults and notice periods. Pro-rata liquidation profile under normal and stressed conditions. |
| **Compliance** | UCITS-style limits: single issuer, 5/10/40, government issuers, bank deposits, single fund, derivative commitment, OTC counterparty, 7-day liquidity and illiquid assets, plus optional internal limits. Every limit can be switched on or off and edited. |
| **PDF report** | Multi-page A4 PDF generated locally with jsPDF: summary tiles, commentary, charts and tables for each section, and a disclaimer. |
| **Options Lab** | The original strategy visualiser (payoff, Greeks, vol surface, Monte Carlo and more) is at `options-lab.html`. It is Swedish only for now. |

Plotly (charts) loads from a CDN when the page opens. jsPDF and SheetJS load only when you export a PDF or use an Excel file.

## Adding an instrument type

Everything is driven by the registry in [`js/instruments.js`](js/instruments.js): forms, templates, column mapping, validation, the holdings table and all analytics. A new type is **one object**:

```js
// js/instruments.js → INSTRUMENTS
convertible: {
  en: 'Convertible bond', sv: 'Konvertibel', group: 'fixed_income', icon: 'CNV',
  hint: { en: 'Bond with an equity option.', sv: 'Obligation med aktieoption.' },
  fields: ['name', 'isin', 'issuer', 'qty', 'price', 'ccy', 'maturity', 'coupon', 'rating', 'beta'],
  required: ['name', 'issuer', 'qty', 'price', 'ccy', 'maturity'],
  risk(p, ctx) {
    const r = bondRisk(p, ctx);        // reuse bond maths for rates/credit
    r.eqDelta = r.mv * 0.4;            // plus some equity sensitivity
    r.beta = p.beta ?? 1;
    return r;
  }
}
```

If you need a new column, add it to `FIELDS` with English/Swedish labels and the header aliases the importer should recognise. For custom import aliases for the type name (e.g. `"CB"`), add them to `TYPE_ALIASES`. The test suite checks that every field a type uses exists and that the templates round-trip.

`risk()` returns base-currency numbers: `mv`, `exposure`, `net`, `assetClass`, `eqDelta`/`beta`, `ir01` per currency, `cs01`, `cmDelta`, `fx` per currency, `vega`, `gamma`, optional `fi` (yield, duration and so on) and `liqDays`. A type that needs full revaluation in stress tests can also define `stressPnl(p, ctx, scenario)`, which the option type does.

## Development

No build step for the app itself. It uses ES modules, so serve the folder over HTTP rather than opening the file directly:

```bash
npm install
npm test          # node:test unit tests (pricing, importer, analytics, translations)
npm run serve     # http://localhost:8000
npm run build     # rebuilds tailwind.css (Options Lab only)
```

The Pages workflow runs the tests, builds Tailwind and deploys on push to `main`.

---

## Svenska

Nexus Portfolio Lab är en gratis portföljanalysplattform för förvaltare, på svenska och engelska. Allt körs i webbläsaren. Innehaven sparas lokalt, ingenting skickas till någon server och det finns inga konton.

- **Innehav** i 15 instrumenttyper, var och en med eget formulär, validering och direkt värdering.
- **Massuppladdning** från Excel, CSV eller inklistrade celler. Semikolon och decimalkomma känns igen, liksom rubriker på svenska och engelska (t.ex. *Värdepapper, Antal, Kurs, Förfallodag*). Läget "Uppdatera befintliga" matchar på ISIN och passar för dagliga kursfiler. Det finns en Excelmall med instruktionsblad.
- **Analys:** exponering, parametrisk och historisk VaR med riskbidrag, räntebärande (duration, DV01, rating, löptider), avkastning mot jämförelseindex, stresstester, likviditet och UCITS-placeringsregler.
- **PDF-rapport** som skapas lokalt, med sammanfattning, förvaltarkommentar, diagram och tabeller.
- **Options Lab**, den tidigare strategivisualiseraren, finns kvar på `options-lab.html`.

Under Inställningar kan du hämta ECB:s referenskurser med ett klick eller ange valutakurser manuellt, justera riskmodellens antaganden och ta en säkerhetskopia (JSON) av alla portföljer.

> **Ansvarsfriskrivning / Disclaimer:** Resultaten är modellberäkningar i informationssyfte och utgör inte investeringsrådgivning. Upphovspersonen tar inget ansvar för fel eller för beslut som fattas utifrån verktyget. *Model estimates for information only, not investment advice. No liability is accepted for errors or for decisions based on this tool.*

© 2026 Anton Ålin. See [LICENSE](LICENSE).
