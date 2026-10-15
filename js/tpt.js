// FinDatEx Tripartite Template (TPT, versions 5–7): the holdings report a fund manager sends its
// insurance and pension investors. One row per position, columns headed by their TPT field number
// ("12_CIC code of the instrument", "12_CIC_code", or just "12"). The numbering of fields 1–95 is the
// same in every version, so a file is read by number, not by the wording of its headers.
//
// The file is turned into the platform's own row layout (Date, Portfolio, type and field columns),
// so everything after it — the source reader, the bulk upload, the data checks — works unchanged.
// Pure functions only; tests/core.test.mjs runs them under Node.
//
// What TPT does not carry is not invented: no volatility for options, no fixed/floating legs for
// swaps, no buy/sell legs for FX forwards. Those are read as counterparty MTM ('otc') with the
// reported market value, delta and duration, which is what the report gives. A CIC the table below
// does not know stays an unknown type and is held back, unvalued, like any other unknown type.
import { parseNumber, parseDate, detectDecimal } from './importer.js';
import { isNum } from './util.js';
import { isLei } from './instruments.js';

// Field numbers used. The names are the TPT V6/V7 field names.
const F = {
  pfId: '1', pfName: '3', pfCcy: '4', valDate: '6', repDate: '7',
  cic: '12', id: '14', idType: '15', name: '17', qty: '18', nominal: '19', size: '20', ccy: '21',
  mvQc: '22', cleanQc: '23', mvPc: '24', expQc: '27',
  rateType: '32', coupon: '33', margin: '37', freq: '38', maturity: '39', callable: '42', callDate: '43',
  issuer: '46', issuerId: '47', issuerIdType: '48', group: '49', country: '52', nace: '54', cqs: '59', cpcf: '60', strike: '61', exercise: '64',
  underName: '70', underPrice: '72', duration: '90', delta: '93', embedded: '95'
};

const CODE = /^\s*(\d{1,3}[a-z]?)(?=$|[\s_.\-:)])/i;
const codeOf = h => { const m = CODE.exec(String(h ?? '')); return m ? m[1].toLowerCase() : ''; };
// Category 0–9 and A–F; any other letter is still a CIC-shaped code, kept as an unknown type.
const CIC_RE = /^[A-Z0-9]{2}[0-9A-Z][0-9A-Z]$/;

// Header row and field number → column, or null when the rows are not a TPT file. A TPT header row
// names at least ten fields by number, the CIC (12) and the instrument identifier (14) among them.
export function detectTPT(rows) {
  let best = null;
  (rows || []).slice(0, 20).forEach((r, i) => {
    const cols = {};
    (r || []).forEach((h, c) => { const k = codeOf(h); if (k && !(k in cols)) cols[k] = c; });
    const n = Object.keys(cols).length;
    if (n >= 10 && F.cic in cols && F.id in cols && (!best || n > best.n)) best = { headerRow: i, cols, n };
  });
  if (!best) return null;
  // A text header can be followed by a second header row with the field names spelled out.
  const next = rows[best.headerRow + 1] || [];
  const cicCell = String(next[best.cols[F.cic]] ?? '').trim().toUpperCase();
  const dataStart = CIC_RE.test(cicCell) || !cicCell ? best.headerRow + 1 : best.headerRow + 2;
  return { headerRow: best.headerRow, dataStart, cols: best.cols };
}
export const isTPT = rows => !!detectTPT(rows);

