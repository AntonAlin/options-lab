// The complete manual as one plain-text file: what the platform is for and not for, the user guide,
// every page, typical workflows, every calculation, and reference tables. Built from the same data the
// app renders (js/guide.js, js/methodology.js, the instrument and field registry, the default limits,
// scenarios and risk assumptions), so the download never drifts from the code. Pure: no browser APIs,
// so scripts/manual.mjs writes the same file for each release.
import { GUIDE, REPO_URL } from './guide.js';
import { METHODOLOGY } from './methodology.js';
import { INSTRUMENTS, FIELDS, OPTION_LABELS } from './instruments.js';
import { DEFAULT_LIMITS, DEFAULT_CMA, DEFAULT_RISK } from './store.js';
import { SCENARIOS } from './analytics.js';
import { TPT_OUT_FIELDS } from './tptout.js';
import { t, L } from './i18n.js';

const W = 100;

// ---- plain-text layout ------------------------------------------------------------------------------
function wrap(text, indent = '', first = indent) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let lead = out.length ? indent : first, line = lead;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line.length > lead.length && line.length + 1 + word.length > W) { out.push(line); lead = indent; line = indent + word; }
      else line += (line.length > lead.length ? ' ' : '') + word;
    }
    out.push(line);
  }
  return out.join('\n');
}
const para = s => wrap(s) + '\n';
const bullet = (s, lvl = 0) => wrap(s, ' '.repeat(2 + lvl * 2) + '  ', ' '.repeat(2 + lvl * 2) + '- ');
const numbered = (s, n) => wrap(s, '     ', `  ${String(n).padStart(2)}. `);
const verbatim = (s, indent = '      ') => String(s).split('\n').map(l => indent + l).join('\n');
const rule = (ch = '=') => ch.repeat(W);
const h1 = s => `\n\n${rule('=')}\n${s.toUpperCase()}\n${rule('=')}\n`;
const h2 = s => `\n\n${s}\n${'-'.repeat(Math.min(W, s.length))}\n`;
const h3 = s => `\n${s}\n`;

