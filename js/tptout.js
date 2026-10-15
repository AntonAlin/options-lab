// A FinDatEx Tripartite Template (TPT) for the manager's own fund: one row per position, the
// portfolio-level fields repeated on every row, as insurance and pension investors expect it each
// quarter for their Solvency II reporting. Built from the holdings and the platform's own valuation
// (analytics.valuePortfolio), so the market values, exposures, durations and deltas are the ones
// every other page shows. Pure: no browser APIs; tests/core.test.mjs reads the output back with
// js/tpt.js.
//
// What is filled: the identification, valuation, exposure, bond, derivative and sensitivity fields
// the platform knows (listed in TPT_OUT_FIELDS), the issuer LEI from the holding or the issuer
// register (47/48). What is not: the SCR contributions (fields 97–105), group codes, and anything
// else the platform does not hold. Field 11 (complete SCR
// delivery) is therefore always "N". Weights (9, 26, 30) are fractions of NAV (0.0525 = 5.25 %).
// CIC codes are derived from the instrument type; the types where that is a judgement call are
// reported in `warnings` so someone checks them before the file goes out.
import { isNum } from './util.js';
import { isLei } from './instruments.js';

// [field number, header]. Headers follow the TPT V6/V7 field names.
export const TPT_OUT_FIELDS = [
  ['1', 'Portfolio identifying data'], ['2', 'Type of identification code for the fund share or portfolio'], ['3', 'Portfolio name'],
  ['4', 'Portfolio currency (B)'], ['5', 'Net asset valuation of the portfolio or the share class in portfolio currency'], ['6', 'Valuation date'],
  ['7', 'Reporting date'], ['8', 'Share price'], ['8b', 'Total number of shares'], ['9', '% cash'], ['10', 'Portfolio modified duration'],
  ['11', 'Complete SCR delivery'], ['12', 'CIC code of the instrument'], ['13', 'Economic zone of the quotation place'],
  ['14', 'Identification code of the financial instrument'], ['15', 'Type of identification code for the instrument'], ['17', 'Instrument name'],
  ['18', 'Quantity'], ['19', 'Nominal amount'], ['20', 'Contract size for derivatives'], ['21', 'Quotation currency (A)'],
  ['22', 'Market valuation in quotation currency (A)'], ['23', 'Clean market valuation in quotation currency (A)'],
  ['24', 'Market valuation in portfolio currency (B)'], ['25', 'Clean market valuation in portfolio currency (B)'], ['26', 'Valuation weight'],
  ['27', 'Market exposure amount in quotation currency (A)'], ['28', 'Market exposure amount in portfolio currency (B)'], ['30', 'Market exposure in weight'],
  ['32', 'Interest rate type'], ['33', 'Coupon rate'], ['37', 'Interest rate margin'], ['38', 'Coupon payment frequency'], ['39', 'Maturity date'],
  ['40', 'Redemption type'], ['42', 'Callable / putable'], ['43', 'Call / put date'], ['46', 'Issuer name'], ['47', 'Issuer identification code'], ['48', 'Type of issuer identification code'], ['52', 'Issuer country'],
  ['54', 'Economic sector'], ['59', 'Credit quality step'], ['60', 'Call / Put / Cap / Floor'], ['61', 'Strike price'], ['64', 'Exercise type'],
  ['70', 'Name of the underlying asset'], ['72', 'Last valuation price of the underlying asset'], ['90', 'Modified duration to maturity date'],
  ['92', 'Credit sensitivity'], ['93', 'Sensitivity to underlying asset price (delta)']
];
export const tptHeader = () => TPT_OUT_FIELDS.map(([n, name]) => `${n}_${name}`);

// EEA members for field 13 (1 = EEA, 2 = OECD outside the EEA, 3 = other, 0 = not listed).
const EEA = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO'.split(' '));
const OECD = new Set('AU CA CL CO CR GB IL JP KR MX NZ CH TR US'.split(' '));
const zone = cc => (!cc || cc === 'XL' || cc === 'XT' ? 0 : EEA.has(cc) ? 1 : OECD.has(cc) ? 2 : 3);

