// NAV control: the management company's check of the administrator's NAV. The official NAV is the
// administrator's; this module compares it with the platform's shadow NAV and explains the gap.
//   1. NAV reconciliation per share class, with a bridge from the administrator's total to ours
//   2. Position and cash reconciliation against the administrator's holdings file
//   3. Price checks: stale prices, outsized moves, missing prices, prices that differ from the administrator's
//   4. Fee checks: management and performance fee accruals against what the administrator booked
//   5. A break log with status and comment, kept on the portfolio and exportable
// Pure functions; the NAV control page wires them up and tests/core.test.mjs covers them.
import { INSTRUMENTS, normKey, resolveType } from './instruments.js';
import { coerce, detectDecimal, parseNumber, guessField, findHeaderRow, autoMapping } from './importer.js';
import { cellDate, isPortfolioHeader, datedLayout } from './sourcefile.js';
import { isNum, num, sum, parseISODate, DAY_MS } from './util.js';

export const DEFAULT_NC = {
  navTolBp: 5,      // NAV per unit difference that counts as a break
  feeTolBp: 0.5,    // fee accrual difference, bp of the class's NAV
  priceTolBp: 25,   // price difference against the administrator
  qtyTol: 0.01,     // absolute quantity difference (units, nominal)
  mvTolBp: 0.5,     // market value difference, bp of fund NAV
  staleDays: 5,     // calendar days with an unchanged price
  moveScale: 1      // multiplies the move thresholds below
};
export const MAX_ADMIN_DATES = 12;
export const MAX_LOG = 1000;

// One-day move that is worth a second look, % per asset type. Scaled by √(trading days) between the
// two observations, so a month between snapshots does not flag every ordinary month.
export const MOVE_LIMITS = {
  equity: 10, etf: 8, fund: 6, govt_bond: 2, inflation_linked: 2.5, corp_bond: 3, frn: 1, money_market: 0.5, convertible: 8,
  commodity: 8, future: 10, option: 35, certificate: 25, exotic_option: 35, alternative: 15
};
// Types with no price of their own (valued from notional, spread or counterparty MTM).
const UNPRICED = new Set(['cash', 'repo', 'sec_lending', 'fx_forward', 'irs', 'ccs', 'cds', 'otc', 'swaption', 'cap_floor', 'inflation_swap', 'variance_swap', 'equity_swap', 'unknown']);
// Prices that legitimately stand still for weeks.
const SLOW = new Set(['alternative']);

// ---- file parsing -------------------------------------------------------------------------------------
const NAV_HEADERS = {
  className: ['shareclass', 'class', 'andelsklass', 'klass', 'classname', 'isinclass', 'shareclassname', 'unitclass'],
  navPerUnit: ['navperunit', 'navpershare', 'nav', 'andelsvärde', 'andelskurs', 'navperandel', 'kurs', 'price', 'navunit', 'officialnav'],
  units: ['units', 'shares', 'unitsoutstanding', 'sharesoutstanding', 'andelar', 'antalandelar', 'utestående', 'utestaendeandelar', 'outstanding'],
  totalNav: ['totalnav', 'classnav', 'netassets', 'fondförmögenhet', 'fondformogenhet', 'totalnetassets', 'navtotal', 'aum', 'klassförmögenhet'],
  ccy: ['currency', 'ccy', 'valuta', 'classcurrency'],
  mgmtFee: ['managementfee', 'mgmtfee', 'accruedmanagementfee', 'förvaltningsavgift', 'forvaltningsavgift', 'upplupenförvaltningsavgift', 'managementfeeaccrued', 'amc'],
  perfFee: ['performancefee', 'perffee', 'accruedperformancefee', 'prestationsbaseradavgift', 'resultatbaseradavgift', 'incentivefee', 'performancefeeaccrued']
};
const NAV_INDEX = new Map(Object.entries(NAV_HEADERS).flatMap(([f, al]) => al.map(a => [a, f])));
const navField = h => {
  const k = normKey(h);
  if (NAV_INDEX.has(k)) return NAV_INDEX.get(k);
  const stripped = normKey(String(h ?? '').replace(/\(.*?\)|\[.*?\]/g, ''));
  return NAV_INDEX.get(stripped) || '';
};

