# Nexus Portfolio Lab

Free portfolio analytics for fund managers, in English and Swedish. It runs entirely in the browser: holdings are stored in `localStorage`, nothing goes to a server, and there are no accounts.

*Svenska nedan.*

## Your data stays inside your organisation

There is no server, no database and no user accounts. Holdings are read from files on the user's own computer or network share, calculated in the browser and stored in the browser and in files the organisation controls. Nothing about a portfolio is sent anywhere. The **connected file** is the recommended way to work for exactly this reason: the browser reads the file where it lies, so the source of truth never leaves the organisation's storage, access control and backup.

The only network requests are downloads of code (the page, Plotly, SheetJS, jsPDF, the Inter font); none carries portfolio data. ECB exchange rates are read from the ECB's own file, downloaded by the user. For zero external requests, host an unmodified copy on an internal web server (the licence allows this) and point the library URLs in `index.html`, `js/importer.js` and `js/report.js` to internal copies.

**Check it yourself.** The source code is public in this repository, so anyone — IT, risk, compliance — can confirm what the platform does and check each formula: every section of *How we calculate* links to the module it describes. Public to read is not open source, though. The [licence](LICENSE) lets anyone use the platform freely, also professionally, host an unmodified copy inside their own organisation and use its output however they like; it may never be sold, modified, built upon or republished.

The in-app **User guide** (`#/guide`, content in [`js/guide.js`](js/guide.js)) explains this in full and walks through every page of the platform in English and Swedish.

## What it does

