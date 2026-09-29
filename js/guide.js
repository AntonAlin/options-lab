// The user guide: how to work the platform, page by page. Plain data like methodology.js — the
// Guide page renders it and the test checks that every block has text.
//
// Section: { id, title, intro?, blocks: [...] }. Block kinds, all texts as { en, sv }:
//   { h }              subheading
//   { p }              paragraph
//   { steps: [...] }   numbered steps
//   { list: [...] }    bullet list
//   { note, tone }     highlighted box; tone 'ok' | 'warn' | 'info'
//   { code }           monospace example (not translated)
//   { link: 'route', label } button to a page of the app
//   { href, label }    button to an external page (opens in a new tab)

export const REPO_URL = 'https://github.com/AntonAlin/options-lab';

export const GUIDE = [
  {
    id: 'privacy',
    title: { en: 'Your data stays inside your organisation' },
    blocks: [
      { note: { en: 'Nexus Portfolio Lab has no server, no database and no user accounts. Holdings, transactions and prices are read, calculated and stored on the computer you are using. Nothing about your portfolios is ever sent to us or to anyone else.' }, tone: 'ok' },
      { p: { en: 'That is a design choice, not a setting: the platform is built so that portfolio data has nowhere to go. It is the reason the platform works the way it does.' } },
      { h: { en: 'How it is done' } },
      { list: [
        { en: 'Every calculation runs in your browser. Valuation, VaR, stress tests, compliance and the PDF report are computed by code on your own computer.' },
        { en: 'The connected file is read where it lies. The browser reads your holdings file directly from your disk or your organisation\'s network share. It is not uploaded anywhere — the file never leaves the machine, and the original stays under your organisation\'s access rights, backup and audit trail. That is why a connected file is the recommended way to work.' },
        { en: '“Upload” in Bulk upload only means reading a file into this browser. Nothing is transmitted.' },
        { en: 'The workspace is kept in the browser\'s local storage on this computer, and in files you choose to save (linked file, backups, exports, PDFs).' }
      ] },
      { h: { en: 'What does go over the network — and why it carries no portfolio data' } },
      { list: [
        { en: 'Loading the page itself, the Inter font (Google Fonts) and code libraries from public CDNs: Plotly for charts, SheetJS when you read or write Excel, jsPDF when you export a PDF. These are downloads of code; nothing is sent with them. Plotly and jsPDF are pinned to exact versions and checked with integrity hashes.' },
        { en: 'One public data file from the site itself: data/market.json, the ECB exchange rates and euro yield curve that a scheduled job publishes with the site every business day. The browser only downloads it; the request carries nothing about you or your portfolios, and it goes to the same address as the page. Nothing else — and you can switch the automatic update off in Settings and import the ECB file by hand instead.' }
      ] },
      { h: { en: 'Your part: keep the files inside the organisation' } },
      { p: { en: 'Where you save files decides where the data is. The platform cannot see that for you.' } },
      { list: [
        { en: 'Keep the connected file, the linked file and backups on storage your organisation controls: a network share, the company OneDrive/SharePoint or another approved location — not a personal cloud account or a USB stick.' },
        { en: 'The automatic backup is saved to your Downloads folder. Move it to approved storage, or turn it off in Settings if a linked file already covers you.' },
        { en: 'PDF reports and CSV/Excel exports are ordinary files. Treat them like any other client or fund document.' },
        { en: 'On a shared computer, use “Delete everything” in Settings when you are done, or use your own browser profile.' }
      ] },
      { h: { en: 'Check it yourself: the source code is public' } },
      { p: { en: 'You do not have to take our word for any of this. The complete source code is public on GitHub, so your IT department, risk function or compliance can read exactly what the platform does, confirm that no portfolio data is sent anywhere, and check every formula on “How we calculate” — each module named there links to its file.' } },
      { p: { en: 'Public to read is not the same as open source. The licence lets anyone use the platform freely — at work too, with any number of users — host an unmodified copy internally and use the reports and analyses it produces however they like. It may never be sold, modified, built upon or republished (see LICENSE in the repository).' } },
      { href: REPO_URL, label: { en: 'View the source code on GitHub' } },
      { h: { en: 'For IT: running with no external requests at all' } },
      { p: { en: 'The platform is a folder of static files with no back end, and the licence allows your organisation to host an unmodified copy on an internal web server. The one change allowed is pointing the library addresses (in index.html, js/importer.js and js/report.js) and the font link to internal copies. After that the site makes no outbound requests at all.' } },
      { p: { en: 'Easier still: every release on GitHub has an offline zip with all libraries bundled and no web fonts, so it makes no outbound request at all. Each zip carries a signed build provenance attestation — `gh attestation verify <file> --repo AntonAlin/options-lab` proves it was built by the repository\'s own workflow from the tagged source, unchanged. Every change is also tested automatically (unit tests, a browser test of every page, CodeQL security scanning); SECURITY.md says how to report a problem privately.' } },
      { href: REPO_URL + '/releases', label: { en: 'Releases and offline zips' } },
    ]
  },
  {
    id: 'start',
    title: { en: 'Getting started' },
    blocks: [
      { p: { en: 'Open the site in Chrome or Edge on a desktop computer — that is where every feature works, including the connected file. Firefox and Safari work too, but without the connected or linked file.' } },
      { steps: [
        { en: 'Switch between light and dark theme in the top bar.' },
        { en: 'Try the demo fund first if you want to see every page filled in: “Explore the demo fund” on the start page, or ⋮ → Load demo portfolio.' },
        { en: 'Get your own holdings in: connect a file (recommended), upload one, or start an empty portfolio with “New” and add instruments by hand. See the next section.' },
        { en: 'Check the base currency and FX rates in Settings. Download the ECB reference rates file from the ECB and import it; the fallback rates are placeholders.' },
        { en: 'Load price history if you want performance, historical VaR and correlations.' }
      ] },
      { h: { en: 'The top bar' } },
      { list: [
        { en: 'Portfolio selector: every portfolio in the workspace. “New” creates one; ⋮ renames, duplicates, exports as JSON, loads the demo or deletes.' },
        { en: 'Valuation date: the date bonds, options and swaps are valued at. Empty means today. For a portfolio fed by a connected file this becomes “Snapshot”: the date in the file you are looking at.' },
        { en: 'The chip next to it is the base currency; change it in Settings.' }
      ] },
      { p: { en: 'Ctrl+Z (⌘Z) undoes the last change to holdings or settings. The sidebar footer always shows where your data is saved and how old the last backup is.' } }
    ]
  },
  {
    id: 'connect',
    title: { en: 'Connected file — the recommended way to work' },
    blocks: [
      { note: { en: 'The browser reads the file directly from your computer or network share and never sends it anywhere. The file stays where your organisation keeps it, and the platform follows it.' }, tone: 'ok' },
      { h: { en: 'The file' } },
      { p: { en: 'CSV or Excel (.xlsx, .xls), one row per holding per date, with a header row. Title rows above the header are fine.' } },
      { list: [
        { en: 'First column: the date the row applies to — 2026-09-29, 29.09.2026, 20260929 or an Excel date. Rows without a date (totals, notes) are skipped and counted.' },
        { en: 'Optional portfolio column: Portfolio, Fund, Account, Mandate, Client (or Portfölj, Fond, Konto, Depå, Mandat, Kund). Each value becomes its own portfolio. Without it, the whole file is one portfolio named after the file.' },
        { en: 'The other columns as in Bulk upload: name, ISIN, ticker, type, quantity, price, currency, maturity, coupon and so on, with English or Swedish headers.' }
      ] },
      { p: { en: 'Example:' } },
      { code: 'Date;Portfolio;Name;ISIN;Type;Quantity;Price;Currency\n2026-09-28;Fund A;Volvo B;SE0000115446;Equity;1000;250,5;SEK\n2026-09-28;Fund B;Apple;US0378331005;Equity;10;230;USD\n2026-09-29;Fund A;Volvo B;SE0000115446;Equity;1200;255;SEK\n2026-09-29;Fund B;Apple;US0378331005;Equity;12;232;USD' },
      { h: { en: 'Connecting' } },
      { steps: [
        { en: 'Go to Bulk upload (or Settings, or the start page) and click “Connect a file…”.' },
        { en: 'Pick the file. The browser asks once for permission to read it.' },
        { en: 'One portfolio per value in the portfolio column appears in the portfolio selector, each showing its latest date.' }
      ] },
      { h: { en: 'Day to day' } },
      { list: [
        { en: 'Save the file as usual (from Excel, your PMS or the custodian export). The platform checks it every few seconds while the tab is visible, and when you return to the tab. New dates and new portfolios appear on their own.' },
        { en: '“Snapshot” in the top bar picks the date. “Latest” follows new dates; pick an older date to pin it (“date pinned”). Pick “Latest” again to follow the file.' },
        { en: 'Prices across the dates in the file are added to each portfolio\'s price history, so performance and historical risk build up as the file grows.' },
        { en: 'Holdings in a connected portfolio are replaced whenever the file changes. Correct the file, not the Holdings page.' },
        { en: 'After a browser restart a banner asks you to click “Reconnect” — the browser requires fresh permission once per session.' },
        { en: '“Disconnect” stops following the file. The portfolios stay with the data they have. Connecting the same file again picks them up.' }
      ] },
      { h: { en: 'When the columns are not recognised' } },
      { p: { en: 'Load the same file once in Bulk upload, map the columns and save an import template. The connected file uses a matching template automatically (the card says which one). Rows with validation errors are kept and flagged on the Holdings page, so nothing disappears silently.' } },
      { link: 'import', label: { en: 'Go to Bulk upload' } }
    ]
  },
  {
    id: 'upload',
    title: { en: 'Bulk upload and import templates' },
    blocks: [
      { p: { en: 'For one-off files: CSV, TSV, Excel (xlsx, xls, ods), JSON, XML, or cells pasted from Excel. The file is read in this browser only.' } },
      { note: { en: 'The date is mandatory. A file whose first column (or a column headed Date / Datum) holds the date is split by date — and by a Portfolio / Fund / Account column if there is one — so ten month-ends of three funds become three portfolios with ten dated snapshots each, never one stacked list. Pick which date becomes the holdings (the latest by default); the other dates are kept as history. A file without a date column needs its “Date (holdings as of)” set in Mandatory datapoints, and every import is saved as a snapshot of that date.' }, tone: 'info' },
      { steps: [
        { en: 'Drop the file on “Choose a file” or click it. Delimiter, decimal comma and header row are detected.' },
        { en: 'Check the column mapping. Each column shows sample values; pick the field it holds or “ignore”. Number columns can be scaled (×100, ÷1000, sign flip); date columns can have their own format.' },
        { en: '“Mandatory datapoints” lists every required field for the instrument types in the file and where it comes from. Fill a missing one with a fixed value for all rows.' },
        { en: 'Map your own type codes (e.g. EQ_ORD → Equity, CASH_ACC → skip) under “Instrument type codes”.' },
        { en: 'Review the preview: valid rows, rows with errors and why. Choose the mode — Add, Update existing (matches on ISIN, then ticker, then name — use it for a daily price file) or Replace — and import.' },
        { en: 'Save the mapping as an import template. It is recognised from the column headers next time, even if the columns move, and applied automatically. Templates can be downloaded and shared with colleagues as JSON.' }
      ] },
      { p: { en: 'Blank Excel and CSV templates with an instruction sheet are under “Templates”, also one per instrument type.' } }
    ]
  },
  {
    id: 'holdings',
    title: { en: 'Holdings' },
    blocks: [
      { p: { en: '27 instrument types covering what European institutions trade: equities, ETFs/ETNs, funds (incl. money market funds), government, inflation-linked, corporate, covered, callable and perpetual (AT1) bonds, ABS/MBS, convertibles, FRNs, T-bills/CP, cash and term deposits, repos and securities lending (with collateral), futures (index, bond, STIR, commodity, VIX), options (European or American, warrants, options on futures), certificates and structured products (incl. mini futures and turbos; autocalls at market price), FX forwards, interest rate and cross-currency swaps, swaptions, caps/floors, inflation swaps, barrier and digital options, CDS, equity swaps/CFDs/TRS, other OTC derivatives at counterparty value, commodities and private markets/crypto. Each has its own form, required fields and live valuation preview.' } },
      { note: { en: 'An instrument type the file names but the platform does not recognise is never guessed. The row is kept but not valued (it is not in NAV) until you map its code under Instrument type codes in Bulk upload, or edit it in Holdings. OTC products the platform does not model — swaptions, caps and floors, inflation and variance swaps, exotics — use “Other OTC derivative”: the counterparty’s market value is required, and the risk comes from the delta, duration or vega you give.' }, tone: 'info' },
      { list: [
        { en: '“+ Add instrument” opens the form; click a row to edit it.' },
        { en: 'Search and filter by type; sort by any column. Rows with errors are marked, and the sidebar badge counts them.' },
        { en: 'Export the holdings to CSV or Excel.' },
        { en: 'Positions with a currency that has no FX rate are valued at zero until you add a rate — the dashboard warns you.' }
      ] },
      { h: { en: 'Price history' } },
      { p: { en: 'Daily prices drive performance, historical VaR, correlations, tracking error and the risk class. Load a wide file (Date | series | series …) or a long one (Date | Ticker | Price). Series are matched to holdings by ISIN, ticker or name, or by hand. Add FX series (e.g. USDSEK) for currency risk and a benchmark column for relative figures. New files are merged by date. A connected file with several dates fills this in by itself.' } }
    ]
  },
  {
    id: 'pnl',
    title: { en: 'Cost & P&L and NAV & units' },
    blocks: [
      { p: { en: 'Cost & P&L shows average cost, unrealised P&L against today\'s value with the currency effect split out, and realised P&L for the year, 12 months and all time. Give a cost price per position, or import a transaction log (buys and sells with fees and trade-day FX; Swedish or English headers). A reconciliation flag shows when the log does not add up to the held quantity.' } },
      { p: { en: 'NAV & units gives an indicative NAV per unit for each share class, with fee accrual, and simulates what a subscription or redemption does to cash, liquidity and limits. Enter share classes, units outstanding and fees on that page.' } }
    ]
  },
  {
    id: 'oversight',
    title: { en: 'Daily oversight: changes, pre-trade and attribution' },
    blocks: [
      { p: { en: 'These pages work on holdings over time. A connected file gives one snapshot per date automatically; for other portfolios, click “Save holdings as snapshot” on Changes & track record each day you update the holdings (the latest 90 are kept).' } },
      { h: { en: 'Changes & track record — the morning check' } },
      { list: [
        { en: 'Pick two dates (default: the latest two). You see the holdings-based return, the NAV change, estimated net flows (subscriptions minus redemptions) and turnover.' },
        { en: 'Key figures side by side: VaR, duration, equity delta, liquidity, largest issuer, limit breaches — with the change coloured red where it got worse.' },
        { en: 'Limits that changed status, and the holdings that were bought or sold, with each move split into price effect and trade effect.' },
        { en: 'Track record: the fund\'s own chained return across every date, with volatility, drawdown, turnover and the largest contributors and detractors.' }
      ] },
      { h: { en: 'Pre-trade — before you place the order' } },
      { steps: [
        { en: 'Add a trade on a holding (target weight, change in quantity or new quantity) or a new instrument.' },
        { en: 'Choose which cash account pays for it.' },
        { en: 'Read the impact: risk, duration, liquidity, largest issuer and every limit before and after. A limit the trade would breach shows in red — that is an active breach you would be creating.' },
        { en: 'Apply the trades to the holdings if you want (undo is one click). For a portfolio fed by a connected file, put the trades in the file instead.' }
      ] },
      { h: { en: 'Attribution — explaining the result' } },
      { steps: [
        { en: 'Choose the segments: asset class, sector, region, country or currency.' },
        { en: 'Paste or upload the benchmark\'s weight and return per segment for the period (the index factsheet has them). “Download template” gives a file with your portfolio\'s segments filled in.' },
        { en: 'Pick the same period. The page splits the active return into allocation, selection and interaction per segment.' }
      ] },
      { h: { en: 'Limit history and liquidity stress test' } },
      { list: [
        { en: 'Compliance → Limit history shows every limit on every date and classes each breach as active (a trade caused it — correct at once) or passive (the market did — correct as a priority, in the unitholders\' interest). Useful evidence for the depositary and the board.' },
        { en: 'Liquidity → Liquidity stress test runs redemption shocks of 5–30 % (and your own) against what can be sold in the horizon, and shows the fund left for the remaining investors when the most liquid assets are sold first — in line with ESMA\'s guidelines.' }
      ] },
      { link: 'changes', label: { en: 'Go to Changes & track record' } }
    ]
  },
  {
    id: 'analytics',
    title: { en: 'Analytics, page by page' },
    blocks: [
      { list: [
        { en: 'Dashboard — NAV, key risk figures, alerts (missing FX, limit breaches, errors) and the largest holdings at a glance.' },
        { en: 'Asset allocation — economic exposure per asset class: holdings plus the derivative overlay. Set mandate targets and ranges per class to see breaches and active weights.' },
        { en: 'Exposure — market value against economic exposure, sector, region, country, issuer and currency before and after hedges, plus concentration (top 10, HHI, effective N).' },
        { en: 'Derivatives — notional, delta and delta-adjusted exposure per derivative, the model next to what your broker or custodian reported (columns reportedNotional, reportedDelta, reportedDeltaExposure). Differences are flagged.' },
        { en: 'Risk — risk contributions by asset class, parametric and historical VaR/ES (confidence, horizon and headline method are selectable), contributions by factor and position, sensitivities and correlations. Historical figures need price history.' },
        { en: 'Fixed income — yield, modified and spread duration, convexity, DV01/CS01, maturity and rating profiles, DV01 ladder and rate risk per currency; swaps and bond futures included.' },
        { en: 'Performance — today\'s holdings back-cast over the loaded history: return, volatility, Sharpe, Sortino, drawdown, benchmark statistics and a monthly table.' },
        { en: 'Stress tests — 11 historical and hypothetical scenarios, and your own with sliders. Options are fully repriced.' },
        { en: 'Liquidity — days to liquidate from average daily volume and a participation rate you set, and a liquidation profile under normal and stressed conditions. Add average daily volume to holdings for better estimates.' },
        { en: 'Cash-flow calendar — coupons, redemptions, FX settlements, swap and CDS payments and expiries, exportable to CSV and your calendar (.ics).' },
        { en: 'Compliance — UCITS-style limits (issuer, 5/10/40, government, deposits, funds, commitment, counterparty, liquidity, illiquid assets) plus optional internal limits. Switch each on or off and set its value to match your prospectus.' }
      ] },
      { p: { en: 'Every formula and simplification behind these numbers is on “How we calculate”.' } },
      { link: 'methodology', label: { en: 'How we calculate' } }
    ]
  },
  {
    id: 'report',
    title: { en: 'PDF report' },
    blocks: [
      { steps: [
        { en: 'Open PDF report and choose the sections to include.' },
        { en: 'Write the manager commentary if you want one.' },
        { en: 'Generate. The A4 PDF is built in your browser and saved where you choose — it is not sent anywhere.' }
      ] }
    ]
  },
  {
    id: 'settings',
    title: { en: 'Settings and keeping data safe' },
    blocks: [
      { list: [
        { en: 'Portfolio: name, base currency, manager, fund type, valuation date and risk-free rate.' },
        { en: 'FX rates: import the ECB reference rates file (CSV or XML from the ECB) or type your own. Rates are stored per portfolio.' },
        { en: 'Risk model assumptions: the long-run volatilities and correlations the parametric model uses when there is no price history.' },
        { en: 'Connected file: the read side — see above.' },
        { en: 'Linked file: the save side. The whole workspace (JSON) or the active portfolio (CSV/Excel) is written to a file on your organisation\'s storage about a second after every change. Recommended so the browser is not the only copy.' },
        { en: 'Backups: “Download backup” saves a JSON of everything; “Restore from backup” merges one back. The automatic backup (daily, weekly, monthly or off) downloads when no linked file is set.' }
      ] },
      { note: { en: 'The browser copy is lost if someone clears the browser\'s site data. Keep a linked file or regular backups on your organisation\'s storage.' }, tone: 'warn' }
    ]
  },
  {
    id: 'faq',
    title: { en: 'Troubleshooting' },
    blocks: [
      { list: [
        { en: 'Something is calculated wrong or does not work — use “Report a problem” at the bottom of the menu. Never paste real holdings or client data: the report is public. Made-up numbers that reproduce the problem are perfect.' },
        { en: '“Connect a file” is missing — you are not in Chrome or Edge on a desktop. Use Bulk upload instead.' },
        { en: '“No date column found” — the first column must hold a date on every holding row. Check that Excel has not turned dates into text in an unusual format.' },
        { en: '“Column headers were not recognised” — map the file once in Bulk upload and save an import template, then connect again.' },
        { en: 'The connected file is not updating — the file must be saved (not only edited) and the tab visible. Click “Read now” on the card to force it.' },
        { en: 'My edits on Holdings disappeared — the portfolio comes from a connected file, which replaces holdings on every change. Edit the file.' },
        { en: 'A position is valued at zero — its currency has no FX rate, or a required field is missing (see the error on the row).' },
        { en: 'Performance and historical VaR are empty — load price history, or connect a file with at least two dates.' },
        { en: 'Changes & track record says it needs two dates — connect a file with several dates, or save a snapshot today and another on a later valuation date.' },
        { en: 'Attribution shows a segment as “not in benchmark” — the names differ. Use the names shown in the table, or download the template.' },
        { en: 'The same file cannot be both connected (read) and linked (save) as CSV/Excel — the platform would read its own output. Use different files.' }
      ] }
    ]
  }
];
