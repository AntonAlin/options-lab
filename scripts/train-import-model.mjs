// Train the import suggestion model (js/suggest.js) and write js/models/import-model.json.
//   node scripts/train-import-model.mjs           train, report, write
//   node scripts/train-import-model.mjs --check   fail if the committed model was trained on another
//                                                 registry or training script (used by CI)
//
// Training data is synthetic and comes only from the field and type registry in js/instruments.js:
// every English label and alias, varied the way real exports vary them (abbreviations, prefixes,
// currency suffixes, typos, casing), with made-up sample values of the right shape. No customer
// file is involved. Accuracy is reported on tests/fixtures/import-suggest-testset.json, which is
// hand-written and never used for training. Training is seeded, so the output is reproducible.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FIELDS, INSTRUMENTS, TYPE_ALIASES, OPTION_LABELS } from '../js/instruments.js';
import { featuresOf, scores, words } from '../js/suggest.js';
import { mulberry32 } from '../js/util.js';

const OUT = 'js/models/import-model.json';
const check = process.argv.includes('--check');
const rng = mulberry32(20260929);
const pick = a => a[Math.floor(rng() * a.length)];
const chance = p => rng() < p;
const between = (a, b) => a + (b - a) * rng();

// ---- header variants --------------------------------------------------------------------------------
const ABBR = {
  quantity: ['qty', 'quant', 'qnty'], price: ['px', 'prc'], market: ['mkt', 'mrkt'], value: ['val', 'vl'], currency: ['ccy', 'cur', 'curr', 'crncy'],
  maturity: ['mat', 'mty', 'matur'], date: ['dt', 'dte'], security: ['sec', 'secu'], instrument: ['instr', 'inst'], amount: ['amt'],
  number: ['no', 'nr', 'num'], average: ['avg'], coupon: ['cpn'], yield: ['yld'], spread: ['sprd', 'spd'], notional: ['notl', 'ntl'],
  description: ['desc', 'descr'], identifier: ['id', 'ident'], exchange: ['exch'], country: ['cntry', 'ctry'], rating: ['rtg'],
  volatility: ['vol', 'volat'], underlying: ['undl', 'und', 'underl'], duration: ['dur'], frequency: ['freq'], issuer: ['iss'],
  collateral: ['coll'], percentage: ['pct'], percent: ['pct'], fixed: ['fix'], receive: ['rec', 'rcv'], expiry: ['exp'], dividend: ['div'],
  strike: ['strk'], multiplier: ['mult'], liquidity: ['liq'], days: ['d'], delta: ['dlt'], implied: ['impl'], purchase: ['purch'], sector: ['sect']
};
const PREFIX = ['pos', 'position', 'sec', 'security', 'instr', 'instrument', 'holding', 'asset', 'total', 'port', 'hld', 'line'];
const SUFFIX = ['(sek)', 'eur', 'usd', 'local', 'lcl', 'base', 'bc', 'lc', '%', 'ccy', '1', '[%]', '(local ccy)', 'fund ccy', 'amt', 'code', 'field', 'value', 'no'];

function camelSplit(k) { return k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); }
function styled(ws) {
  const s = rng();
  if (s < 0.25) return ws.join(' ');
  if (s < 0.4) return ws.join('_').toUpperCase();
  if (s < 0.55) return ws.map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  if (s < 0.65) return ws.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
  if (s < 0.75) return ws.join('.');
  if (s < 0.85) return ws.join('').toUpperCase();
  return ws.join('-');
}
function typo(w) {
  if (w.length < 6) return w;
  const i = 1 + Math.floor(rng() * (w.length - 2));
  const k = rng();
  if (k < 0.4) return w.slice(0, i) + w.slice(i + 1);
  if (k < 0.7) return w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
  return w.slice(0, i) + w[i] + w.slice(i);
}
function vary(base) {
  let ws = words(base);
  if (!ws.length) return base;
  ws = ws.map(w => (ABBR[w] && chance(0.45) ? pick(ABBR[w]) : w));
  if (chance(0.12)) ws = ws.map(w => (w.length > 5 && chance(0.5) ? w.slice(0, 4) : w));
  if (chance(0.12)) ws = ws.map(w => (w.length > 5 && chance(0.5) ? w[0] + w.slice(1).replace(/[aeiouyåäö]/g, '') : w));
  if (chance(0.1)) ws = ws.map(w => (chance(0.5) ? typo(w) : w));
  if (chance(0.2)) ws = [pick(PREFIX), ...ws];
  if (chance(0.25)) ws = [...ws, ...words(pick(SUFFIX))];
  if (!ws.length) ws = words(base);
  return styled(ws.filter(Boolean));
}

