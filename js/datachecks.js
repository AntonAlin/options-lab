// Checks a new set of holdings against the previous one before anyone relies on it: the typical
// errors in a daily custodian or administrator file. Robust statistics throughout — median and
// median absolute deviation (MAD) — so one bad day in the history does not mask the next one.
//   unit        price about 100× or 1/100 of the last one (pence/öre vs pounds/kronor, % vs per 1)
//   qty_scale   quantity about 10^±2 or 10^±3 of the last one (units vs thousands)
//   jump        a return far outside the holding's own history (|z| > 6 on the MAD of its daily
//               log returns, scaled to the days between the files); without enough history, far
//               outside what the rest of the file's same kind of holdings did (cross-section)
//   stale       price unchanged for ≥ 5 days while most of the file moved
//   price_missing / price_nonpositive, ccy (currency changed), sign (long ↔ short), dropped (a
//   holding of ≥ 5 % of NAV is not in a complete file)
// Pure functions; covered by tests/core.test.mjs. Nothing here changes data.
import { valuePortfolio, seriesKeyFor } from './analytics.js';
import { INSTRUMENTS } from './instruments.js';
import { isNum, parseISODate, DAY_MS } from './util.js';

const PRICED = new Set(['equity', 'etf', 'fund', 'govt_bond', 'corp_bond', 'frn', 'money_market', 'inflation_linked', 'convertible', 'certificate', 'commodity', 'alternative', 'future', 'option', 'exotic_option']);
const NO_JUMP = new Set(['future', 'option', 'exotic_option', 'certificate']);
const NO_STALE = new Set(['alternative', 'money_market']);
// Smallest move worth a flag, per kind of holding (a 7σ move in a T-bill is still tiny).
const FLOOR = { equity: 0.15, etf: 0.1, fund: 0.08, commodity: 0.12, alternative: 0.2, convertible: 0.1, govt_bond: 0.03, corp_bond: 0.05, frn: 0.03, inflation_linked: 0.04, money_market: 0.01 };
const PEERS = t => (['govt_bond', 'corp_bond', 'frn', 'inflation_linked', 'money_market'].includes(t) ? 'bonds' : 'risky');
const MAD_K = 1.4826;
export const Z_LIMIT = 6;

const median = xs => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
export function robustScale(xs) {
  const m = median(xs);
  return { median: m, sigma: MAD_K * median(xs.map(x => Math.abs(x - m))) };
}

const keysOf = x => [x.isin && 'i:' + String(x.isin).toUpperCase(), x.ticker && 't:' + String(x.ticker).toUpperCase() + '|' + x.type, x.name && 'n:' + String(x.name).toLowerCase().trim() + '|' + x.type].filter(Boolean);
const label = x => x.name || x.ticker || x.isin || x.type;
const near = (x, k, tol) => Math.abs(x / k - 1) < tol;

function tradingDays(a, b) {
  if (!a || !b) return 1;
  const d = Math.round((parseISODate(b) - parseISODate(a)) / DAY_MS);
  return Math.max(1, Math.round(Math.abs(d) * 5 / 7));
}