// ---- hand-written chapters ------------------------------------------------------------------------------
const ABOUT = {
  what: 'Nexus Portfolio Lab is portfolio analytics for fund managers that runs entirely in the web browser. It values the holdings of one or more portfolios, measures their risk, checks them against investment limits and the fund\'s own rules, shows how they changed between dates, and produces reports: a PDF for the board or investors and a FinDatEx Tripartite Template (TPT) for insurance and pension investors. There is no server, no database and no user account. The holdings live in a data source the organisation controls — a file on its own storage or its own API — and the app reads it, follows it while it changes and writes changes made in the app back into it.',
  intended: [
    'Daily oversight of UCITS funds, AIFs, mandates and model portfolios by the portfolio manager, the risk function and compliance: NAV, exposures, concentration, limits and fund rules at a glance, with breaches explained.',
    'Risk measurement for monitoring and for internal reporting: parametric, historical and EWMA VaR and expected shortfall, stress tests with full option repricing, interest-rate and credit sensitivities, liquidity profiles and redemption stress tests.',
    'Pre-trade checks: what a planned trade does to risk, duration, liquidity and every limit before it is sent to the broker.',
    'Ex-post analysis: holdings-based return and track record, performance statistics, Brinson attribution, cost basis and realised/unrealised P&L.',
    'A documented second line of control: the control log records the daily limit sign-off, breach cases and every change to limits and rules in a tamper-evident chain.',
    'Investor and board reporting: the PDF report, CSV/Excel exports and the TPT for the fund\'s Solvency II investors.',
    'A second opinion beside the administrator, the depositary and the official systems: reconciling model figures against reported ones, and finding data errors before they reach a report (data checks on every file).',
    'Teaching, training and prototyping of portfolio and risk analysis with the demo file.'
  ],
  notFor: [
    'Official NAV calculation or fund accounting. The indicative NAV per unit is an estimate; the administrator\'s NAV is the one that counts. The platform keeps no books, no general ledger and no accruals beyond what the NAV page estimates.',
    'Order management or trade execution. Nothing is sent to a broker. Pre-trade is a what-if, not an order.',
    'Regulatory reporting filed with a supervisor (AIFMD Annex IV, UCITS returns, EMIR, MiFIR, SFTR) — none of these is produced. The TPT is a data file for investors, not a filing, and it must be checked before it is sent.',
    'Legal or compliance advice. The UCITS limits, the global exposure methods and the liquidity management tools are the developer\'s reading of the rules. Compliance decides; the platform monitors.',
    'The sole record of anything. The browser copy can be wiped by clearing site data; the source of truth is the data source, with backups on the organisation\'s storage.',
    'Access control or segregation of duties. There are no user accounts: the name in the control log is typed in by the user. It shows when something changed and that the record was not altered afterwards, not who was authorised to do it.',
    'Valuation for accounting (IFRS 13 fair value hierarchy) or prices for dealing with clients. Prices come from the user\'s files; models are simplified (see Part C) and OTC values without the counterparty\'s MTM are estimates.',
    'Investment advice or recommendations to anyone. Figures describe a portfolio; they do not say what to buy or sell.',
    'Solvency II SCR calculation. The TPT leaves the SCR contribution fields empty.',
    'Real-time or intraday risk on live market data. There is no market-data feed: prices and implied volatilities are as fresh as the last file.',
    'Personal data of clients. Holdings files should hold portfolios, not people; the platform has no protection for personal data beyond the browser and the organisation\'s storage.'
  ],
  roles: [
    'Portfolio manager: Holdings, Pre-trade, Exposure, Risk, Fixed income, Stress tests, Changes & track record, Cost & P&L.',
    'Risk manager: Risk, Global exposure (VaR approach and backtest), Stress tests, Liquidity and Liquidity tools, Derivatives (model against reported), How we calculate.',
    'Compliance: Compliance, Fund rules, Control log (sign-off and breach cases), limit history on Changes & track record.',
    'Operations / middle office: Data sources, Bulk upload and import templates, data checks, Price history, NAV & units, TPT for investors.',
    'IT, information security and outsourcing review: Part A of this manual, the README and docs/IT-RISK-ASSESSMENT.md in the repository.'
  ],
  limits: [
    'Data quality decides everything. A wrong price, quantity, currency or type in the source gives wrong figures on every page. Read the data checks and validation messages; a position with errors is flagged, and an unknown type is held back unvalued rather than guessed.',
    'Without price history the risk model uses long-run assumptions (Settings → Risk model assumptions), not the portfolio\'s own history. Historical VaR, performance and correlations need at least two dates of prices.',
    'Models are simplified: a flat curve per currency where no curve is loaded, Black-Scholes family for options with the volatility you enter (20 % when none is given), spot valuation for FX forwards without an MTM, a single flat par rate for swaps, no look-through into funds beyond the class and equity share you enter. Part C lists every simplification.',
    'The compliance check does not aggregate issuers into groups automatically, does not look through funds and does not net collateral. Fund rules can model some of this; the rest is for the compliance function.',
    'FX: fallback rates are placeholders. Import the ECB reference rates (automatic by default, Settings) or enter your own before trusting any figure in a multi-currency portfolio.',
    'A file data source needs Chrome or Edge on a desktop. Other browsers can use an API source.',
    'Everything runs on one computer at a time. Two people can work on the same data source; each browser keeps its own settings, limits and control log for it.'
  ],
  workflows: [
    ['Setting up a new fund', [
      'Export the holdings from your PMS, custodian or administrator as CSV or Excel with a date column (and a portfolio column if one file holds several funds).',
      'Connect the file (Data sources → Add a file) or the API. If the layout is not recognised the mapper opens: pick the date column, the portfolio column and map the other columns once, then Save mapping and connect.',
      'Settings: check base currency, fund type, valuation date and that FX rates are the ECB rates, not the fallback.',
      'Compliance and Fund rules: set the limits to the prospectus; add the fund\'s own restrictions as rules.',
      'Global exposure: choose commitment or VaR approach; Liquidity tools: record the selected tools and swing pricing settings.',
      'Load price history (Price history, or a Prices sheet in the workbook) for performance, historical VaR and backtests.',
      'Link a file or set automatic backups (Settings) so the browser is not the only copy of limits, rules and logs.'
    ]],
    ['Every business day', [
      'Refresh the source (automatic while the tab is open) and read the data checks on Holdings: unit errors, price jumps, stale prices, missing holdings.',
      'Dashboard: NAV, alerts, breaches. Compliance and Fund rules for any breach; open a case for each one in the Control log, with cause and actions.',
      'Sign off the daily limit check in the Control log.',
      'Before trading: Pre-trade with the planned trades; apply them only if every limit still holds.'
    ]],
    ['Month end', [
      'Make sure the month-end holdings are in the source as their own date (write mode “As a new dated snapshot” or the administrator\'s file).',
      'Changes & track record: holdings-based return, flows, turnover, contributors and detractors; limit history for active and passive breaches.',
      'Performance and Attribution against the benchmark; Stress tests and Liquidity stress test.',
      'PDF report with the manager commentary; export the control log for the period.'
    ]],
    ['Quarter end: TPT for insurance investors', [
      'Holdings of the quarter-end date in the source and the official NAV per unit on the NAV & units page.',
      'PDF report page → TPT for investors: enter the share class ISIN, pick the share class, read the warnings.',
      'Fix what the warnings name (validation errors, missing FX, CIC codes to check), download the TPT and check it against the current FinDatEx specification and the investor\'s requirements before sending.'
    ]],
    ['Receiving a TPT from another manager (fund of funds, look-through)', [
      'Connect the TPT file as a data source or read it in Bulk upload; it is recognised without mapping and read only.',
      'Check the note: positions, portfolios, valuation date, look-through rows and skipped rows. Unknown CIC codes are held back until mapped under Instrument type codes.'
    ]]
  ],
  glossary: [
    ['NAV', 'Net asset value: the sum of the market values of all positions in the base currency.'],
    ['Market value (MV)', 'What a position is worth today in the base currency. For futures only the unsettled margin; for swaps and forwards the mark-to-market.'],
    ['Exposure / net exposure', 'Economic exposure: the market risk a position carries, e.g. the notional of a future or the delta-adjusted value of an option. Gross is the absolute value, net keeps the sign.'],
    ['Commitment', 'UCITS global exposure under the commitment approach: the derivatives\' converted exposure as a share of NAV.'],
    ['VaR / ES', 'Value at risk: the loss not exceeded with the chosen confidence over the horizon. Expected shortfall: the average loss beyond VaR.'],
    ['EWMA', 'Exponentially weighted moving average volatility (RiskMetrics, λ = 0.94): recent days weigh more.'],
    ['DV01 / CS01 / IR01', 'Value change for a one basis point move in rates (DV01, IR01 per currency) or credit spreads (CS01).'],
    ['Modified / spread duration', 'Percentage price change per 1 % move in yield, or in the credit spread.'],
    ['Delta / gamma / vega', 'Option sensitivities to the underlying price, to the change in delta, and to implied volatility.'],
    ['HHI / effective N', 'Herfindahl-Hirschman index of weights (concentration) and its inverse, the number of equal-sized holdings with the same concentration.'],
    ['Active / passive breach', 'A limit breach caused by a trade (active) or by market moves or flows (passive).'],
    ['CIC', 'Complementary Identification Code (Solvency II): listing country + category + sub-category, e.g. SE31 = Swedish listed equity.'],
    ['TPT', 'FinDatEx Tripartite Template: the position-level file funds give insurance investors for Solvency II look-through.'],
    ['Data source', 'The file or API the portfolios live in. Read continuously, written back where allowed.'],
    ['Import template', 'A saved mapping of a file layout (columns, date and portfolio column, type codes, scaling) recognised by its headers.'],
    ['Snapshot', 'The holdings of one date, from the source or saved in the browser.'],
    ['Control log', 'The tamper-evident record of sign-offs, breach cases and changes to limits and rules (SHA-256 hash chain).']
  ]
};