// Administrator NAV file: one row per date and share class. Returns { rows, error }.
export function parseAdminNav(rows) {
  let hr = -1;
  for (let i = 0; i < Math.min(15, rows.length) && hr < 0; i++) if (rows[i].filter(c => navField(c)).length >= 2) hr = i;
  if (hr < 0) return { rows: [], error: 'no_header' };
  const header = rows[hr].map(h => String(h ?? '').trim());
  const map = header.map(h => navField(h));
  let dateCol = header.findIndex(h => /date|datum|dag|asof/i.test(normKey(h)));
  if (dateCol < 0) dateCol = 0;
  map[dateCol] = '';
  const pfCol = header.findIndex((h, c) => c !== dateCol && isPortfolioHeader(h));
  if (pfCol >= 0) map[pfCol] = '';
  const body = rows.slice(hr + 1);
  const dec = detectDecimal(body.slice(0, 200).flat(), ';');
  const out = [];
  for (const r of body) {
    const date = cellDate(r[dateCol]);
    if (!date) continue;
    const o = { date, portfolio: pfCol >= 0 ? String(r[pfCol] ?? '').trim() : '', className: '', ccy: '' };
    map.forEach((f, c) => {
      if (!f) return;
      if (f === 'className') o.className = String(r[c] ?? '').trim();
      else if (f === 'ccy') o.ccy = String(r[c] ?? '').trim().toUpperCase();
      else { const x = typeof r[c] === 'number' ? r[c] : parseNumber(r[c], dec); if (isNum(x)) o[f] = x; }
    });
    if (isNum(o.navPerUnit) || isNum(o.totalNav)) out.push(o);
  }
  if (!out.length) return { rows: [], error: 'no_rows' };
  if (!map.includes('navPerUnit') && !map.includes('totalNav')) return { rows: [], error: 'no_nav' };
  return { rows: out, error: '' };
}

// Administrator holdings file: date (optional), portfolio (optional), and the usual position columns.
// Returns { byDate: { date: items[] }, error }. A file without a date column gets `fallbackDate`.
export function parseAdminHoldings(rows, fallbackDate = '') {
  const hr = findHeaderRow(rows);
  const header = (rows[hr] || []).map(h => String(h ?? '').trim());
  const layout = datedLayout(rows, hr);
  const mapping = autoMapping(header);
  // "Market value (SEK)", "MV base", "Marknadsvärde fondvaluta": the base-currency value, not local.
  header.forEach((h, c) => { if (/\b(base|bas|fund\s*c(urrenc)?y|portfolio\s*c(urrenc)?y|fondvaluta|basvaluta)\b/i.test(h) && ['mtm', ''].includes(guessField(h) || '')) mapping[c] = 'mvBase'; });
  if (layout.dateCol >= 0) mapping[layout.dateCol] = '';
  if (layout.pfCol >= 0) mapping[layout.pfCol] = '';
  if (!mapping.includes('qty') && !mapping.includes('mtm') && !mapping.includes('mvBase')) return { byDate: {}, error: 'no_columns' };
  const body = rows.slice(hr + 1);
  const dec = detectDecimal(body.slice(0, 200).flat(), ';');
  const byDate = {};
  for (const r of body) {
    const date = layout.dateCol >= 0 ? cellDate(r[layout.dateCol]) : fallbackDate;
    if (!date) continue;
    const it = { portfolio: layout.pfCol >= 0 ? String(r[layout.pfCol] ?? '').trim() : '' };
    mapping.forEach((f, c) => {
      if (!f) return;
      if (f === 'type') { it.rawType = String(r[c] ?? '').trim(); return; }
      if (f === 'mvBase') { const x = typeof r[c] === 'number' ? r[c] : parseNumber(r[c], dec); if (isNum(x)) it.mvBase = x; return; }
      if (!['isin', 'ticker', 'name', 'qty', 'price', 'ccy', 'mtm', 'multiplier'].includes(f)) return;
      const v = coerce(f, r[c], dec);
      if (v !== undefined && v !== '') it[f] = v;
    });
    if (!it.name && !it.isin && !it.ticker && !isNum(it.qty)) continue;
    it.type = it.rawType ? resolveType(it.rawType) || '' : '';
    it.cash = it.type === 'cash' || (!it.isin && !it.ticker && /^(cash|kassa|likvid|bank|konto|account|current account|depos)/i.test(it.name || ''));
    (byDate[date] = byDate[date] || []).push(it);
  }
  if (!Object.keys(byDate).length) return { byDate: {}, error: layout.dateCol < 0 && !fallbackDate ? 'no_date' : 'no_rows' };
  return { byDate, error: '' };
}