// CIC: two characters for the listing country (or XL/XT for not listed / not exchange traded), one
// for the category, one for the sub-category.
const UNDERLYING = { 1: 'equity', 2: 'rates', 3: 'fx', 4: 'equity', 5: 'commodity', 6: 'rates', 7: 'equity', 8: 'rates' };
const FUND_CLASS = { 1: 'equity', 2: 'fixed_income', 3: 'money_market', 4: 'mixed', 5: 'alternative', 6: 'alternative', 7: 'alternative', 8: 'alternative', 9: 'mixed' };
// Equity share of a fund by its class; a mixed fund keeps the platform's default until someone knows better.
const EQUITY_SHARE = { equity: 100, fixed_income: 0, money_market: 0, alternative: 0 };
export function cicType(cicRaw, { floating = false } = {}) {
  const cic = String(cicRaw ?? '').trim().toUpperCase().replace(/\s/g, '');
  if (!CIC_RE.test(cic)) return null;
  const cat = cic[2], sub = cic[3];
  const bond = floating ? 'frn' : null;
  switch (cat) {
    case '1': return sub === '5' ? { type: 'money_market' } : ['6'].includes(sub) ? { type: bond || 'corp_bond' } : { type: bond || 'govt_bond' };
    case '2': return sub === '2' ? { type: 'convertible' } : ['3', '4'].includes(sub) ? { type: 'money_market' } : { type: bond || 'corp_bond' };
    case '3': return { type: 'equity' };
    case '4': { const subClass = FUND_CLASS[sub] || 'mixed'; return { type: 'fund', subClass, equityShare: EQUITY_SHARE[subClass] }; }
    case '5': return { type: 'certificate' };
    case '6': return { type: bond || 'corp_bond', structure: 'amortising' };
    case '7': return { type: 'cash' };
    case '8': return { type: 'alternative', altType: 'private_credit' };
    case '9': return { type: 'alternative', altType: 'real_estate' };
    case '0': return { type: 'alternative', altType: 'other' };
    case 'A': return { type: 'future', underlyingClass: UNDERLYING[sub] || 'equity' };
    case 'B': case 'C':
      // B6/C6 are swaptions: no rate or volatility in the report, so counterparty MTM.
      if (sub === '6') return { type: 'otc', underlyingClass: 'rates' };
      return { type: 'option', optType: cat === 'B' ? 'call' : 'put', underlyingClass: UNDERLYING[sub] || 'equity' };
    case 'D': return { type: 'otc', underlyingClass: { 1: 'rates', 2: 'fx', 3: 'fx', 4: 'equity', 5: 'equity', 6: 'commodity' }[sub] || 'rates' };
    case 'E': return { type: 'otc', underlyingClass: { 1: 'rates', 2: 'fx' }[sub] || 'rates' };
    case 'F': return { type: 'otc', underlyingClass: 'credit' };
    default: return null;
  }
}

// Credit quality step (Solvency II) → the rating scale the platform uses.
const CQS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC'];
// NACE section → sector, close enough for the sector breakdown.
const NACE = { A: 'Consumer Staples', B: 'Materials', C: 'Industrials', D: 'Utilities', E: 'Utilities', F: 'Industrials', G: 'Consumer Discretionary', H: 'Industrials', I: 'Consumer Discretionary', J: 'Communication Services', K: 'Financials', L: 'Real Estate', M: 'Industrials', N: 'Industrials', O: 'Government', P: 'Consumer Discretionary', Q: 'Health Care', R: 'Communication Services', S: 'Other', T: 'Other', U: 'Government' };
const NACE_DIV = { '05': 'Energy', '06': 'Energy', '09': 'Energy', 10: 'Consumer Staples', 11: 'Consumer Staples', 12: 'Consumer Staples', 19: 'Energy', 20: 'Materials', 21: 'Health Care', 24: 'Materials', 26: 'Information Technology', 35: 'Utilities', 61: 'Communication Services', 62: 'Information Technology', 63: 'Information Technology' };
export function naceSector(raw) {
  const s = String(raw ?? '').trim().toUpperCase();
  const m = /^([A-U])\s*?(\d{2})?/.exec(s);
  if (!m) return '';
  return (m[2] && NACE_DIV[m[2]]) || (m[2] && NACE_DIV[+m[2]]) || NACE[m[1]] || '';
}