// Header wording common in custodian, administrator and broker exports that is not in the alias
// lists (the aliases are exact matches; these teach the model the vocabulary around them).
const EXTRA_HEADERS = {
  type: ['security type', 'instrument class', 'product type', 'asset type', 'sec type', 'instrument category', 'security class', 'product class', 'instrument group'],
  name: ['security name', 'instrument description', 'long name', 'short name', 'security long description', 'asset name', 'holding name'],
  ticker: ['bloomberg ticker', 'ric', 'symbol', 'exchange ticker', 'local code', 'bbg code'],
  isin: ['isin number', 'security isin', 'instrument isin'],
  qty: ['position', 'units held', 'nominal amount', 'par amount', 'quantity held', 'number of shares', 'shares', 'face value', 'holding quantity'],
  price: ['market price', 'close price', 'last price', 'valuation px', 'unit price', 'clean price', 'price local'],
  ccy: ['security currency', 'instrument currency', 'price currency', 'local currency', 'quote currency'],
  mtm: ['market value', 'fair value', 'valuation', 'mark to market', 'npv base', 'net present value'],
  maturity: ['maturity date', 'expiry date', 'redemption date', 'final maturity', 'expiration date'],
  costPrice: ['book cost per unit', 'average price', 'acquisition price', 'purchase price per unit'],
  issuer: ['issuer name', 'counterparty name', 'ultimate parent', 'issuer long name'],
  notes: ['comment', 'comments', 'note', 'free text', 'description text']
};

// ---- sample values ----------------------------------------------------------------------------------
const NAMES = ['Volvo B', 'Ericsson B', 'Apple Inc', 'Microsoft Corp', 'Nordea Bank Abp', 'Investor AB B', 'SGB 1060 0.75% 2028', 'Swedbank 1.5% 2027', 'iShares Core MSCI World', 'Handelsbanken Global Index', 'OMXS30 Dec26', 'Atlas Copco A', 'Novo Nordisk B', 'Equinor ASA', 'Nestle SA', 'SAP SE', 'Vattenfall FRN 2029', 'Kommuninvest 2030', 'EUR/SEK forward', 'USD cash', 'Heimstaden 4.375% 2027', 'SEB Likviditet', 'Sandvik AB', 'Siemens AG'];
const TICKERS = ['VOLV B', 'ERIC B', 'AAPL', 'MSFT US', 'NDA SS', 'INVE B', 'ATCO A', 'NOVO B', 'EQNR', 'SAND', 'SIE GY', 'SAP', 'OMXS30', 'ES1', 'RX1', 'SEB A'];
const ISINS = ['SE0000115446', 'SE0000108656', 'US0378331005', 'US5949181045', 'FI4000297767', 'SE0015811963', 'DK0062498333', 'NO0010096985', 'CH0038863350', 'DE0007236101', 'SE0004517290', 'XS2311407352', 'IE00B4L5Y983', 'SE0000107419'];
const ISSUERS = ['AB Volvo', 'Kingdom of Sweden', 'Nordea Bank Abp', 'Swedbank AB', 'Vattenfall AB', 'Apple Inc', 'Federal Republic of Germany', 'Kommuninvest', 'Heimstaden Bostad', 'SEB', 'BNP Paribas', 'JPMorgan Chase', 'Goldman Sachs Intl'];
const SECTORS = ['Industrials', 'Financials', 'Information Technology', 'Health Care', 'Energy', 'Materials', 'Consumer Staples', 'Utilities', 'Real Estate', 'Communication Services', 'Government', 'Banks'];
const COUNTRIES = ['SE', 'US', 'DE', 'FI', 'NO', 'DK', 'GB', 'FR', 'NL', 'CH', 'IE', 'LU'];
const RATINGS = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'B', 'NR', 'Aa2', 'Baa1'];
const CCYS = ['SEK', 'EUR', 'USD', 'NOK', 'DKK', 'GBP', 'CHF', 'JPY'];
const TYPES = ['Equity', 'Bond', 'Fund', 'Future', 'Option', 'EQ', 'GOVT', 'CORP', 'FX Forward', 'Cash', 'ETF', 'IRS', 'Aktie', 'Obligation'];
const WORDS = ['Core', 'Hedge', 'Overlay', 'Tactical', 'Satellite', 'Duration', 'Carry', 'Income'];
const NOTES = ['check with PM', 'hedge for USD', 'awaiting settlement', 'price from broker', '', 'legacy position'];