// Rows for this portfolio: those naming it (by name or connected-file key), or all of them when the
// file carries a single portfolio (or none).
export function forPortfolio(items, p) {
  const names = new Set([p.name, p.source?.key].filter(Boolean).map(normKey));
  const own = items.filter(x => !x.portfolio || names.has(normKey(x.portfolio)));
  if (own.length) return own;
  return new Set(items.map(x => x.portfolio)).size <= 1 ? items : [];
}

// ---- 2. holdings reconciliation ----------------------------------------------------------------------
const up = s => String(s ?? '').trim().toUpperCase();
const nameKey = s => normKey(s);

function aggregate(list) {
  const m = new Map();
  for (const x of list) {
    const k = x.isin ? 'i:' + up(x.isin) : x.ticker ? 't:' + up(x.ticker) : 'n:' + nameKey(x.name);
    const o = m.get(k);
    if (!o) m.set(k, { ...x, key: k });
    else {
      o.qty = num(o.qty) + num(x.qty);
      o.mv = isNum(o.mv) || isNum(x.mv) ? num(o.mv) + num(x.mv) : o.mv;
      o.mvBase = isNum(o.mvBase) || isNum(x.mvBase) ? num(o.mvBase) + num(x.mvBase) : o.mvBase;
      o.mtm = isNum(o.mtm) || isNum(x.mtm) ? num(o.mtm) + num(x.mtm) : o.mtm;
    }
  }
  return [...m.values()];
}

// Match on ISIN, then ticker, then name — each administrator line is used once.
function match(own, adm) {
  const pairs = [], leftA = new Set(adm);
  const by = f => { const m = new Map(); for (const a of adm) { const k = f(a); if (k) (m.get(k) || m.set(k, []).get(k)).push(a); } return m; };
  const idx = [by(a => a.isin && up(a.isin)), by(a => a.ticker && up(a.ticker)), by(a => a.name && nameKey(a.name))];
  const keys = [o => o.isin && up(o.isin), o => o.ticker && up(o.ticker), o => o.name && nameKey(o.name)];
  for (const o of own) {
    let hit = null;
    for (let i = 0; i < 3 && !hit; i++) {
      const k = keys[i](o);
      const list = k ? idx[i].get(k) : null;
      hit = list?.find(a => leftA.has(a)) || null;
    }
    if (hit) leftA.delete(hit);
    pairs.push([o, hit]);
  }
  for (const a of leftA) pairs.push([null, a]);
  return pairs;
}