// Every page in the menu: what it is for, what it shows, what it needs.
const PAGES = [
  ['Dashboard', 'Overview of the active portfolio: NAV, number of holdings, key risk figures (VaR, volatility, duration, leverage), alerts (missing FX, validation errors, limit and rule breaches, data checks) and the largest holdings. Start here every day.'],
  ['User guide', 'The instructions in the app; this manual contains all of it.'],
  ['Holdings', 'Every position with type, quantity, price, currency, market value, weight and exposure; filter by type, sort by any column, add, edit, duplicate and delete positions (written back to the source where it is writable). Validation errors and data checks are shown per row. Export to CSV or Excel in the data-source layout (Date, Portfolio, type, fields, plus calculated value, weight and exposure).'],
  ['Cost & P&L', 'Average cost and realised/unrealised P&L from a transaction log (buys and sells with fees and trade-date FX, imported from CSV/Excel or entered) or from the cost price on each position. FX effect shown separately. Reconciliation flag when the log does not add up to the held quantity.'],
  ['Changes & track record', 'Holdings compared between two dates: holdings-based return, NAV change, estimated net flows, turnover, key figures and limits before and after, and each holding\'s move split into price and trade effect. Chained track record across all dates with contributors and detractors, and the limit history with active and passive breaches. Needs two dates (a source with several dates, or saved snapshots).'],
  ['Pre-trade', 'Hypothetical trades — a target weight, a quantity change or a new instrument — funded from a cash account you choose. Shows risk, duration, liquidity and every limit and fund rule before and after. “Apply” writes the trades into the holdings, with undo.'],
  ['Bulk upload', 'Read a file (CSV, TSV, Excel, ODS, JSON, XML, a TPT or pasted cells) into a portfolio: map columns, set fixed values, scaling, date formats, type codes and rows to skip, see mandatory datapoints and data checks, and import in add, update or replace mode. Save the mapping as an import template; download blank Excel/CSV templates. The data sources card is also here. This page is also the mapper a new data source opens when its layout is not recognised.'],
  ['Price history', 'Load price series (wide or long files, merged by date), match them to holdings by ticker, ISIN or name or by hand, add FX series (e.g. USDSEK) and a benchmark. Feeds performance, historical VaR, EWMA, PCA, correlations and the VaR backtest.'],
  ['NAV & units', 'Indicative NAV per unit per share class: units, last official NAV, management and performance fee accrual with hurdle and high-water mark, liabilities and receivables. A subscription/redemption simulator. Share class data is also used by the TPT (share price and units).'],
  ['Asset allocation', 'Economic exposure per asset class (holdings plus the derivative overlay, mixed funds split by equity share), sunburst and treemap from class to group to holding, mandate targets and ranges with breaches and active weights.'],
  ['Exposure', 'Market value against economic exposure by asset class, sector, region, country, instrument type, issuer and currency (before and after hedges); top 10 weight, HHI and effective number of holdings.'],
  ['Derivatives', 'Every derivative with notional, delta and delta-adjusted exposure and commitment by underlying; the model next to what the broker or custodian reported, with differences flagged.'],
  ['Risk', 'Risk contributions by asset class and by factor and position (Euler); parametric factor VaR/ES, historical VaR/ES and EWMA VaR with selectable confidence, horizon and headline method; statistical risk drivers (PCA with Ledoit-Wolf shrinkage); factor sensitivities, option Greeks and correlations.'],
  ['Global exposure', 'UCITS global exposure by the commitment approach or the VaR approach (absolute VaR ≤ 20 % of NAV or relative VaR ≤ 2 × a reference portfolio), 99 %, 20 days. Backtest of 1-day VaR over 250 days with Kupiec\'s test and traffic-light zones.'],
  ['Fixed income', 'Yield, modified and spread duration, convexity, DV01 and CS01; portfolio duration including swaps and bond futures; maturity and rating profiles, DV01 ladder and rate risk per currency.'],
  ['Performance', 'Back-cast of today\'s holdings over the loaded history: CAGR, volatility, Sharpe, Sortino, maximum drawdown, Calmar, VaR/ES, skew and kurtosis; against a benchmark beta, alpha, tracking error, information ratio and up/down capture; rolling volatility, drawdown chart and monthly returns.'],
  ['Attribution', 'Brinson-Fachler allocation, selection and interaction effects per asset class, sector, region, country or currency, against benchmark weights and returns you paste or upload.'],
  ['Stress tests', 'Eleven historical and hypothetical scenarios (listed in Part D) and a custom scenario with sliders; options and option-like instruments are fully repriced. P&L by position and asset class.'],
  ['Liquidity', 'Days to liquidate from average daily volume and a participation rate (or type defaults and notice periods); pro-rata liquidation profile in normal and stressed markets; the ESMA-style liquidity stress test with redemption shocks, coverage ratio and the remaining portfolio re-checked against the limits.'],
  ['Liquidity tools', 'The fund\'s selected liquidity management tools checked against the minimum; swing pricing and anti-dilution levy calibration from trading costs and square-root market impact; redemption gates against the liquidity profile.'],
  ['Cash-flow calendar', 'Coupons, redemptions, FX settlements, swap and CDS payments, option and future expiries over the chosen months; CSV and calendar (.ics) export.'],
  ['Compliance', 'UCITS-style limits (single issuer, 5/10/40, government issuers, bank deposits, single fund, derivative commitment, OTC counterparty, 7-day liquidity, illiquid assets) and optional internal limits; each switchable and editable (defaults in Part D). Fund rules: the fund\'s own restrictions as rules on market value, exposure, largest holding or group, count or duration of matching holdings.'],
  ['Control log', 'Sign off the daily limit check; handle every breach as a case with cause, notes, actions and resolution; every change to a limit, rule, global exposure or liquidity tool setting is logged with old and new value. Hash chain verification, CSV/JSON export, archive of logs of deleted portfolios.'],
  ['PDF report', 'An A4 PDF built in the browser: summary tiles, commentary, charts and tables per selected section, and a disclaimer. The TPT for investors card is on the same page.'],
  ['How we calculate', 'Every formula, simplification and input; the same content as Part C of this manual, with this manual\'s download button.'],
  ['Settings', 'Portfolio (name, base currency, manager, fund type, valuation date, risk-free rate), FX rates and the automatic ECB update, discount curves, risk model assumptions, data sources and write mode, linked file, backups and restore, storage used.']
];