function fmtNum(x, d) {
  const s = x.toFixed(d);
  const k = rng();
  if (k < 0.2) return s.replace('.', ',');
  if (k < 0.3 && Math.abs(x) >= 1000) return Number(s).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (k < 0.4 && Math.abs(x) >= 1000) return Number(s).toLocaleString('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });
  return s;
}
function fmtDate(y0, y1) {
  const d = new Date(Date.UTC(Math.floor(between(y0, y1)), Math.floor(rng() * 12), 1 + Math.floor(rng() * 28)));
  const iso = d.toISOString().slice(0, 10), [Y, M, D] = iso.split('-');
  return pick([iso, iso, `${D}.${M}.${Y}`, `${Y}${M}${D}`, `${M}/${D}/${Y}`, `${D}/${M}/${Y}`]);
}
const NUM = {
  qty: () => fmtNum(Math.round(Math.exp(between(0, 16))), 0), price: () => fmtNum(Math.exp(between(0, 7.5)), 2), multiplier: () => pick(['1', '10', '100', '1000', '50']),
  beta: () => fmtNum(between(0.3, 1.8), 2), adv: () => fmtNum(Math.round(Math.exp(between(8, 16))), 0), coupon: () => fmtNum(between(0, 8), 3),
  yield: () => fmtNum(between(-0.5, 9), 3), spread: () => fmtNum(between(0, 600), 0), strike: () => fmtNum(Math.exp(between(2, 8)), 1),
  underlyingPrice: () => fmtNum(Math.exp(between(2, 8)), 2), vol: () => fmtNum(between(8, 60), 1), rate: () => fmtNum(between(0, 5), 2),
  divYield: () => fmtNum(between(0, 6), 2), reportedNotional: () => fmtNum(Math.exp(between(12, 21)), 0), reportedDelta: () => fmtNum(between(-1, 1), 3),
  reportedDeltaExposure: () => fmtNum(between(-1, 1) * Math.exp(between(12, 20)), 0), costPrice: () => fmtNum(Math.exp(between(0, 7.5)), 2),
  duration: () => fmtNum(between(0.1, 20), 2), buyAmount: () => fmtNum(Math.exp(between(12, 19)), 0), sellAmount: () => fmtNum(Math.exp(between(12, 19)), 0),
  fixedRate: () => fmtNum(between(0, 5), 3), marketRate: () => fmtNum(between(0, 5), 3), marketSpread: () => fmtNum(between(20, 500), 0),
  mtm: () => fmtNum(between(-1, 1) * Math.exp(between(8, 16)), 0), equityShare: () => fmtNum(between(0, 100), 0), liquidityDays: () => fmtNum(Math.round(between(1, 365)), 0),
  dirtyPrice: () => fmtNum(between(80, 120), 3), indexRatio: () => fmtNum(between(1, 1.5), 5), callPrice: () => fmtNum(between(100, 102), 2),
  leverage: () => fmtNum(between(1, 20), 1), vega: () => fmtNum(Math.exp(between(7, 12)), 0), tenor: () => pick(['1', '2', '5', '10', '30']),
  breakeven: () => fmtNum(between(1.5, 3), 2), barrier: () => fmtNum(Math.exp(between(2, 8)), 1), payout: () => fmtNum(Math.exp(between(0, 5)), 1),
  cpr: () => fmtNum(between(0, 20), 1), poolFactor: () => fmtNum(between(0.2, 1), 4), collateralValue: () => fmtNum(Math.exp(between(13, 18)), 0),
  haircut: () => fmtNum(between(0, 15), 1)
};
const TEXT = { name: NAMES, ticker: TICKERS, isin: ISINS, issuer: ISSUERS, sector: SECTORS, country: COUNTRIES, rating: RATINGS, strategy: WORDS, notes: NOTES, type: TYPES };
const DATES = { maturity: [2026, 2045], callDate: [2026, 2032], startDate: [2012, 2026] };

function sampleValues(key) {
  const spec = FIELDS[key];
  const n = 4 + Math.floor(rng() * 8);
  const gen = NUM[key] ? NUM[key]
    : TEXT[key] ? () => pick(TEXT[key])
    : DATES[key] ? () => fmtDate(...DATES[key])
    : spec?.type === 'ccy' ? () => pick(CCYS)
    : spec?.type === 'select' ? () => { const o = pick(spec.options); const l = OPTION_LABELS[o]?.en; return chance(0.5) && l ? l : o; }
    : () => '';
  return Array.from({ length: n }, gen);
}

// ---- unrelated columns (class __none) ------------------------------------------------------------------
const NONE_HEADERS = ['Row', 'Row id', 'Line no', 'Seq', 'Sequence', 'Record id', 'Unnamed: 5', 'Column1', 'Col 7', 'Account manager', 'Relationship manager',
  'Custodian', 'Booking status', 'Status', 'Last updated', 'Updated by', 'Created by', 'Timestamp', 'Run time', 'Report date', 'As of date', 'Valuation date',
  'NAV date', 'Portfolio', 'Portfolio code', 'Fund', 'Fund name', 'Account', 'Account no', 'Depot', 'Mandate', 'Client', 'Book', 'Desk', 'Trader', 'Settlement status',
  'Settlement date', 'Trade date', 'Trade id', 'Order id', 'Page', 'Source system', 'Flag', 'Checked', 'Approved', 'Days to maturity', 'Remaining days',
  'Portfölj', 'Konto', 'Depå', 'Rapportdatum', 'Handläggare', 'Radnummer', 'Kund', 'Datum', 'Id', 'Hash', 'Batch', 'Version', 'Region code', 'Weight in index'];
function noneValues(h) {
  const k = words(h).join(' ');
  if (/date|datum|time|updated/.test(k)) return Array.from({ length: 6 }, () => fmtDate(2024, 2027));
  if (/row|seq|line|no|id|col|unnamed|days|nummer|page|version|batch/.test(k)) return Array.from({ length: 6 }, (_, i) => String(i + 1 + Math.floor(rng() * 400)));
  if (/portfolio|fund|account|depot|mandate|client|book|desk|portfölj|konto|depå|kund/.test(k)) { const v = pick(['Fund A', 'Global Equity', 'SE-1234', 'Mandate 7', 'Pension Plan']); return Array.from({ length: 6 }, () => v); }
  return Array.from({ length: 6 }, () => pick(['Settled', 'Pending', 'jdoe', 'asmith', 'OK', 'Y', 'N', 'A1', '']));
}

// ---- type codes -------------------------------------------------------------------------------------
// Code styles seen in administrator and broker files, on top of the registry aliases.
const TYPE_CODES = {
  equity: ['EQ', 'EQTY', 'EQ ORD', 'COM', 'CS', 'ORD', 'SHARE', 'STK', 'STOCK', 'EQUITY COMMON', 'PREF', 'ADR', 'Listed equity', 'Ordinary shares', 'Shares', 'Aktier', 'Noterad aktie'],
  etf: ['ETF', 'ETP', 'EQ ETF', 'Exchange traded', 'Index ETF', 'Bond ETF'],
  fund: ['MF', 'FUND', 'UCITS', 'OEIC', 'FND', 'MUTUAL FUND', 'UNIT TRUST', 'SICAV', 'Fund units', 'Investment fund', 'Fondandelar', 'AIF units'],
  govt_bond: ['GOVT', 'GOV', 'SOV', 'TSY', 'BOND GOV', 'GOVT BOND', 'TREASURY', 'Government bond', 'Sovereign', 'Supranational', 'Agency', 'Munis', 'Statsobligation', 'Bund', 'Gilt', 'OAT'],
  corp_bond: ['CORP', 'BOND CORP', 'CORP BOND', 'FIXED', 'DEBT', 'NOTE', 'MTN', 'COVERED', 'Senior unsecured', 'Corporate', 'Företagsobligation', 'Bostadsobligation', 'Fixed rate bond', 'Straight bond', 'EMTN'],
  frn: ['FRN', 'FLOATER', 'FLOAT', 'Floating', 'Variable rate', 'FRN corp', 'FRN covered', 'Rörlig obligation'],
  money_market: ['MM', 'TBILL', 'CP', 'CD', 'BILL', 'Money market', 'Commercial paper', 'Certificate of deposit', 'Statsskuldväxel', 'Discount paper'],
  cash: ['CASH', 'CCY', 'CURRENCY', 'DEPOSIT', 'Current account', 'Cash account', 'Bank balance', 'Kassa', 'Likvida medel', 'Time deposit'],
  future: ['FUT', 'FUTURE', 'IDX FUT', 'BOND FUT', 'Futures', 'Index future', 'Terminer', 'STIR', 'Listed future'],
  option: ['OPT', 'OPTION', 'CALL', 'PUT', 'EQ OPT', 'IDX OPT', 'Listed option', 'Warrant', 'Optioner', 'Stock option', 'Index option'],
  fx_forward: ['FXF', 'FX FORWARD', 'FWD', 'FX SWAP', 'NDF', 'Currency forward', 'FX outright', 'Valutatermin', 'Forex forward'],
  irs: ['IRS', 'SWAP', 'OIS', 'FRA', 'Interest rate swap', 'Ränteswap', 'Vanilla swap', 'IR swap'],
  cds: ['CDS', 'Credit default swap', 'CDX', 'iTraxx', 'Kreditderivat'],
  commodity: ['CMDTY', 'COMMODITY', 'ETC', 'Physical gold', 'Precious metals'],
  alternative: ['ALT', 'PE', 'PRIVATE', 'Private equity', 'Real estate fund', 'Hedge fund', 'Infrastructure fund', 'Crypto', 'Unlisted'],
  inflation_linked: ['ILB', 'LINKER', 'INFL', 'Inflation linked bond', 'Index linked', 'Real rate bond', 'Realobligation', 'TIPS', 'OATi'],
  convertible: ['CONV', 'CB', 'CONVERTIBLE', 'Convertible note', 'Konvertibel'],
  certificate: ['CERT', 'CERTIFICATE', 'Structured product', 'Mini future', 'Bull certificate', 'Bear certificate', 'Tracker', 'Autocall', 'Knock out'],
  equity_swap: ['CFD', 'TRS', 'EQ SWAP', 'Equity swap', 'Total return swap', 'Portfolio swap', 'Contract for differences'],
  ccs: ['CCS', 'XCCY', 'CCIRS', 'Cross currency', 'Currency swap', 'Basis swap'],
  repo: ['REPO', 'RREPO', 'REV REPO', 'Repurchase', 'Reverse repo', 'Buy sell back', 'Repa'],
  otc: ['OTC', 'OTC deriv', 'Exotic', 'Asian option', 'Variance swap', 'Correlation swap', 'Structured swap'],
  swaption: ['SWPTN', 'SWAPTION', 'Payer swaption', 'Receiver swaption'],
  cap_floor: ['CAP', 'FLOOR', 'COLLAR', 'Interest rate cap', 'Rate floor'],
  inflation_swap: ['ZCIS', 'INFL SWAP', 'Inflation swap', 'HICP swap', 'CPI swap'],
  exotic_option: ['BARRIER', 'DIGITAL', 'Knock-in option', 'Binary option', 'Barrier option'],
  sec_lending: ['SECLEND', 'SEC LENDING', 'Securities loan', 'Stock loan', 'Lent securities']
};
const NONE_TYPES = ['Total', 'Grand total', 'Subtotal', 'Sum', 'Summa', 'N/A', 'NA', 'None', 'Unknown', '-', 'Other', 'Misc', 'TBD', 'Header', 'Page 1', 'Total NAV', 'Liabilities', 'Accruals', 'Fees payable'];

// ---- datasets -----------------------------------------------------------------------------------------
function columnData() {
  const data = [];
  const classes = [...Object.keys(FIELDS), '__none'];
  for (const key of Object.keys(FIELDS)) {
    const spec = FIELDS[key];
    const bases = [camelSplit(key), spec.en, ...(spec.aliases || []), ...(EXTRA_HEADERS[key] || [])].filter(Boolean);
    for (let i = 0; i < 220; i++) {
      const b = pick(bases);
      const header = i < bases.length ? b : vary(b);
      data.push({ feats: featuresOf(header, chance(0.7) ? sampleValues(key) : null), y: classes.indexOf(key) });
    }
  }
  for (let i = 0; i < 900; i++) {
    const h = pick(NONE_HEADERS);
    data.push({ feats: featuresOf(i < NONE_HEADERS.length ? h : vary(h), chance(0.7) ? noneValues(h) : null), y: classes.indexOf('__none') });
  }
  return { data, classes };
}
function typeData() {
  const data = [];
  const classes = [...Object.keys(INSTRUMENTS), '__none'];
  for (const id of Object.keys(INSTRUMENTS)) {
    const bases = [id.replace(/_/g, ' '), INSTRUMENTS[id].en, ...(TYPE_ALIASES[id] || []), ...(TYPE_CODES[id] || [])];
    for (let i = 0; i < 260; i++) {
      const b = pick(bases);
      data.push({ feats: featuresOf(i < bases.length ? b : vary(b)), y: classes.indexOf(id) });
    }
  }
  for (let i = 0; i < 500; i++) { const b = pick(NONE_TYPES); data.push({ feats: featuresOf(i < NONE_TYPES.length ? b : vary(b)), y: classes.indexOf('__none') }); }
  return { data, classes };
}

// ---- softmax regression, plain SGD with L2 -------------------------------------------------------------
function train({ data, classes }, { epochs = 14, lr0 = 0.4, l2 = 2e-5 } = {}) {
  const K = classes.length;
  const W = new Map();
  const bias = new Float64Array(K);
  const row = f => W.get(f) || W.set(f, new Float64Array(K)).get(f);
  const order = data.map((_, i) => i);
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const lr = lr0 / (1 + ep * 0.5);
    for (const idx of order) {
      const { feats, y } = data[idx];
      const z = Float64Array.from(bias);
      const rows = feats.map(row);
      for (const r of rows) for (let k = 0; k < K; k++) z[k] += r[k];
      const m = Math.max(...z);
      let tot = 0;
      for (let k = 0; k < K; k++) { z[k] = Math.exp(z[k] - m); tot += z[k]; }
      for (let k = 0; k < K; k++) {
        const g = z[k] / tot - (k === y ? 1 : 0);
        bias[k] -= lr * g * 0.1;
        for (const r of rows) r[k] -= lr * (g + l2 * r[k]);
      }
    }
  }
  // Sparse and quantised: only the weights that matter, in hundredths, as [class, w, class, w, ...].
  const w = {};
  for (const f of [...W.keys()].sort((a, b) => a - b)) {
    const r = W.get(f), out = [];
    for (let k = 0; k < K; k++) if (Math.abs(r[k]) >= 0.1) out.push(k, Math.round(r[k] * 100));
    if (out.length) w[f] = out;
  }
  return { classes, scale: 0.01, bias: [...bias].map(x => Math.round(x * 1000) / 1000), w };
}