// v: valued portfolio (the platform's side) for the date; admItems: administrator lines for the date.
export function reconcileHoldings(v, admItems, cfg = DEFAULT_NC) {
  const c = { ...DEFAULT_NC, ...cfg };
  const fx = v.ctx.fx;
  const nav = Math.abs(v.nav) || 1;
  const isOwnCash = x => x.pos.type === 'cash' && !x.pos.maturity;
  const own = aggregate(v.rows.filter(x => x.pos.type !== 'unknown' || x.pos.qty).filter(x => !isOwnCash(x)).map(x => ({
    name: x.name || x.pos.name, isin: x.pos.isin, ticker: x.pos.ticker, type: x.pos.type, ccy: x.pos.ccy,
    qty: num(x.pos.qty), price: x.pos.price, mv: x.r ? x.r.mv : NaN
  })));
  const adm = aggregate(admItems.filter(a => !a.cash));
  const rows = match(own, adm).map(([o, a]) => {
    const r = { name: (o || a).name || (o || a).isin || (o || a).ticker || '—', isin: (o || a).isin || '', type: o?.type || a?.type || '', ccy: o?.ccy || a?.ccy || '' };
    r.ownQty = o ? o.qty : null; r.admQty = a ? num(a.qty, NaN) : null;
    r.ownPrice = o && isNum(o.price) ? o.price : null; r.admPrice = a && isNum(a.price) ? a.price : null;
    r.ownMv = o ? o.mv : 0;
    // The administrator's value: their base-currency MV, else their local MV at our FX, else our value
    // rescaled by their quantity and price (right for anything priced linearly), else quantity × price.
    const afx = fx(a?.ccy || r.ccy);
    if (!a) r.admMv = 0;
    else if (isNum(a.mvBase)) r.admMv = a.mvBase;
    else if (isNum(a.mtm) && isNum(afx)) r.admMv = a.mtm * afx;
    else if (o && isNum(o.mv) && o.qty) r.admMv = o.mv * num(a.qty) / o.qty * (isNum(a.price) && isNum(o.price) && o.price ? a.price / o.price : 1);
    else { r.admMv = isNum(afx) ? num(a.qty) * num(a.price) * num(a.multiplier, 1) * afx : NaN; r.approx = true; }
    r.mvDiff = num(r.ownMv) - num(r.admMv);
    r.qtyDiff = o && a ? r.ownQty - num(r.admQty) : null;
    r.priceDiffBp = isNum(r.ownPrice) && isNum(r.admPrice) && r.admPrice ? (r.ownPrice / r.admPrice - 1) * 1e4 : null;
    if (!a) r.status = 'missing_admin';
    else if (!o) r.status = 'missing_own';
    else if (Math.abs(r.qtyDiff) > Math.max(c.qtyTol, 1e-9 * Math.abs(r.ownQty))) r.status = 'qty';
    else if (isNum(r.priceDiffBp) && Math.abs(r.priceDiffBp) > c.priceTolBp) r.status = 'price';
    else if (Math.abs(r.mvDiff) / nav * 1e4 > c.mvTolBp) r.status = 'value';
    else r.status = 'ok';
    // Split the value gap: the part the quantity explains, and the rest (price, FX, accrued interest).
    r.qtyEffect = o && a && o.qty ? num(r.ownMv) * (1 - num(a.qty) / o.qty) : 0;
    r.priceEffect = o && a ? r.mvDiff - r.qtyEffect : 0;
    return r;
  });
  // Cash is compared per currency, whatever the account names.
  const cashBy = new Map();
  const addCash = (ccy, side, amt) => { const k = up(ccy) || v.ctx.base; const o = cashBy.get(k) || { ccy: k, own: 0, adm: 0 }; o[side] += amt; cashBy.set(k, o); };
  v.rows.filter(isOwnCash).forEach(x => addCash(x.pos.ccy, 'own', num(x.pos.qty)));
  admItems.filter(a => a.cash).forEach(a => addCash(a.ccy, 'adm', isNum(a.qty) ? a.qty : num(a.mtm)));
  const cash = [...cashBy.values()].map(o => {
    const f = fx(o.ccy);
    const diffBase = isNum(f) ? (o.own - o.adm) * f : NaN;
    return { ...o, diff: o.own - o.adm, diffBase, status: !isNum(diffBase) ? 'fx_missing' : Math.abs(diffBase) / nav * 1e4 > c.mvTolBp ? 'cash' : 'ok' };
  }).sort((a, b) => Math.abs(num(b.diffBase)) - Math.abs(num(a.diffBase)));
  const S = f => sum(rows.map(f).filter(isNum));
  const effects = {
    missingAdmin: S(r => (r.status === 'missing_admin' ? r.mvDiff : 0)),
    missingOwn: S(r => (r.status === 'missing_own' ? r.mvDiff : 0)),
    qty: S(r => r.qtyEffect),
    price: S(r => r.priceEffect),
    cash: sum(cash.map(x => x.diffBase).filter(isNum))
  };
  const breaks = rows.filter(r => r.status !== 'ok');
  rows.sort((a, b) => (a.status === 'ok') - (b.status === 'ok') || Math.abs(num(b.mvDiff)) - Math.abs(num(a.mvDiff)));
  return { rows, cash, effects, total: sum(Object.values(effects)), breaks: breaks.length + cash.filter(x => x.status !== 'ok').length, matched: rows.filter(r => r.status !== 'missing_admin' && r.status !== 'missing_own').length };
}