// ---- generated chapters ------------------------------------------------------------------------------------
function guideText() {
  let out = '';
  GUIDE.forEach((s, i) => {
    out += h2(`B${i + 1}. ${L(s.title)}`);
    if (s.intro) out += para(L(s.intro));
    let n = 0;
    for (const b of s.blocks) {
      if (b.h) out += h3(L(b.h).toUpperCase());
      else if (b.p) out += para(L(b.p));
      else if (b.steps) { n = 0; out += b.steps.map(x => numbered(L(x), ++n)).join('\n') + '\n'; }
      else if (b.list) out += b.list.map(x => bullet(L(x))).join('\n') + '\n';
      else if (b.note) out += wrap(L(b.note), '  | ', `  | ${b.tone === 'warn' ? 'IMPORTANT: ' : 'NOTE: '}`) + '\n';
      else if (b.code) out += verbatim(b.code) + '\n';
      else if (b.href) out += wrap(`${L(b.label)}: ${b.href}`, '  ', '  → ') + '\n';
      else if (b.link) out += `  → In the app: ${L(b.label)} (#/${b.link})\n`;
    }
  });
  return out;
}

function methodologyText() {
  let out = '';
  METHODOLOGY.forEach((s, i) => {
    out += h2(`C${i + 1}. ${L(s.title)}`);
    out += `Source module: js/${String(s.module).split(' · ').join(', js/')}\n\n`;
    if (s.intro) out += para(L(s.intro));
    s.items.forEach((it, j) => {
      out += `\n  C${i + 1}.${j + 1} ${L(it)}\n`;
      if (it.formula) out += verbatim(it.formula) + '\n';
      if (it.notes) out += wrap(L(it.notes), '      ') + '\n';
      if (it.params) out += wrap('Inputs: ' + it.params, '      ') + '\n';
    });
  });
  return out;
}