| Area | Contents |
|---|---|
| **Holdings** | 22 instrument types covering what European institutions trade: equities (incl. preference shares, depositary receipts, rights), ETFs/ETNs (incl. leveraged and inverse), UCITS/AIF funds (incl. money market funds), government, supranational and municipal bonds, **inflation-linked bonds** (index ratio), corporate, covered, hybrid and **callable/perpetual (AT1, Tier 2) bonds** priced to worst, ABS/MBS/CLO, **convertibles** (equity delta), FRNs, T-bills/CP/CDs, cash and term deposits, **repos**, futures (index, bond, **STIR**, commodity, FX, **VIX/VSTOXX**), options (European and **American**, premium or **futures-style**, warrants), **certificates and structured products** (bull/bear, mini futures, turbos, autocalls), FX forwards/swaps/NDFs, interest rate swaps/OIS/FRAs, **cross-currency swaps**, CDS (single-name and index), **equity swaps/CFDs/TRS**, **other OTC derivatives at counterparty MTM** (swaptions, caps/floors, inflation, variance and commodity swaps, exotics), commodities/ETCs and private markets/crypto. Prices in pence (GBp), ZAc and ILA are handled; a type the importer does not recognise is never guessed — the row is held back, unvalued, until it is mapped. |
| **Bulk upload** | CSV, TSV, XLSX/XLS/ODS, or cells pasted from Excel. The date is mandatory: a dated file (date in the first column or a column headed Date/Datum) is split by date and by a Portfolio/Fund/Account column, the chosen date becomes the holdings and every date is kept as a snapshot; an undated file takes its as-of date from the Mandatory datapoints card and is saved as a snapshot of that date. Detects the delimiter, decimal comma vs. decimal point, the header row and column names in English or Swedish. Every row is validated before import. Import modes are *add*, *update existing* (matches on ISIN, then ticker, then name, so a daily ISIN + price file refreshes prices) and *replace*. Downloadable Excel template with an instruction sheet. |
| **Custom file formats** | JSON (records at any depth, nested fields flattened) and XML (the repeating record element is found automatically) next to CSV and Excel. Map any layout by hand: fixed values for fields the file lacks, value scaling (×100, ÷1000, sign flip), per-column date formats, your own type codes (e.g. `EQ_ORD` → Equity, `CASH` → skip), and rows to skip (`Total; Summa`). A **Mandatory datapoints** checklist shows each required field for the instrument types in the file and where it comes from. Save the mapping as an **import template**: it is matched on the column headers, even if the columns are reordered, and applied automatically to the next file. Templates can be downloaded and uploaded as JSON to share with colleagues. |
| **Connected file (live)** | Point the app at a CSV or Excel file on your computer (Chrome/Edge desktop) and it keeps reading it — no uploading. The first column is the date, so one file can hold many days; a *Portfolio / Fund / Account* column (or *Portfölj / Fond / Konto / Depå*) splits it into several portfolios. Each portfolio shows the latest date unless you pin another in the top bar, the prices across dates feed its price history, and the file is re-read every few seconds while the tab is open. The file is only read, never written. A saved import template that matches the headers is used for the mapping. |
| **Price history** | Wide or long price files, merged by date. Holdings are matched by ticker, ISIN or name, or mapped by hand. FX series (`USDSEK` etc.) and a benchmark column are supported. |
| **Exposure** | Market value vs. economic exposure by asset class (the derivative overlay), sector, region, country, instrument type, issuer, currency before and after hedges, top-10 weight, HHI and effective N. |
| **Risk** | Risk contributions by asset class (each class holds its market factor, stock-specific risk, implied vol and the derivatives on that class; currency as its own bucket where hedges net) with the factor detail one click away. Parametric factor VaR/ES (equity, rates per currency, credit, FX, commodities, implied vol, stock-specific risk) and historical VaR/ES, with confidence, horizon and headline method all selectable. Euler risk contributions by factor and by position, factor sensitivities, option Greeks and a correlation matrix. |
| **Fixed income** | Yield, modified and spread duration, convexity, DV01/CS01, portfolio duration including swaps and bond futures, maturity and rating profiles, DV01 ladder and rate risk per currency. |
| **Performance** | Back-cast of current holdings over the loaded history: CAGR, volatility, Sharpe, Sortino, max drawdown, Calmar, VaR/ES, skew/kurtosis, and against a benchmark beta, alpha, tracking error, information ratio and up/down capture. Also rolling volatility, drawdown chart, a monthly return table and a 3D risk–return map (return × volatility × risk contribution per position, sized by exposure). |
| **Changes & track record** | Holdings compared between any two dates (a connected file's dates, or snapshots you save): holdings-based return, NAV change, estimated net flows, turnover, key figures and limits before/after, and each holding's move split into price and trade effect. A chained, holdings-based track record with contributors and detractors. |
| **Pre-trade** | Hypothetical trades (target weight, quantity change, or a new instrument) funded from a chosen cash account, with risk, duration, liquidity and every limit before and after. Apply them to the holdings in one click, with undo. |
| **Attribution** | Brinson-Fachler allocation, selection and interaction per asset class, sector, region, country or currency against benchmark segment weights and returns you paste or upload. |
| **Stress tests** | 11 scenarios (GFC 2008, euro crisis 2011, Covid 2020, 2022 rate shock, parallel rate and spread shifts, base-currency moves, stagflation) plus a custom scenario built with sliders. Options are fully repriced. |
| **Liquidity** | Days-to-liquidate from average daily volume and a participation rate, or type defaults and notice periods. Pro-rata liquidation profile under normal and stressed conditions. Liquidity stress test in line with ESMA's guidelines: redemption shocks, coverage ratio, and the portfolio left behind (most-liquid-first and pro-rata) re-checked against the limits. |
| **Compliance** | UCITS-style limits: single issuer, 5/10/40, government issuers, bank deposits, single fund, derivative commitment, OTC counterparty, 7-day liquidity and illiquid assets, plus optional internal limits. Every limit can be switched on or off and edited. A limit history over all snapshots classes each breach as active (caused by a trade) or passive (caused by the market). |
| **Cost basis & P&L** | Average cost per position from a transaction log (buys and sells with fees and trade-day FX; average-cost method, shorts handled) or from a cost price on the position. Unrealised P&L against today's value with the FX effect split out, realised P&L year-to-date / 12 months / all time, transaction import from CSV/Excel with Swedish or English headers, and a reconciliation flag when the log does not add up to the held quantity. |
| **Asset allocation & derivatives** | Economic exposure per asset class (holdings plus the derivative overlay, mixed funds split by equity share), sunburst/treemap of class → group → holding, mandate targets and ranges. A derivatives page with notional, delta and commitment by underlying, and a model-vs-reported reconciliation: reported notional, delta or delta-adjusted exposure from your broker/custodian file are used when present and flagged when they disagree with the model. |
| **Fund calculations** | Cash-flow and expiry calendar (coupons, redemptions, FX settlements, swap and CDS payments, option and future expiries; CSV and .ics export), UCITS SRRI and PRIIPs SRI (category 2, Cornish-Fisher VEV) from the price history, and an indicative NAV per unit per share class with fee accrual and a subscription/redemption simulator. |
| **PDF report** | Multi-page A4 PDF generated locally with jsPDF: summary tiles, commentary, charts and tables for each section, and a disclaimer. |
| **How we calculate** | A page listing every formula on the site, the simplifications made and the inputs each calculation reads, with the source module named. |
| **User guide** | Complete instructions in the app: data privacy, getting started, the connected file, bulk upload and templates, every analytics page, the PDF report, settings and backups, and troubleshooting. |
| **Options Lab** | The original strategy visualiser (payoff, Greeks, vol surface, Monte Carlo and more) is at `options-lab.html`. It is Swedish only for now. |

### Where the data lives

Everything is kept in the browser's `localStorage`. Two ways to keep it somewhere safer:

- **Linked file (Settings).** In Chrome and Edge on desktop the workspace can be linked to a file on your computer through the File System Access API. Three steps: choose a format and click *Create and link a file…*; save it in a folder that is backed up or synced (OneDrive, Dropbox, a network share); keep working — every change is written about a second later, and after a browser restart one click on *Reconnect* is enough. On another computer, *Link an existing file…* loads it. Formats: a JSON file (the whole workspace, lossless — put it on a synced drive or a backed-up folder), or a CSV/Excel file with the active portfolio's positions in the same layout the bulk upload reads. Every change is written about a second later; the file is reconnected after a reload (the browser asks for permission once per session). If the JSON file was changed elsewhere, a banner offers to load it instead of overwriting it.
- **Backup files.** *Download backup* saves a JSON of all portfolios; the sidebar shows how old the last backup is and an automatic backup is downloaded daily, weekly or monthly (Settings) when none is linked. *Restore from backup* merges a file back in.

### Third-party libraries

Plotly (charts) loads from jsDelivr when the page opens; jsPDF and jspdf-autotable load only when you export a PDF. All three are pinned to exact versions and verified with Subresource Integrity hashes taken from the npm packages, so a tampered CDN file is refused. SheetJS 0.20.3 (Excel import/export, loaded on demand) is only published on `cdn.sheetjs.com` and its hash is left empty in `js/importer.js` (`XLSX_SRI`); fill it in with `openssl dgst -sha384 -binary xlsx.full.min.js | openssl base64 -A` on the file you verified.

### Browser support

Tested in Chromium. The code uses ES2021 (`??`, `||=`, optional chaining) and `color-mix()` for accent colours, so it needs Safari 16.2+, Firefox 113+, Chrome/Edge 111+; older browsers lose only the tinted borders. The linked-file feature is Chrome/Edge desktop only; other browsers get the backup buttons.

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

## Authorship

Developed by Anton Ålin with the help of AI. The product idea, requirements, structure, design choices and texts are his; much of the code was written with an AI coding assistant under his direction and review. The commit history shows how it was built.

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

- **Innehav** i 22 instrumenttyper som täcker det europeiska institutioner handlar — från aktier, fonder och obligationer (även realränte-, konvertibla och eviga AT1) till terminer (även STIR och VIX), amerikanska optioner, certifikat och strukturerade produkter, repor, CFD:er och aktieswappar, valutaränteswappar och övriga OTC-derivat till motpartens marknadsvärde. Var och en med eget formulär, validering och direkt värdering; en okänd instrumenttyp gissas aldrig.
- **Massuppladdning** från Excel, CSV eller inklistrade celler. Semikolon och decimalkomma känns igen, liksom rubriker på svenska och engelska (t.ex. *Värdepapper, Antal, Kurs, Förfallodag*). Läget "Uppdatera befintliga" matchar på ISIN och passar för dagliga kursfiler. Det finns en Excelmall med instruktionsblad.
- **Analys:** exponering, parametrisk och historisk VaR med riskbidrag, räntebärande (duration, DV01, rating, löptider), avkastning mot jämförelseindex, stresstester, likviditet och UCITS-placeringsregler.
- **Anskaffningsvärde och resultat:** genomsnittligt anskaffningsvärde per innehav från en transaktionslogg (köp/sälj med courtage och affärsdagens valutakurs, genomsnittsmetoden) eller från en anskaffningskurs på innehavet; orealiserat resultat med valutaeffekt, realiserat resultat per period och import av transaktioner från fil.
- **Tillgångsfördelning och derivat:** ekonomisk exponering per tillgångsslag med derivatöverlägg, mandatintervall, samt avstämning av rapporterat nominellt värde och delta (från mäklar-/depåfil) mot modellen.
- **Fondberäkningar:** kassaflödeskalender med .ics-export, riskklass (UCITS SRRI och PRIIPs SRI) och indikativt NAV per andel med simulering av teckning och inlösen.
- **Daglig uppföljning:** förändringar mellan två datum (avkastning, flöden, omsättning, nyckeltal och regler före/efter), innehavsbaserad historik, pre-trade-analys av tänkta affärer, Brinson-attribution mot jämförelseindex, likviditetsstresstest enligt ESMA:s riktlinjer och regelhistorik med aktiva och passiva brott.
- **PDF-rapport** som skapas lokalt, med sammanfattning, förvaltarkommentar, diagram och tabeller.
- **Så räknar vi:** en sida som redovisar varje formel, förenkling och indata bakom siffrorna.
- **Kopplad källfil (live):** peka ut en CSV- eller Excelfil på datorn så läser appen den löpande. Första kolumnen är datum, så en fil kan rymma många dagar; en kolumn *Portfölj / Fond / Konto / Depå* delar upp den i flera portföljer. Senaste datum visas om du inte väljer ett annat i toppraden.
- **Kopplad fil:** i Chrome/Edge kan arbetsytan kopplas till en fil på datorn (JSON, CSV eller Excel) som skrivs automatiskt vid varje ändring. Sidofältet visar hur gammal senaste säkerhetskopian är, och en automatisk säkerhetskopia laddas ner dagligen, veckovis eller månadsvis.
- **Din data stannar inom organisationen:** ingen server, ingen databas, inga konton. Filer läses där de ligger och allt beräknas i webbläsaren; ingen portföljdata skickas någonstans.
- **Användarguide** i appen med fullständiga instruktioner på svenska och engelska.
- **Options Lab**, den tidigare strategivisualiseraren, finns kvar på `options-lab.html`.

Under Inställningar kan du läsa in ECB:s referenskurser från ECB:s egen fil eller ange valutakurser manuellt, justera riskmodellens antaganden och ta en säkerhetskopia (JSON) av alla portföljer.

> **Ansvarsfriskrivning / Disclaimer:** Resultaten är modellberäkningar i informationssyfte och utgör inte investeringsrådgivning. Upphovspersonen tar inget ansvar för fel eller för beslut som fattas utifrån verktyget. *Model estimates for information only, not investment advice. No liability is accepted for errors or for decisions based on this tool.*

Utvecklad av Anton Ålin med hjälp av AI.

© 2026 Anton Ålin. Free to use, also professionally; not for sale, modification or republication. See [LICENSE](LICENSE).