// ---- 1 & 4. NAV and fee reconciliation -----------------------------------------------------------------
// nav: navPerUnit() for the date; admRows: administrator NAV rows for the date; hold: reconcileHoldings().
export function reconcileNav(nav, admRows, v, hold = null, cfg = DEFAULT_NC) {
  const c = { ...DEFAULT_NC, ...cfg };
  if (!nav.ok) return { ok: false, reason: nav.reason };
  if (!admRows.length) return { ok: false, reason: 'no_admin' };
  const fx = ccy => v.ctx.fx(ccy || v.ctx.base);
  const left = new Set(admRows);
  const pick = cls => {
    const byName = admRows.find(a => left.has(a) && a.className && nameKey(a.className) === nameKey(cls.name));
    const byCcy = !byName && admRows.filter(a => left.has(a) && (!a.ccy || a.ccy === (cls.ccy || v.ctx.base)));
    const hit = byName || (nav.classes.length === 1 && admRows.length === 1 ? admRows[0] : byCcy?.length === 1 ? byCcy[0] : null);
    if (hit) left.delete(hit);
    return hit;
  };
  const classes = nav.classes.map(cl => {
    const a = pick(cl);
    const f = fx(cl.ccy);
    const localNet = cl.netBase / f;
    const r = { id: cl.id, name: cl.name || cl.ccy, ccy: cl.ccy || v.ctx.base, shadowNav: cl.navPerUnit, units: num(cl.units), matched: !!a };
    if (!a) return { ...r, status: 'no_match' };
    r.admNav = isNum(a.navPerUnit) ? a.navPerUnit : isNum(a.totalNav) && num(a.units || cl.units) ? a.totalNav / num(a.units || cl.units) : null;
    r.admUnits = isNum(a.units) ? a.units : null;
    r.admTotal = isNum(a.totalNav) ? a.totalNav : isNum(r.admNav) ? r.admNav * num(r.admUnits ?? cl.units) : null;
    r.diffBp = isNum(r.admNav) && r.admNav ? (cl.navPerUnit / r.admNav - 1) * 1e4 : null;
    r.unitsDiff = isNum(r.admUnits) ? r.units - r.admUnits : null;
    // Fees, in the class currency.
    r.shadowMgmt = cl.accruedFee / f; r.shadowPerf = num(cl.accruedPerf) / f;
    r.admMgmt = isNum(a.mgmtFee) ? Math.abs(a.mgmtFee) : null; r.admPerf = isNum(a.perfFee) ? Math.abs(a.perfFee) : null;
    r.mgmtDiff = isNum(r.admMgmt) ? r.shadowMgmt - r.admMgmt : null;
    r.perfDiff = isNum(r.admPerf) ? r.shadowPerf - r.admPerf : null;
    const bp = x => (isNum(x) && localNet ? Math.abs(x) / Math.abs(localNet) * 1e4 : 0);
    r.feeStatus = !isNum(r.mgmtDiff) && !isNum(r.perfDiff) ? 'no_data' : bp(r.mgmtDiff) > c.feeTolBp || bp(r.perfDiff) > c.feeTolBp ? 'break' : 'ok';
    r.perfMissingHwm = cl.perfMissingHwm;
    r.perfHurdle = cl.perfHurdle;
    r.status = !isNum(r.diffBp) ? 'no_nav' : Math.abs(r.diffBp) > c.navTolBp ? 'break' : isNum(r.unitsDiff) && Math.abs(r.unitsDiff) > c.qtyTol ? 'units' : 'ok';
    r.shadowTotalBase = cl.netBase;
    r.admTotalBase = isNum(r.admTotal) ? r.admTotal * f : null;
    r.admFeesBase = (isNum(r.admMgmt) || isNum(r.admPerf)) ? (num(r.admMgmt) + num(r.admPerf)) * f : null;
    r.shadowFeesBase = cl.accruedFee + num(cl.accruedPerf);
    return r;
  });
  const m = classes.filter(r => isNum(r.admTotalBase));
  const shadowTotal = sum(m.map(r => r.shadowTotalBase)), admTotal = sum(m.map(r => r.admTotalBase));
  const diff = shadowTotal - admTotal;
  // Bridge from the administrator's NAV to ours. Our net = assets − fees; theirs likewise, so a fee
  // we accrue above theirs lowers our NAV: its effect is (their fees − our fees).
  const bridge = [];
  if (hold) {
    bridge.push(['missingAdmin', hold.effects.missingAdmin], ['missingOwn', hold.effects.missingOwn], ['qty', hold.effects.qty], ['price', hold.effects.price], ['cash', hold.effects.cash]);
  }
  const feeRows = m.filter(r => isNum(r.admFeesBase));
  if (feeRows.length) bridge.push(['fees', sum(feeRows.map(r => r.admFeesBase - r.shadowFeesBase))]);
  const explained = sum(bridge.map(b => b[1]));
  bridge.push(['residual', diff - explained]);
  return {
    ok: true, classes, shadowTotal, admTotal, diff, diffBp: admTotal ? diff / admTotal * 1e4 : null, bridge,
    unmatchedAdmin: [...left].map(a => a.className || a.ccy || '—'),
    breaks: classes.filter(r => r.status !== 'ok').length, feeBreaks: classes.filter(r => r.feeStatus === 'break').length
  };
}