// Rating → credit quality step (Solvency II mapping of the main agencies' long-term scale).
export function cqs(rating) {
  const r = String(rating || '').toUpperCase().replace(/[^A-Z]/g, '').replace(/^AAA$/, 'AAA');
  if (!r) return '';
  if (r === 'AAA') return 0;
  if (r.startsWith('AA')) return 1;
  if (r.startsWith('BBB')) return 3;
  if (r.startsWith('BB')) return 4;
  if (r.startsWith('A')) return 2;
  if (r.startsWith('B')) return 5;
  if (/^(CCC|CC|C|D|SD|RD)/.test(r)) return 6;
  return '';
}

const SUB = { GBX: ['GBP', 100], ZAC: ['ZAR', 100], ILA: ['ILS', 100] };
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const GOVT = /(govern|treasur|kingdom|republic|riksg|bund|state of|staat|ministry)/i;
const FUND_SUB = { equity: '1', fixed_income: '2', money_market: '3', mixed: '4', alternative: '6', commodity: '9' };
const ALT_SUB = { private_equity: '47', real_estate: '45', hedge_fund: '46', infrastructure: '48', private_credit: '42', other: '49' };
const UND_FUT = { equity: '1', rates: '2', fx: '3', commodity: '5', volatility: '1', credit: '9' };
const UND_OPT = { equity: '1', rates: '2', fx: '3', commodity: '5', volatility: '9', credit: '9' };
const UND_NOTE = { equity: '1', rates: '2', fx: '3', credit: '4', commodity: '6' };
// Types whose CIC is a reasonable reading of an ambiguous case: flagged for a human check.
const EXCHANGE = new Set(['equity', 'etf', 'future', 'option', 'commodity', 'certificate']);
const CHECK_CIC = new Set(['commodity', 'certificate', 'repo', 'otc', 'exotic_option', 'cap_floor', 'inflation_swap', 'alternative']);

// Listing country for the CIC: an exchange-traded security's ISIN country, 'XT' for anything traded
// over the counter or held at a bank, 'XL' for a security that is not listed.
function listing(pos, otc) {
  if (otc) return 'XT';
  const pre = ISIN_RE.test(pos.isin || '') ? pos.isin.slice(0, 2) : '';
  if (pre && !['XS', 'EU', 'XA', 'XB', 'XC', 'XD', 'XF', 'QS'].includes(pre)) return pre;
  if (pre) return /^[A-Z]{2}$/.test(pos.country || '') ? pos.country.toUpperCase() : 'LU'; // Eurobonds: listed in Luxembourg or Dublin as a rule
  // No ISIN: an exchange-traded instrument takes its country, anything else counts as not listed.
  if (EXCHANGE.has(pos.type) && /^[A-Z]{2}$/i.test(pos.country || '')) return pos.country.toUpperCase();
  return 'XL';
}

// CIC for one position: { cic, check } (check: a judgement call worth a look).
export function cicOf(pos) {
  const t = pos.type, u = pos.underlyingClass || 'equity';
  let otc = false, code = null;
  switch (t) {
    case 'equity': code = '31'; break;
    case 'etf': case 'fund': code = '4' + (FUND_SUB[pos.subClass] || '4'); break;
    case 'govt_bond': case 'inflation_linked': code = '11'; break;
    case 'corp_bond': code = '21'; break;
    case 'frn': code = GOVT.test(pos.issuer || '') ? '11' : '21'; break;
    case 'money_market': code = '24'; break;
    case 'convertible': code = '22'; break;
    case 'certificate': code = '5' + (UND_NOTE[u] || '9'); break;
    case 'commodity': code = '56'; break;
    case 'alternative': code = pos.altType === 'crypto' ? '09' : ALT_SUB[pos.altType] || '49'; break;
    case 'cash': otc = true; code = pos.maturity ? '73' : '71'; break;
    case 'repo': otc = true; code = '73'; break;
    case 'future': code = 'A' + (UND_FUT[u] || '9'); break;
    case 'option': code = (pos.optType === 'put' ? 'C' : 'B') + (UND_OPT[u] || '9'); break;
    case 'exotic_option': otc = true; code = (pos.optType === 'put' ? 'C' : 'B') + (UND_OPT[u] || '9'); break;
    case 'swaption': otc = true; code = (pos.payerReceiver === 'receiver' ? 'C' : 'B') + '6'; break;
    case 'cap_floor': otc = true; code = (pos.capFloor === 'floor' ? 'C' : 'B') + '2'; break;
    case 'fx_forward': otc = true; code = 'E2'; break;
    case 'irs': otc = true; code = 'D1'; break;
    case 'ccs': otc = true; code = 'D3'; break;
    case 'equity_swap': otc = true; code = 'D4'; break;
    case 'inflation_swap': otc = true; code = 'D9'; break;
    case 'cds': otc = true; code = 'F1'; break;
    case 'otc': otc = true; code = { rates: 'D9', fx: 'E9', credit: 'F9' }[u] || 'D9'; break;
    default: return null; // securities lending and unknown types are not reported as positions
  }
  return { cic: listing(pos, otc) + code, check: CHECK_CIC.has(t) };
}