// ---- evaluation on the hand-written set ----------------------------------------------------------------
function evaluate(model, items, input, want, min = 0.5) {
  let right = 0, suggested = 0, suggestedRight = 0;
  const misses = [];
  for (const it of items) {
    const [best] = scores(model, input(it));
    if (best.label === want(it)) right++; else misses.push(`${JSON.stringify(it.header || it.code)} → ${best.label} (${(best.p * 100).toFixed(0)} %), want ${want(it)}`);
    if (best.p >= min && best.label !== '__none') { suggested++; if (best.label === want(it)) suggestedRight++; }
  }
  return { n: items.length, top1: right / items.length, suggested: suggested / items.length, precision: suggested ? suggestedRight / suggested : 1, misses };
}

// What the model was trained from: the registry it learns and the code that trains and reads it.
// Floating point may differ in the last bit between Node versions, so --check compares this
// fingerprint rather than the weights.
const fingerprint = createHash('sha256').update(JSON.stringify([FIELDS, TYPE_ALIASES, Object.fromEntries(Object.entries(INSTRUMENTS).map(([k, d]) => [k, d.en])), OPTION_LABELS]))
  .update(readFileSync(new URL(import.meta.url), 'utf8')).update(readFileSync(new URL('../js/suggest.js', import.meta.url), 'utf8')).digest('hex').slice(0, 16);