// ---- 3. price checks -----------------------------------------------------------------------------------
const tradingDays = (a, b) => Math.max(1, Math.round((parseISODate(b) - parseISODate(a)) / DAY_MS * 5 / 7));
const pk = x => (x.isin ? 'i:' + up(x.isin) : x.ticker ? 't:' + up(x.ticker) : 'n:' + nameKey(x.name)) + '|' + x.type;

// positions: holdings on `date`; snaps: earlier snapshots [{ date, positions }] (any order);
// hold: optional reconcileHoldings() for the same date (adds "differs from the administrator").
export function priceChecks(positions, date, snaps, hold = null, cfg = DEFAULT_NC) {
  const c = { ...DEFAULT_NC, ...cfg };
  const prev = snaps.filter(s => s.date < date).sort((a, b) => b.date.localeCompare(a.date)); // newest first
  const priceMaps = prev.map(s => { const m = new Map(); s.positions.forEach(x => { if (isNum(x.price)) m.set(pk(x), x.price); }); return { date: s.date, m }; });
  const out = [];
  for (const x of positions) {
    const def = INSTRUMENTS[x.type];
    if (!def || UNPRICED.has(x.type) || !def.fields.includes('price')) continue;
    if (x.type === 'cash' || (x.type === 'money_market' && !isNum(x.price))) continue;
    const base = { name: x.name || x.isin || x.ticker || '—', isin: x.isin || '', type: x.type, ccy: x.ccy, price: x.price };
    if (!isNum(x.price)) { if (def.required.includes('price')) out.push({ ...base, kind: 'missing' }); continue; }
    if (x.price <= 0 && x.type !== 'future') { out.push({ ...base, kind: 'nonpositive' }); continue; }
    const k = pk(x);
    // Stale: the same price back through the earlier snapshots.
    if (!SLOW.has(x.type)) {
      let since = null;
      for (const s of priceMaps) { const q = s.m.get(k); if (q === undefined) break; if (q !== x.price) break; since = s.date; }
      if (since) {
        const days = Math.round((parseISODate(date) - parseISODate(since)) / DAY_MS);
        if (days >= c.staleDays) out.push({ ...base, kind: 'stale', since, days });
      }
    }
    // Outsized move against the latest earlier price.
    const last = priceMaps.find(s => s.m.has(k));
    if (last) {
      const p0 = last.m.get(k);
      if (isNum(p0) && p0 > 0) {
        const move = x.price / p0 - 1;
        const limit = (MOVE_LIMITS[x.type] ?? 10) / 100 * c.moveScale * Math.sqrt(tradingDays(last.date, date));
        if (Math.abs(move) > limit) out.push({ ...base, kind: 'move', prevPrice: p0, prevDate: last.date, move, limit });
      }
    }
  }
  if (hold) hold.rows.filter(r => r.status === 'price').forEach(r => out.push({ name: r.name, isin: r.isin, type: r.type, ccy: r.ccy, price: r.ownPrice, kind: 'admin', admPrice: r.admPrice, diffBp: r.priceDiffBp }));
  const order = { missing: 0, nonpositive: 1, admin: 2, move: 3, stale: 4 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

// ---- 5. break log --------------------------------------------------------------------------------------
// Turn the check results for one date into log items: { kind, ref, detail, value }.
export function collectBreaks({ navRec, hold, prices }) {
  const out = [];
  if (navRec?.ok) {
    navRec.classes.forEach(r => {
      if (r.status === 'break') out.push({ kind: 'nav', ref: r.name, detail: `${r.name}: ${fmt(r.shadowNav, 4)} vs ${fmt(r.admNav, 4)}`, value: r.diffBp });
      if (r.status === 'units') out.push({ kind: 'units', ref: r.name, detail: `${r.name}: ${fmt(r.units, 2)} vs ${fmt(r.admUnits, 2)}`, value: r.unitsDiff });
      if (r.feeStatus === 'break') out.push({ kind: 'fee', ref: r.name, detail: `${r.name}: mgmt ${fmt(r.mgmtDiff, 0)}, perf ${fmt(r.perfDiff, 0)} ${r.ccy}`, value: num(r.mgmtDiff) + num(r.perfDiff) });
    });
  }
  if (hold) {
    hold.rows.filter(r => r.status !== 'ok').forEach(r => out.push({ kind: 'holding', ref: (r.isin || r.name) + '|' + r.status, detail: r.name, code: 'nc.st.' + r.status, value: r.mvDiff }));
    hold.cash.filter(r => r.status !== 'ok').forEach(r => out.push({ kind: 'cash', ref: r.ccy, detail: `${r.ccy}: ${fmt(r.own, 2)} vs ${fmt(r.adm, 2)}`, value: r.diffBase }));
  }
  (prices || []).forEach(r => out.push({ kind: 'price', ref: (r.isin || r.name) + '|' + r.kind, detail: r.name, code: 'nc.pk.' + r.kind, value: r.kind === 'move' ? r.move : r.kind === 'admin' ? r.diffBp : r.kind === 'stale' ? r.days : null }));
  return out;
}
const fmt = (x, d) => (isNum(x) ? x.toFixed(d) : '—');

// Merge one run into the log. An item of a kind that ran but no longer breaks on that date is closed
// as resolved (automatically — it reopens if the break comes back). Comments are never touched.
export function syncLog(log, date, breaks, kindsRun, now = new Date().toISOString()) {
  const list = (log || []).map(e => ({ ...e }));
  const byId = new Map(list.map(e => [e.id, e]));
  const seen = new Set();
  let changed = false;
  for (const b of breaks) {
    const id = `${b.kind}|${date}|${b.ref}`;
    seen.add(id);
    const e = byId.get(id);
    if (!e) { const n = { id, date, kind: b.kind, ref: b.ref, detail: b.detail, code: b.code || '', value: b.value ?? null, status: 'open', comment: '', firstSeen: now, updatedAt: now }; list.push(n); byId.set(id, n); changed = true; }
    else {
      if (e.status === 'resolved' && e.auto) { e.status = 'open'; e.auto = false; e.updatedAt = now; changed = true; }
      if (e.detail !== b.detail || e.value !== (b.value ?? null)) { e.detail = b.detail; e.value = b.value ?? null; changed = true; }
    }
  }
  for (const e of list) {
    if (e.date === date && kindsRun.includes(e.kind) && !seen.has(e.id) && e.status !== 'resolved') {
      e.status = 'resolved'; e.auto = true; e.updatedAt = now; changed = true;
    }
  }
  list.sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind) || a.ref.localeCompare(b.ref));
  return { log: list.slice(0, MAX_LOG), changed };
}