const BONDS = new Set(['govt_bond', 'corp_bond', 'frn', 'money_market', 'convertible', 'inflation_linked']);
const NOMINAL = new Set([...BONDS, 'cash', 'repo', 'irs', 'ccs', 'cds', 'swaption', 'cap_floor', 'inflation_swap', 'otc']);
const round = (x, d = 2) => (isNum(x) ? Math.round(x * 10 ** d) / 10 ** d : '');

// v: analytics.valuePortfolio(p). opts: { id, idType ('1' = ISIN, else a code), reportDate, shareClass: { lastNav, units },
//   leiOf: pos => LEI (default: the holding's own issuerLei; the page passes store.leiOf, which adds the register) }
// Returns { rows: [header, ...], warnings: [{ code, name?, n? }], positions, excluded }.
export function buildTPT(p, v, opts = {}) {
  const warnings = [];
  const nav = v.nav;
  const fx = ccy => v.ctx.fx(ccy);
  const id = String(opts.id || '').trim();
  if (!id) warnings.push({ code: 'no_id' });
  const idType = opts.idType || (ISIN_RE.test(id) ? '1' : '9');
  const fiRows = v.valid.filter(x => x.r.fi && isNum(x.r.fi.modDur));
  const pfDur = nav ? fiRows.reduce((s, x) => s + x.r.fi.modDur * (x.r.fi.derivative ? x.r.net : x.r.mv), 0) / nav : '';
  const sc = opts.shareClass || null;
  const leiOf = opts.leiOf || (pos => pos.issuerLei || '');
  let noLei = 0;
  const pfFields = {
    1: id, 2: idType, 3: p.name, 4: p.baseCcy, 5: round(nav), 6: v.ctx.valDate, 7: opts.reportDate || v.ctx.valDate,
    8: sc && isNum(+sc.lastNav) && +sc.lastNav ? +sc.lastNav : '', '8b': sc && isNum(+sc.units) && +sc.units ? +sc.units : '',
    9: nav ? round(v.cash / nav, 6) : '', 10: round(pfDur, 4), 11: 'N'
  };
  const out = [tptHeader()];
  let excluded = 0;
  const check = new Map();
  for (const x of v.rows) {
    const pos = x.pos;
    const c = x.r ? cicOf(pos) : null;
    if (!c) { excluded++; continue; }
    if (c.check) check.set(pos.type, (check.get(pos.type) || 0) + 1);
    const r = x.r;
    let qc = pos.ccy || p.baseCcy, k = 1;
    if (SUB[qc]) [qc, k] = SUB[qc];
    const rate = fx(qc);
    const toQc = a => (isNum(a) && isNum(rate) && rate ? a / rate : '');
    const accrued = BONDS.has(pos.type) && r.fi && isNum(r.fi.accrued) && isNum(pos.qty) ? r.fi.accrued / 100 * pos.qty * (isNum(pos.poolFactor) ? pos.poolFactor : 1) * (isNum(pos.indexRatio) ? pos.indexRatio : 1) * (rate || 1) : 0;
    const f = { ...pfFields };
    f[12] = c.cic; f[13] = zone(c.cic.slice(0, 2));
    if (ISIN_RE.test(pos.isin || '')) { f[14] = pos.isin; f[15] = '1'; }
    else if (pos.ticker) { f[14] = pos.ticker; f[15] = '99'; }
    else { f[14] = pos.id; f[15] = '99'; }
    f[17] = x.name || pos.name || '';
    const qty = pos.type === 'fx_forward' || pos.type === 'ccs' ? pos.buyAmount : pos.qty;
    if (NOMINAL.has(pos.type)) f[19] = round(pos.type === 'cash' ? toQc(r.mv) : qty, 4); else f[18] = round(qty, 6);
    if (['future', 'option', 'exotic_option', 'certificate'].includes(pos.type) && isNum(pos.multiplier)) f[20] = pos.multiplier;
    f[21] = qc;
    f[22] = round(toQc(r.mv)); f[24] = round(r.mv);
    if (accrued) { f[23] = round(toQc(r.mv - accrued)); f[25] = round(r.mv - accrued); }
    f[26] = nav ? round(r.mv / nav, 8) : '';
    f[27] = round(toQc(r.net)); f[28] = round(r.net); f[30] = nav ? round(r.net / nav, 8) : '';
    if (BONDS.has(pos.type)) {
      f[32] = pos.type === 'frn' ? 'Floating' : 'Fixed';
      if (isNum(pos.coupon)) f[33] = pos.coupon;
      if (pos.type === 'frn' && isNum(pos.spread)) f[37] = round(pos.spread / 100, 4);
      if (isNum(+pos.freq) && pos.coupon !== 0) f[38] = +pos.freq; else if (pos.coupon === 0) f[38] = 0;
      f[40] = pos.structure === 'amortising' ? 'Sinkable' : 'Bullet';
      if (pos.callDate) { f[42] = 'Cal'; f[43] = pos.callDate; }
    }
    if (pos.maturity) f[39] = pos.maturity;
    f[46] = pos.issuer || (['equity', 'etf', 'fund'].includes(pos.type) ? pos.name || '' : '');
    // 47/48: the issuer's LEI (type 1); 9 = none. A malformed LEI is not passed on.
    const lei = String(leiOf(pos) || '').toUpperCase();
    if (lei && isLei(lei)) { f[47] = lei; f[48] = '1'; }
    else { f[48] = '9'; if (f[46] && !['cash', 'future', 'option'].includes(pos.type)) noLei++; }
    if (/^[A-Z]{2}$/i.test(pos.country || '')) f[52] = pos.country.toUpperCase();
    // Field 54 takes a NACE code; a free-text sector is not one, so it is only passed on when it is.
    if (/^[A-U]\d{0,2}(\.\d)*$/.test(String(pos.sector || '').trim())) f[54] = pos.sector.trim();
    const q = cqs(pos.rating || r.fi?.rating);
    if (q !== '') f[59] = q;
    if (['option', 'exotic_option'].includes(pos.type)) { f[60] = pos.optType === 'put' ? 'P' : 'C'; if (pos.type === 'option') f[64] = pos.exercise === 'american' ? 'AMER' : 'EURO'; }
    if (pos.type === 'swaption') f[60] = pos.payerReceiver === 'receiver' ? 'P' : 'C';
    if (pos.type === 'cap_floor') f[60] = pos.capFloor === 'floor' ? 'FLR' : 'CAP';
    if (isNum(pos.strike)) f[61] = pos.strike;
    if (isNum(pos.underlyingPrice)) f[72] = pos.underlyingPrice;
    else if (pos.type === 'future' && isNum(pos.price)) f[72] = pos.price;
    if (r.fi && isNum(r.fi.modDur)) f[90] = round(r.fi.modDur, 4);
    if (r.fi && isNum(r.fi.spreadDur) && r.fi.spreadDur) f[92] = round(r.fi.spreadDur, 4);
    if (r.deriv && isNum(r.deriv.delta)) f[93] = round(r.deriv.delta, 6);
    if (x.errors.some(e => e.code !== 'type_guessed')) warnings.push({ code: 'invalid', name: f[17] });
    out.push(TPT_OUT_FIELDS.map(([n]) => (f[n] === undefined || f[n] === null ? '' : f[n])));
  }
  if (excluded) warnings.push({ code: 'excluded', n: excluded });
  if (noLei) warnings.push({ code: 'no_lei', n: noLei });
  for (const [type, n] of check) warnings.push({ code: 'check_cic', type, n });
  if (v.fxMissing?.length) warnings.push({ code: 'fx_missing', list: v.fxMissing.join(', ') });
  return { rows: out, warnings, positions: out.length - 1, excluded };
}

export const tptFilename = (p, v, ext) => `TPT_${String(p.name || 'portfolio').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}_${v.ctx.valDate}.${ext}`;