if (check) {
  let current = null;
  try { current = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* missing */ }
  if (current?.fingerprint !== fingerprint) { console.error(`${OUT} was trained on a different registry or training code. Run: node scripts/train-import-model.mjs`); process.exit(1); }
  console.log(`${OUT} matches the registry and training code (${fingerprint}).`);
  process.exit(0);
}

const columns = train(columnData());
const types = train(typeData());
const model = { version: 1, fingerprint, trainedOn: 'js/instruments.js registry (synthetic variants); see scripts/train-import-model.mjs', columns, types };

const test = JSON.parse(readFileSync('tests/fixtures/import-suggest-testset.json', 'utf8'));
const ec = evaluate(columns, test.columns, it => featuresOf(it.header, it.values), it => it.field);
const et = evaluate(types, test.types, it => featuresOf(it.code), it => it.type);
const pct = x => (x * 100).toFixed(0) + ' %';
console.log(`Columns: top-1 ${pct(ec.top1)} on ${ec.n} unseen headers; suggested at ≥50 %: ${pct(ec.suggested)}, of which right ${pct(ec.precision)}`);
console.log(`Types:   top-1 ${pct(et.top1)} on ${et.n} unseen codes;  suggested at ≥50 %: ${pct(et.suggested)}, of which right ${pct(et.precision)}`);
if (process.argv.includes('--verbose')) [...ec.misses, ...et.misses].forEach(m => console.log('  miss:', m));

const json = JSON.stringify(model) + '\n';
mkdirSync('js/models', { recursive: true });
writeFileSync(OUT, json);
console.log(`Wrote ${OUT} (${(json.length / 1024).toFixed(0)} KB)`);
