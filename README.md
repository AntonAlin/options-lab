# Nexus Portfolio Lab

[![CI](https://github.com/AntonAlin/options-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/AntonAlin/options-lab/actions/workflows/ci.yml) [![CodeQL](https://github.com/AntonAlin/options-lab/actions/workflows/codeql.yml/badge.svg)](https://github.com/AntonAlin/options-lab/actions/workflows/codeql.yml) [![Release](https://img.shields.io/github/v/release/AntonAlin/options-lab?include_prereleases&label=release)](https://github.com/AntonAlin/options-lab/releases)

Free portfolio analytics for fund managers. It runs entirely in the browser: holdings are stored in the browser's IndexedDB, nothing goes to a server, and there are no accounts.

## Your data stays inside your organisation

There is no server, no database and no user accounts. Holdings are read from files on the user's own computer or network share, calculated in the browser and stored in the browser and in files the organisation controls. Nothing about a portfolio is sent anywhere. The **connected file** is the recommended way to work for exactly this reason: the browser reads the file where it lies, so the source of truth never leaves the organisation's storage, access control and backup.

The only network requests are downloads of code (the page, Plotly, SheetJS, jsPDF, the Inter font) and of one public data file from the site itself, `data/market.json` (ECB exchange rates and the euro curve); none carries portfolio data. For zero external requests, use the **offline zip** from a [release](https://github.com/AntonAlin/options-lab/releases) — every library bundled, no web fonts — on an internal web server (the licence allows this).

**Check it yourself.** The source code is public in this repository, so anyone — IT, risk, compliance — can confirm what the platform does and check each formula: every section of *How we calculate* links to the module it describes. Public to read is not open source, though. The [licence](LICENSE) lets anyone use the platform freely, also professionally, host an unmodified copy inside their own organisation and use its output however they like; it may never be sold, modified, built upon or republished.

The in-app **User guide** (`#/guide`, content in [`js/guide.js`](js/guide.js)) explains this in full and walks through every page of the platform.

## What it does

| Area | Contents |
|---|---|
| **Holdings** | 27 instrument types covering what European institutions trade: equities (incl. preference shares, depositary receipts, rights), ETFs/ETNs (incl. leveraged and inverse), UCITS/AIF funds (incl. money market funds), government, supranational and municipal bonds, **inflation-linked bonds** (index ratio), corporate, covered, hybrid and **callable/perpetual (AT1, Tier 2) bonds** priced to worst, ABS/MBS/CLO (**amortising with prepayment speed and WAL**), **convertibles** (equity delta), FRNs, T-bills/CP/CDs, cash and term deposits, **repos** (collateral and haircut), **securities lending** (counterparty exposure after collateral), futures (index, bond, **STIR**, commodity, FX, **VIX/VSTOXX**), options (European and **American**, premium or **futures-style**, warrants), **certificates and structured products** (bull/bear, **mini futures and turbos with knock-out**, capital protected; autocalls at market price with the issuer's delta), FX forwards/swaps/NDFs, interest rate swaps/OIS/FRAs, **cross-currency swaps**, CDS (single-name and index), **equity swaps/CFDs/TRS**, **swaptions and caps/floors** (Bachelier or Black), **zero-coupon inflation swaps** (own breakeven-inflation risk factor), **barrier and digital options**, other OTC derivatives at counterparty MTM (Asian, lookback, basket, variance, volatility and correlation swaps), commodities/ETCs and private markets/crypto. Prices in pence (GBp), ZAc and ILA are handled; a type the importer does not recognise is never guessed — the row is held back, unvalued, until it is mapped. |
| **Bulk upload** | CSV, TSV, XLSX/XLS/ODS, or cells pasted from Excel. The date is mandatory: a dated file (date in the first column or a column headed Date/Datum) is split by date and by a Portfolio/Fund/Account column, the chosen date becomes the holdings and every date is kept as a snapshot; an undated file takes its as-of date from the Mandatory datapoints card and is saved as a snapshot of that date. Detects the delimiter, decimal comma vs. decimal point, the header row and column names in English or Swedish. Every row is validated before import. Import modes are *add*, *update existing* (matches on ISIN, then ticker, then name, so a daily ISIN + price file refreshes prices) and *replace*. Downloadable Excel template with an instruction sheet. Columns and type codes the importer does not recognise get a suggestion from a small model shipped with the site (logistic regression on character n-grams and value shapes, trained by `scripts/train-import-model.mjs` on the field registry only — never on user files); nothing is mapped until accepted. **Data checks** compare every file with the current holdings (robust z-scores on each holding's history, or the file's cross-section) and flag unit errors, scaled quantities, price jumps, stale or missing prices, changed currencies and large holdings gone. |
| **Custom file formats** | JSON (records at any depth, nested fields flattened) and XML (the repeating record element is found automatically) next to CSV and Excel. Map any layout by hand: fixed values for fields the file lacks, value scaling (×100, ÷1000, sign flip), per-column date formats, your own type codes (e.g. `EQ_ORD` → Equity, `CASH` → skip), and rows to skip (`Total; Summa`). A **Mandatory datapoints** checklist shows each required field for the instrument types in the file and where it comes from. Save the mapping as an **import template**: it is matched on the column headers, even if the columns are reordered, and applied automatically to the next file. Templates can be downloaded and uploaded as JSON to share with colleagues. |
| **Connected file (live)** | Point the app at a CSV or Excel file on your computer (Chrome/Edge desktop) and it keeps reading it — no uploading. The first column is the date, so one file can hold many days; a *Portfolio / Fund / Account* column (or *Portfölj / Fond / Konto / Depå*) splits it into several portfolios. Each portfolio shows the latest date unless you pin another in the top bar, the prices across dates feed its price history, and the file is re-read every few seconds while the tab is open. The file is only read, never written. A saved import template that matches the headers is used for the mapping. |
| **Price history** | Wide or long price files, merged by date. Holdings are matched by ticker, ISIN or name, or mapped by hand. FX series (`USDSEK` etc.) and a benchmark column are supported. |
| **Exposure** | Market value vs. economic exposure by asset class (the derivative overlay), sector, region, country, instrument type, issuer, currency before and after hedges, top-10 weight, HHI and effective N. |
| **Risk** | Risk contributions by asset class (each class holds its market factor, stock-specific risk, implied vol and the derivatives on that class; currency as its own bucket where hedges net) with the factor detail one click away. Parametric factor VaR/ES (equity per region, rates per currency, credit IG and HY, FX, commodities, implied vol, stock-specific risk), historical VaR/ES and EWMA VaR (RiskMetrics, λ = 0.94), plus statistical risk drivers: principal components of the positions' P&L with Ledoit-Wolf shrinkage and each component's share of portfolio variance, with confidence, horizon and headline method all selectable. Euler risk contributions by factor and by position, factor sensitivities, option Greeks and a correlation matrix. |
| **Fixed income** | Yield, modified and spread duration, convexity, DV01/CS01, portfolio duration including swaps and bond futures, maturity and rating profiles, DV01 ladder and rate risk per currency. |
| **Performance** | Back-cast of current holdings over the loaded history: CAGR, volatility, Sharpe, Sortino, max drawdown, Calmar, VaR/ES, skew/kurtosis, and against a benchmark beta, alpha, tracking error, information ratio and up/down capture. Also rolling volatility, drawdown chart, a monthly return table. |
| **Changes & track record** | Holdings compared between any two dates (a connected file's dates, or snapshots you save): holdings-based return, NAV change, estimated net flows, turnover, key figures and limits before/after, and each holding's move split into price and trade effect. A chained, holdings-based track record with contributors and detractors. |
| **Pre-trade** | Hypothetical trades (target weight, quantity change, or a new instrument) funded from a chosen cash account, with risk, duration, liquidity and every limit before and after. Apply them to the holdings in one click, with undo. |
| **Attribution** | Brinson-Fachler allocation, selection and interaction per asset class, sector, region, country or currency against benchmark segment weights and returns you paste or upload. |
| **Stress tests** | 11 scenarios (GFC 2008, euro crisis 2011, Covid 2020, 2022 rate shock, parallel rate and spread shifts, base-currency moves, stagflation) plus a custom scenario built with sliders. Options are fully repriced. |
| **Liquidity** | Days-to-liquidate from average daily volume and a participation rate, or type defaults and notice periods. Pro-rata liquidation profile under normal and stressed conditions. Liquidity stress test in line with ESMA's guidelines: redemption shocks, coverage ratio, and the portfolio left behind (most-liquid-first and pro-rata) re-checked against the limits. |
| **Compliance** | UCITS-style limits: single issuer, 5/10/40, government issuers, bank deposits, single fund, derivative commitment, OTC counterparty, 7-day liquidity and illiquid assets, plus optional internal limits. Every limit can be switched on or off and edited. A limit history over all snapshots classes each breach as active (caused by a trade) or passive (caused by the market). |
| **Fund rules** | The fund's own investment restrictions as rules: market value, economic exposure, largest holding or group, count or duration of the holdings that match conditions on asset class, type, region, country, sector, currency, issuer, strategy or rating, with a ≤ or ≥ limit. Checked with the UCITS limits: dashboard, pre-trade, breach history (active/passive) and PDF. |
| **Global exposure** | Commitment approach or VaR approach (absolute VaR ≤ 20 % of NAV, or relative VaR ≤ 2× a reference portfolio given as a price series), 99 %, 20 days, from historical simulation or EWMA; the VaR limit replaces the commitment limit in compliance. Backtest of the 1-day VaR over 250 days with Kupiec's test and the traffic-light zones. |
| **Liquidity tools** | The fund's selected liquidity management tools checked against the minimum; swing pricing / anti-dilution calibration from trading costs and square-root market impact (swing factor, dilution, threshold, stressed, cap); redemption gates against the liquidity profile. |
| **Cost basis & P&L** | Average cost per position from a transaction log (buys and sells with fees and trade-day FX; average-cost method, shorts handled) or from a cost price on the position. Unrealised P&L against today's value with the FX effect split out, realised P&L year-to-date / 12 months / all time, transaction import from CSV/Excel with Swedish or English headers, and a reconciliation flag when the log does not add up to the held quantity. |
| **Asset allocation & derivatives** | Economic exposure per asset class (holdings plus the derivative overlay, mixed funds split by equity share), sunburst/treemap of class → group → holding, mandate targets and ranges. A derivatives page with notional, delta and commitment by underlying, and a model-vs-reported reconciliation: reported notional, delta or delta-adjusted exposure from your broker/custodian file are used when present and flagged when they disagree with the model. |
| **Fund calculations** | Cash-flow and expiry calendar (coupons, redemptions, FX settlements, swap and CDS payments, option and future expiries; CSV and .ics export) and an indicative NAV per unit per share class with fee accrual and a subscription/redemption simulator. |
| **PDF report** | Multi-page A4 PDF generated locally with jsPDF: summary tiles, commentary, charts and tables for each section, and a disclaimer. |
| **How we calculate** | A page listing every formula on the site, the simplifications made and the inputs each calculation reads, with the source module named. |
| **User guide** | Complete instructions in the app: data privacy, getting started, the connected file, bulk upload and templates, every analytics page, the PDF report, settings and backups, and troubleshooting. |

### Regulation: an interpretation, not advice

Regulation is updated continuously by lawmakers, ESMA and national supervisors. The UCITS limits, the VaR approach to global exposure and the liquidity management tools are built on the developer's own reading of the rules as of September 2026 (UCITS Directive 2009/65/EC, CESR/10-788, Directive (EU) 2024/927 and ESMA's guidelines and RTS on liquidity management tools). That reading is an opinion on how the rules can be interpreted. It is not legal advice and it may be incomplete, out of date or wrong. Every page that relies on it says so. Check against the current rules, the fund's own documents and your compliance function.

### Where the data lives

Everything is kept in the browser's IndexedDB, one record per portfolio, so the space is not limited to the roughly 5 MB of `localStorage` (which is used only where IndexedDB is unavailable; a workspace saved there by an older version is moved over on first start). The app asks the browser to keep the data persistent, and Settings shows how much space is used. Two ways to keep it somewhere safer:

- **Linked file (Settings).** In Chrome and Edge on desktop the workspace can be linked to a file on your computer through the File System Access API. Three steps: choose a format and click *Create and link a file…*; save it in a folder that is backed up or synced (OneDrive, Dropbox, a network share); keep working — every change is written about a second later, and after a browser restart one click on *Reconnect* is enough. On another computer, *Link an existing file…* loads it. Formats: a JSON file (the whole workspace, lossless — put it on a synced drive or a backed-up folder), or a CSV/Excel file with the active portfolio's positions in the same layout the bulk upload reads. Every change is written about a second later; the file is reconnected after a reload (the browser asks for permission once per session). If the JSON file was changed elsewhere, a banner offers to load it instead of overwriting it.
- **Backup files.** *Download backup* saves a JSON of all portfolios; the sidebar shows how old the last backup is and an automatic backup is downloaded daily, weekly or monthly (Settings) when none is linked. *Restore from backup* merges a file back in.

### Third-party libraries

Plotly (charts) loads from jsDelivr when the page opens; jsPDF and jspdf-autotable load only when you export a PDF. All three are pinned to exact versions and verified with Subresource Integrity hashes taken from the npm packages, so a tampered CDN file is refused. SheetJS 0.20.3 (Excel import/export, loaded on demand) is only published on `cdn.sheetjs.com`; its hash is pinned in `js/importer.js` (`XLSX_SRI`). The release build, which CI runs on every push, downloads all four libraries from their CDNs and fails if a hash does not match or a CDN stops sending the CORS header the integrity check needs.

### Browser support

Tested in Chromium. The code uses ES2021 (`??`, `||=`, optional chaining) and `color-mix()` for accent colours, so it needs Safari 16.2+, Firefox 113+, Chrome/Edge 111+; older browsers lose only the tinted borders. The linked-file feature is Chrome/Edge desktop only; other browsers get the backup buttons.

## Adding an instrument type

Everything is driven by the registry in [`js/instruments.js`](js/instruments.js): forms, templates, column mapping, validation, the holdings table and all analytics. A new type is **one object**:

```js
// js/instruments.js → INSTRUMENTS
convertible: {
  en: 'Convertible bond', group: 'fixed_income', icon: 'CNV',
  hint: { en: 'Bond with an equity option.' },
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

If you need a new column, add it to `FIELDS` with an English label and the header aliases (English and Swedish column names) the importer should recognise. For custom import aliases for the type name (e.g. `"CB"`), add them to `TYPE_ALIASES`. The test suite checks that every field a type uses exists and that the templates round-trip.

`risk()` returns base-currency numbers: `mv`, `exposure`, `net`, `assetClass`, `eqDelta`/`beta`, `ir01` per currency, `cs01`, `cmDelta`, `fx` per currency, `vega`, `gamma`, optional `fi` (yield, duration and so on) and `liqDays`. A type that needs full revaluation in stress tests can also define `stressPnl(p, ctx, scenario)`, which the option type does.

## Authorship

Developed by Anton Ålin with the help of AI. The product idea, requirements, structure, design choices and texts are his; much of the code was written with an AI coding assistant under his direction and review. The commit history shows how it was built.

## Market data

A scheduled GitHub Action (`pages.yml`, every business day at 15:35 UTC, after the ECB publishes around 16:00 CET) runs `scripts/market-data.mjs`. It downloads the ECB euro reference rates for the last 90 days, the ECB euro area AAA government spot curve and €STR, and from the Riksbank's open API the Swedish treasury bill and benchmark government bond yields and SWESTR. It validates them (ranges, completeness, age) and publishes `data/market.json` with the site. An ECB download that fails validation is never published; the previous file stays. A Riksbank download that fails only leaves the SEK curve out. In the app:

- Portfolios on the placeholder or published rates get the ECB rates for their own valuation date. Rates typed in or imported from your own ECB file are never overwritten. Settings has a switch to turn the automatic update off.
- EUR positions without their own rate are discounted on the EUR curve (€STR + AAA curve), SEK positions on the SEK curve (SWESTR + treasury bills + government bond yields): options and structured products, IRS annuities, swaptions, caps/floors, inflation swaps.
- EUR and SEK fixed-rate bonds show their spread over their government curve (a G-spread) on Fixed income.

Sources: European Central Bank; Sveriges Riksbank. GitHub pauses scheduled workflows after 60 days without activity in the repository; re-enable it under Actions if that happens.

## Quality, releases and security

- **CI** (`ci.yml`) on every push and pull request: unit tests, a browser smoke test that opens every page and fails on any script error or NaN, a download-and-validate run of the ECB and Riksbank data, and a dry run of the release packaging.
- **Releases** (`release.yml`): push a tag such as `v1.0.0`. The workflow builds two zips — the site as published, and an offline version with Plotly, SheetJS and jsPDF bundled (checked against their integrity hashes) and no web fonts — and attaches a signed build provenance attestation. Verify with `gh attestation verify nexus-portfolio-lab-v1.0.0-offline.zip --repo AntonAlin/options-lab`.
- **CodeQL** (`codeql.yml`) scans the JavaScript on every change to `main` and weekly.
- **Issues** use templates that ask for made-up numbers only — never real holdings. Security problems go through private reporting; see [SECURITY.md](SECURITY.md).

## Development

No build step and no dependencies. It uses ES modules, so serve the folder over HTTP rather than opening the file directly:

```bash
npm test          # node:test unit tests (pricing, importer, analytics, texts)
node scripts/train-import-model.mjs      # retrain the import suggestion model after changing FIELDS or TYPE_ALIASES
npm run serve     # http://localhost:8000
node tests/smoke.mjs                      # browser smoke test (needs Playwright)
node scripts/market-data.mjs --check      # download and validate the ECB data
bash scripts/build-release.sh v0 --no-download   # packaging dry run into dist/
```

The Pages workflow runs the tests, fetches the ECB data and deploys on push to `main` and every business day.

> **Disclaimer:** Model estimates for information only, not investment advice. No liability is accepted for errors or for decisions based on this tool.

© 2026 Anton Ålin. Free to use, also professionally; not for sale, modification or republication. See [LICENSE](LICENSE).