const FREQ = { 1: '1', 2: '2', 4: '4', 12: '12' };
// The platform's columns, in the order the converted rows carry them.
export const TPT_COLUMNS = ['Date', 'Portfolio', 'type', 'name', 'isin', 'ticker', 'issuer', 'issuerLei', 'qty', 'price', 'dirtyPrice', 'ccy', 'coupon', 'freq', 'spread', 'maturity', 'callDate',
  'rating', 'country', 'sector', 'subClass', 'equityShare', 'altType', 'structure', 'underlyingClass', 'optType', 'strike', 'underlyingPrice', 'multiplier', 'exercise',
  'mtm', 'reportedNotional', 'reportedDelta', 'duration', 'notes'];

// rows: the sheet as read (header row(s) included). Returns
//   { rows: [TPT_COLUMNS, ...], skipped, lookThrough, portfolios: [..], dates: [..] }  or null when not TPT.
export function tptToRows(rows) {
  const info = detectTPT(rows);
  if (!info) return null;
  const { cols } = info;
  const body = rows.slice(info.dataStart);
  const numericCols = [F.qty, F.nominal, F.mvQc, F.cleanQc, F.coupon, F.strike].map(k => cols[k]).filter(c => c !== undefined);
  const dec = detectDecimal(body.slice(0, 200).flatMap(r => numericCols.map(c => r[c])).filter(x => typeof x === 'string'), ';');
  const cell = (r, k) => (cols[k] === undefined ? '' : r[cols[k]]);
  const txt = (r, k) => { const v = cell(r, k); return v instanceof Date ? parseDate(v) : String(v ?? '').trim(); };
  const num = (r, k) => { const n = parseNumber(cell(r, k), dec); return isNum(n) ? n : null; };
  const date = (r, k) => { const v = cell(r, k); return v === '' || v == null ? '' : parseDate(v); };
  const out = [TPT_COLUMNS];
  let skipped = 0, lookThrough = 0;
  const pfs = new Set(), dates = new Set();
  for (const r of body) {
    const cic = txt(r, F.cic).toUpperCase().replace(/\s/g, '');
    if (!CIC_RE.test(cic)) { if ((r || []).some(x => String(x ?? '').trim())) skipped++; continue; }
    // Positions of an underlying fund reported for look-through: the fund itself is already a row.
    const pfId = txt(r, F.pfId), emb = txt(r, F.embedded);
    if (emb && emb !== pfId) { lookThrough++; continue; }
    const asOf = date(r, F.valDate) || date(r, F.repDate);
    const pf = txt(r, F.pfName) || pfId;
    const floating = /^(float|variable|fl|var)/i.test(txt(r, F.rateType));
    const kind = cicType(cic, { floating });
    const o = { Date: asOf, Portfolio: pf };
    pfs.add(pf); if (asOf) dates.add(asOf);
    const id = txt(r, F.id), idType = txt(r, F.idType);
    if (idType === '1' || /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(id)) o.isin = id; else if (id) o.ticker = id;
    o.name = txt(r, F.name) || id;
    o.issuer = txt(r, F.issuer) || txt(r, F.group);
    // 47 with type 48 = 1 is the issuer's LEI; a code that passes the LEI check is taken as one too.
    const iid = txt(r, F.issuerId).toUpperCase();
    if (isLei(iid)) o.issuerLei = iid;
    const ccy = txt(r, F.ccy) || txt(r, F.pfCcy);
    o.ccy = ccy;
    o.country = txt(r, F.country).slice(0, 2).toUpperCase();
    o.sector = naceSector(txt(r, F.nace));
    const cqs = num(r, F.cqs);
    if (cqs !== null && CQS[cqs]) o.rating = CQS[cqs];
    o.maturity = date(r, F.maturity);
    o.duration = num(r, F.duration);
    o.notes = 'TPT CIC ' + cic;
    const qty = num(r, F.qty), nominal = num(r, F.nominal), size = num(r, F.size);
    const mv = num(r, F.mvQc) ?? num(r, F.mvPc), clean = num(r, F.cleanQc), exp = num(r, F.expQc);
    if (!kind) {
      o.type = 'CIC ' + cic; // unknown: held back until mapped
      o.qty = qty ?? nominal;
    } else {
      o.type = kind.type;
      for (const k of ['subClass', 'equityShare', 'altType', 'structure', 'underlyingClass', 'optType']) if (kind[k] !== undefined) o[k] = kind[k];
      const t = kind.type;
      if (['govt_bond', 'corp_bond', 'frn', 'money_market', 'convertible'].includes(t)) {
        const face = nominal ?? qty;
        o.qty = face;
        if (face) {
          if (clean !== null) { o.price = clean / face * 100; if (mv !== null) o.dirtyPrice = mv / face * 100; }
          else if (mv !== null) o.price = mv / face * 100;
        }
        o.coupon = num(r, F.coupon);
        const fq = num(r, F.freq);
        if (fq === 0) o.coupon = o.coupon ?? 0; else if (FREQ[fq]) o.freq = FREQ[fq];
        const m = num(r, F.margin);
        if (t === 'frn' && m !== null) o.spread = m * 100; // TPT: margin in %, platform: basis points
        if (/^cal/i.test(txt(r, F.callable))) o.callDate = date(r, F.callDate);
        if (t !== 'govt_bond' && !o.issuer) o.issuer = o.name;
      } else if (t === 'cash') {
        o.qty = mv ?? nominal ?? qty;
        o.name = o.name || 'Cash ' + ccy;
      } else if (t === 'future') {
        o.qty = qty ?? nominal;
        o.multiplier = size ?? 1;
        const up = num(r, F.underPrice);
        if (up !== null) o.price = up;
        else if (exp !== null && o.qty) o.price = Math.abs(exp / (o.qty * o.multiplier));
        o.mtm = mv;
        o.reportedNotional = exp;
      } else if (t === 'option') {
        o.qty = qty ?? nominal;
        o.multiplier = size ?? 1;
        o.strike = num(r, F.strike);
        o.underlyingPrice = num(r, F.underPrice);
        if (mv !== null && o.qty) o.price = mv / (o.qty * o.multiplier);
        o.mtm = mv;
        o.reportedDelta = num(r, F.delta);
        o.reportedNotional = exp;
        const ex = txt(r, F.exercise).toUpperCase();
        if (ex.startsWith('AM')) o.exercise = 'american'; else if (ex.startsWith('EU')) o.exercise = 'european';
      } else if (t === 'otc') {
        o.qty = nominal ?? qty ?? exp;
        o.mtm = mv ?? 0;
        o.reportedDelta = num(r, F.delta);
        if (o.name === id && txt(r, F.underName)) o.name = txt(r, F.underName);
      } else {
        // Equities, funds, certificates, alternatives: market value over quantity.
        let q = qty ?? nominal;
        const v = clean ?? mv;
        if (q === null && v !== null) q = 1;
        o.qty = q;
        if (v !== null && q) o.price = v / q;
      }
    }
    out.push(TPT_COLUMNS.map(k => (o[k] === null || o[k] === undefined ? '' : o[k])));
  }
  return { rows: out, skipped, lookThrough, portfolios: [...pfs], dates: [...dates].sort(), headerRow: info.headerRow };
}

// Every sheet that is a TPT file, converted; other sheets as they are. tpt: what was converted.
export function convertTPTSheets(sheets) {
  let tpt = null;
  const out = (sheets || []).map(sh => {
    const conv = tptToRows(sh.rows);
    if (!conv) return sh;
    tpt = tpt || { sheet: sh.name, skipped: conv.skipped, lookThrough: conv.lookThrough, portfolios: conv.portfolios, dates: conv.dates, rows: conv.rows.length - 1 };
    return { ...sh, rows: conv.rows, tpt: true };
  });
  return { sheets: out, tpt };
}