const opt = o => (OPTION_LABELS[o] ? `${o} (${L(OPTION_LABELS[o])})` : o);
function referenceText() {
  let out = '';
  out += h2('D1. Instrument types');
  out += para('Each type with its id (accepted in the type column, as are the English name and common synonyms), the fields it requires, the fields it can use, and the defaults applied when a field is empty.');
  for (const [id, d] of Object.entries(INSTRUMENTS)) {
    out += `\n  ${L(d)}  [${id}]\n`;
    if (d.hint) out += wrap(L(d.hint), '      ') + '\n';
    out += wrap('Required: ' + (d.required.join(', ') || '—') + ((d.requireOneOf || []).length ? '; plus one of: ' + d.requireOneOf.map(g => g.join(' / ')).join('; ') : ''), '      ') + '\n';
    out += wrap('Fields: ' + d.fields.join(', '), '      ') + '\n';
    if (Object.keys(d.defaults || {}).length) out += wrap('Defaults: ' + Object.entries(d.defaults).map(([k, v]) => `${k} = ${v}`).join(', '), '      ') + '\n';
  }
  out += h2('D2. Fields and the column headers recognised');
  out += para('Field key, name, format, allowed values and the header texts recognised automatically (upper/lower case, spaces and punctuation are ignored).');
  for (const [k, f] of Object.entries(FIELDS)) {
    out += `\n  ${k} — ${f.en}  (${f.type})\n`;
    if (f.options) out += wrap('Values: ' + f.options.map(opt).join(', '), '      ') + '\n';
    if ((f.aliases || []).length) out += wrap('Headers: ' + f.aliases.join(', '), '      ') + '\n';
  }
  out += h2('D3. Default investment limits');
  out += para('As set for a new portfolio (UCITS-style). Values are % of NAV unless the rule says otherwise. Every limit can be switched on or off and changed on the Compliance page; each change is logged.');
  for (const [k, l] of Object.entries(DEFAULT_LIMITS)) {
    out += `\n  ${t('limit.' + k)}: ${l.value} ${l.on ? '(on)' : '(off by default)'}\n`;
    const help = t('limit.' + k + '.help');
    if (help && help !== 'limit.' + k + '.help') out += wrap(help, '      ') + '\n';
  }
  out += h2('D4. Stress scenarios');
  out += para('Shocks applied instantaneously: equities (eq, relative), rates (bp, parallel), credit spreads (cs, bp), foreign currencies against the base currency (fxAll, relative; positive = base currency weakens), commodities (cmd, relative), implied volatility (vol, points) and breakeven inflation (infl, bp).');
  for (const s of SCENARIOS) {
    const sh = ['eq', 'rates', 'cs', 'fxAll', 'cmd', 'vol', 'infl'].filter(k => s[k] !== undefined && s[k] !== 0).map(k => `${k} ${['eq', 'fxAll', 'cmd'].includes(k) ? (s[k] > 0 ? '+' : '') + Math.round(s[k] * 100) + ' %' : (s[k] > 0 ? '+' : '') + s[k]}`);
    out += bullet(`${s.en}: ${sh.join(', ') || 'no shock'}`) + '\n';
  }
  out += h2('D5. Default risk settings and model assumptions');
  out += para(`Risk settings: confidence ${DEFAULT_RISK.confidence * 100} %, horizon ${DEFAULT_RISK.horizonDays} day, risk-free rate ${DEFAULT_RISK.riskFree} %, liquidity participation rate ${DEFAULT_RISK.participation} % of average daily volume, headline VaR method "${DEFAULT_RISK.method}" (historical when the price history covers at least 70 % of the portfolio with 120 or more observations, else parametric), cash-flow calendar ${DEFAULT_RISK.cfMonths} months, reported derivative figures used when present: ${DEFAULT_RISK.useReported ? 'yes' : 'no'}.`);
  out += para('Long-run assumptions for the parametric model when there is no price history (Settings → Risk model assumptions). Volatilities are annual, in % or in basis points (Bp); correlations between −1 and 1.');
  for (const [k, v] of Object.entries(DEFAULT_CMA)) {
    const lab = t('cma.' + k);
    out += bullet(`${lab && lab !== 'cma.' + k ? lab : k}: ${v}${/Bp$/.test(k) ? ' bp' : /^corr/.test(k) ? '' : /Pts$/.test(k) ? ' vol points' : ' %'}`) + '\n';
  }
  out += h2('D6. TPT fields the platform writes');
  out += para('Header format: "<number>_<name>". Everything else in the TPT (including SCR contributions 97–105 and group codes) is left out. Issuer LEIs (47/48) are filled from the holding\'s Issuer LEI field or the issuer register. See C' + (METHODOLOGY.findIndex(s => s.id === 'tpt') + 1) + ' for how each value is derived and how a TPT is read.');
  out += TPT_OUT_FIELDS.map(([n, name]) => `  ${n.padStart(3)}  ${name}`).join('\n') + '\n';
  out += h2('D7. Validation messages');
  out += para('Shown per row in Bulk upload and on Holdings. A row with an error is kept and flagged; an unknown type is held back unvalued until it is mapped.');
  for (const k of ['required', 'number', 'date', 'ccy', 'option', 'rating', 'unknown_type', 'calc_failed', 'oneOf', 'typeGuessed']) out += bullet(t('val.' + k, { field: '<field>', fields: '<field A> / <field B>', raw: '<value>' })) + '\n';
  out += h2('D8. Data source messages');
  for (const k of ['no_date', 'no_header', 'no_fields', 'no_rows', 'same_file', 'permission', 'not_found', 'unsupported', 'network', 'auth', 'http', 'conflict', 'bad_url', 'read_only_format', 'no_records']) {
    const s = t('src.err.' + k, { err: k, status: '<status>' });
    if (s && s !== 'src.err.' + k) out += bullet(`${k}: ${s}`) + '\n';
  }
  return out;
}