// prev, next: position lists. opts: { p (portfolio, for valuation and price history), prevDate,
// nextDate, complete (next is the whole portfolio, so a missing holding is a finding) }.
export function checkHoldings(prev, next, { p = null, prevDate = '', nextDate = '', complete = false } = {}) {
  const flags = [];
  const add = (severity, kind, pos, detail = {}) => flags.push({ severity, kind, name: label(pos), pos, detail });
  const index = new Map();
  prev.forEach((x, i) => keysOf(x).forEach(k => { if (!index.has(k)) index.set(k, i); }));
  const days = tradingDays(prevDate, nextDate);
  const pairs = [], seen = new Set();

  for (const b of next) {
    const def = INSTRUMENTS[b.type];
    if (PRICED.has(b.type) && def?.fields.includes('price') && isNum(b.price) && b.price <= 0 && b.type !== 'option') add('error', 'price_nonpositive', b, { price: b.price });
    const i = keysOf(b).map(k => index.get(k)).find(j => j !== undefined);
    if (i === undefined) continue;
    seen.add(i);
    const a = prev[i];
    pairs.push({ a, b });
    if (a.ccy && b.ccy && String(a.ccy).toUpperCase() !== String(b.ccy).toUpperCase()) add('error', 'ccy', b, { from: a.ccy, to: b.ccy });
    if (isNum(a.qty) && isNum(b.qty) && a.qty && b.qty) {
      const q = b.qty / a.qty;
      if (q < 0 && def?.group !== 'derivatives') add('warn', 'sign', b, { from: a.qty, to: b.qty });
      else if ([100, 1000, 0.01, 0.001].some(k => near(q, k, 0.02))) add('warn', 'qty_scale', b, { from: a.qty, to: b.qty, ratio: q });
    }
    if (!PRICED.has(b.type)) continue;
    if (isNum(a.price) && a.price > 0 && !(isNum(b.price) && b.price > 0) && def?.fields.includes('price') && !isNum(b.yield)) add('error', 'price_missing', b, { from: a.price });
  }

  // Price moves: unit errors first, then outliers against the holding's own history, else the file.
  const moves = pairs.filter(({ a, b }) => PRICED.has(b.type) && isNum(a.price) && isNum(b.price) && a.price > 0 && b.price > 0)
    .map(({ a, b }) => ({ a, b, r: Math.log(b.price / a.price) }));
  const unit = new Set();
  for (const m of moves) {
    const ratio = m.b.price / m.a.price;
    if (near(ratio, 100, 0.15) || near(ratio, 0.01, 0.15)) { add('error', 'unit', m.b, { from: m.a.price, to: m.b.price, ratio }); unit.add(m); }
  }
  const peers = {};
  for (const m of moves) if (!unit.has(m) && !NO_JUMP.has(m.b.type)) (peers[PEERS(m.b.type)] ||= []).push(m.r);
  const cross = Object.fromEntries(Object.entries(peers).filter(([, rs]) => rs.length >= 8).map(([k, rs]) => [k, robustScale(rs)]));
  const history = p?.history;
  for (const m of moves) {
    if (unit.has(m) || NO_JUMP.has(m.b.type)) continue;
    const floor = FLOOR[m.b.type] ?? 0.15;
    const key = history && seriesKeyFor(m.b, history);
    const series = key ? history.series[key].filter(x => isNum(x) && x > 0) : [];
    const rets = series.slice(-501).map((x, i, s) => (i ? Math.log(x / s[i - 1]) : null)).filter(isNum);
    if (rets.length >= 30) {
      const { sigma } = robustScale(rets);
      const z = sigma > 0 ? Math.abs(m.r) / (sigma * Math.sqrt(days)) : Infinity;
      if (z > Z_LIMIT && Math.abs(m.r) > floor) add('warn', 'jump', m.b, { from: m.a.price, to: m.b.price, ret: Math.exp(m.r) - 1, z, basis: 'history' });
    } else {
      const c = cross[PEERS(m.b.type)];
      if (!c || !(c.sigma > 0)) { if (Math.abs(m.r) > floor * 2) add('warn', 'jump', m.b, { from: m.a.price, to: m.b.price, ret: Math.exp(m.r) - 1, z: null, basis: 'floor' }); continue; }
      const z = Math.abs(m.r - c.median) / c.sigma;
      if (z > Z_LIMIT && Math.abs(m.r - c.median) > floor) add('warn', 'jump', m.b, { from: m.a.price, to: m.b.price, ret: Math.exp(m.r) - 1, z, basis: 'file' });
    }
  }
  // Stale: unchanged over a week while most of the file moved.
  const moved = moves.filter(m => m.r !== 0).length / (moves.length || 1);
  if (days >= 4 && moves.length >= 5 && moved >= 0.5) {
    for (const m of moves) if (m.r === 0 && !NO_STALE.has(m.b.type) && !NO_JUMP.has(m.b.type)) add('warn', 'stale', m.b, { price: m.b.price, since: prevDate });
  }
  // A big holding missing from a complete file.
  if (complete && p) {
    const v = valuePortfolio({ ...p, positions: prev });
    const nav = v.nav;
    prev.forEach((a, i) => {
      if (seen.has(i) || ['cash'].includes(a.type)) return;
      const row = v.rows.find(r => r.pos === a);
      const w = row?.r && nav ? Math.abs(row.r.mv) / nav : 0;
      if (w >= 0.05) add('warn', 'dropped', a, { weight: w });
    });
  }
  const order = { error: 0, warn: 1 };
  flags.sort((x, y) => order[x.severity] - order[y.severity] || x.kind.localeCompare(y.kind) || x.name.localeCompare(y.name));
  return { flags, compared: pairs.length, days, errors: flags.filter(f => f.severity === 'error').length, warnings: flags.filter(f => f.severity === 'warn').length };
}