// ---- the manual -----------------------------------------------------------------------------------------
export function buildManual({ date = new Date().toISOString().slice(0, 10), version = '' } = {}) {
  let out = '';
  out += rule('=') + '\n';
  out += 'NEXUS PORTFOLIO LAB — COMPLETE USER MANUAL\n';
  out += `What the platform is for, how to use every page, and how every figure is calculated.\n`;
  out += `Generated ${date}${version ? ' · version ' + version : ''} from the platform's own guide and methodology.\n`;
  out += `Source code and releases: ${REPO_URL}\n`;
  out += rule('=') + '\n';
  out += h3('CONTENTS');
  out += '  Part A  About the system: what it is, what it is for and not for, roles, limitations\n';
  out += '  Part B  User manual: every topic of the in-app guide, every page, typical workflows\n';
  out += '  Part C  Calculations: every formula, model, simplification and input\n';
  out += '  Part D  Reference: instrument types, fields, default limits, scenarios, assumptions, TPT, messages\n';
  out += '  Part E  Glossary, regulation, licence\n';

  out += h1('Part A — About the system');
  out += h2('A1. What it is');
  out += para(ABOUT.what);
  out += h2('A2. What it should be used for');
  out += ABOUT.intended.map(x => bullet(x)).join('\n') + '\n';
  out += h2('A3. What it must not be used for');
  out += para('Using the platform for any of the following puts the user, the fund and its investors at risk. The platform is a monitoring and analysis tool beside the official systems, not a replacement for them.');
  out += ABOUT.notFor.map(x => bullet(x)).join('\n') + '\n';
  out += h2('A4. Who uses which pages');
  out += ABOUT.roles.map(x => bullet(x)).join('\n') + '\n';
  out += h2('A5. Limitations you must know');
  out += ABOUT.limits.map(x => bullet(x)).join('\n') + '\n';

  out += h1('Part B — User manual');
  out += guideText();
  out += h2(`B${GUIDE.length + 1}. Every page in the menu`);
  out += PAGES.map(([name, text]) => `\n  ${name.toUpperCase()}\n` + wrap(text, '    ')).join('\n') + '\n';
  out += h2(`B${GUIDE.length + 2}. Typical workflows`);
  for (const [title, steps] of ABOUT.workflows) out += h3(title.toUpperCase()) + steps.map((s, i) => numbered(s, i + 1)).join('\n') + '\n';

  out += h1('Part C — Calculations');
  out += para('Every calculation the platform makes, with the formula, the simplifications and the inputs it reads. Amounts are in the portfolio\'s base currency unless stated; FX converts at the portfolio\'s rate table. The module named under each section is the file in the repository that implements it, so each formula can be checked against the code.');
  out += methodologyText();

  out += h1('Part D — Reference');
  out += referenceText();

  out += h1('Part E — Glossary, regulation and licence');
  out += h2('E1. Glossary');
  out += ABOUT.glossary.map(([k, v]) => wrap(v, '      ', `  ${k}: `)).join('\n') + '\n';
  out += h2('E2. Regulation: an interpretation, not advice');
  out += para('Regulation is updated continuously by lawmakers, ESMA and national supervisors. The UCITS limits, the VaR approach to global exposure, the liquidity management tools and the TPT are built on the developer\'s own reading of the rules and standards (UCITS Directive 2009/65/EC, CESR/10-788, Directive (EU) 2024/927, ESMA\'s guidelines and RTS on liquidity management tools, the FinDatEx TPT). That reading is an opinion on how the rules can be interpreted. It is not legal advice and it may be incomplete, out of date or wrong. Check against the current rules, the fund\'s own documents and your compliance function.');
  out += h2('E3. Licence');
  out += para('The source code is public so that anyone can check what the platform does and how each figure is calculated. Public to read is not open source: the licence lets anyone use the platform freely, also professionally, host an unmodified copy inside their own organisation and use its output however they like; it may never be sold, modified, built upon or republished. The full text is in the LICENSE file of the repository.');
  out += h2('E4. Reporting a problem');
  out += para(`Use “Report a problem” at the bottom of the menu, or open an issue at ${REPO_URL}/issues. Never include real holdings or client data: issues are public. Made-up numbers that reproduce the problem are best.`);
  out += '\n' + rule('=') + '\nEnd of manual.\n';
  return out;
}

export const MANUAL_FILENAME = 'nexus-portfolio-lab-manual.txt';
