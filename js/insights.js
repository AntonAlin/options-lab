// Oversight analytics built on holdings over time and on hypothetical changes: what changed
// between two dates, holdings-based (realised) performance, active vs passive limit breaches,
// pre-trade what-if, Brinson attribution and the ESMA-style liquidity stress test.
// Pure functions of plain data like analytics.js, so the tests can check every number.
import { valuePortfolio, factorModel, fixedIncome, liquidity, compliance, concentration, seriesKeyFor, perfStats } from './analytics.js';
import { regionOf } from './instruments.js';
import { isNum, num, sum, mean, uid } from './util.js';

// ---- positions ---------------------------------------------------------------------------------------
// Fields that scale with the size of a position. Prices, rates and dates do not.
export const QTY_FIELDS = ['qty', 'buyAmount', 'sellAmount', 'mtm', 'reportedNotional', 'reportedDeltaExposure'];
export const sizeOf = pos => (isNum(pos.qty) ? pos.qty : isNum(pos.buyAmount) ? pos.buyAmount : null);

export function scalePosition(pos, k) {
  const out = { ...pos };
  for (const f of QTY_FIELDS) if (isNum(out[f])) out[f] *= k;
  return out;
}

// Same key the bulk upload uses to recognise a holding: ISIN, then ticker, then name.
export const posKey = x => (x.isin && 'i:' + String(x.isin).toUpperCase()) || (x.ticker && 't:' + String(x.ticker).toUpperCase() + '|' + x.type) || (x.name && 'n:' + String(x.name).toLowerCase() + '|' + x.type) || 'x:' + (x.id || '');

// A portfolio as it stood on a snapshot date: same settings, that day's holdings.
export const atSnapshot = (p, snap) => ({ ...p, positions: snap.positions, valDate: snap.date });

// Last price on or before `date` in the price history, or null.
export function priceAt(history, key, date) {
  const s = history?.series?.[key];
  if (!s || !history.dates?.length) return null;
  for (let i = history.dates.length - 1; i >= 0; i--) if (history.dates[i] <= date && isNum(s[i])) return s[i];
  return null;
}

// Yesterday's holdings at today's prices: the positions of `prev`, with market data taken from
// the same holding in `next` (quantities kept), or from the price history for anything sold.
// What cannot be priced is carried at its old price and listed in `unpriced`.
export function reprice(prev, next, { history = null, date = '' } = {}) {
  const queue = new Map();
  next.forEach(x => { const k = posKey(x); (queue.get(k) || queue.set(k, []).get(k)).push(x); });
  const unpriced = [];
  const positions = prev.map(a => {
    const b = (queue.get(posKey(a)) || []).shift();
    const sa = sizeOf(a), sb = b ? sizeOf(b) : null;
    if (b && isNum(sa) && isNum(sb) && sb !== 0) return { ...scalePosition(b, sa / sb), id: a.id };
    if (a.type === 'cash') return a;
    const key = history ? seriesKeyFor(a, history) : null;
    const px = key ? priceAt(history, key, date) : null;
    if (isNum(px)) return { ...a, price: px };
    unpriced.push(a);
    return a;
  });
  return { positions, unpriced };
}

// ---- one period between two snapshots --------------------------------------------------------------
// v0: holdings at A; v1: holdings at A priced at B; vB: holdings at B.
//   return   = v1 / v0 − 1                  (holdings-based: what the A portfolio earned)
//   price effect per holding = mv1 − mv0;  trading effect = mvB − mv1
//   flows    ≈ NAV_B − v1                  (trades between securities and cash net out, so what
//                                           is left is subscriptions/redemptions, fees, dividends paid out)
//   turnover = min(Σ buys, Σ sells) / average NAV
export function period(p, a, b) {
  const pa = atSnapshot(p, a), pb = atSnapshot(p, b);
  const rp = reprice(a.positions, b.positions, { history: p.history, date: b.date });
  const v0 = valuePortfolio(pa), v1 = valuePortfolio({ ...pb, positions: rp.positions }), vB = valuePortfolio(pb);
  const rows = new Map();
  const at = (x, k) => { const key = posKey(x.pos); const o = rows.get(key) || rows.set(key, { key, name: x.name, type: x.pos.type, row: x, qtyA: 0, qtyB: 0, mv0: 0, mv1: 0, mvB: 0, inA: false, inB: false }).get(key); return o; };
  v0.valid.forEach(x => { const o = at(x); o.mv0 += x.r.mv; o.qtyA += num(sizeOf(x.pos)); o.inA = true; });
  v1.valid.forEach(x => { at(x).mv1 += x.r.mv; });
  vB.valid.forEach(x => { const o = at(x); o.mvB += x.r.mv; o.qtyB += num(sizeOf(x.pos)); o.inB = true; o.row = x; o.name = x.name; });
  const nav0 = v0.nav, list = [...rows.values()];
  list.forEach(o => {
    o.priceEffect = o.mv1 - o.mv0;
    o.tradeEffect = o.mvB - o.mv1;
    o.contrib = nav0 ? o.priceEffect / nav0 : 0;
    o.wA = nav0 ? o.mv0 / nav0 : 0;
    o.wB = vB.nav ? o.mvB / vB.nav : 0;
    o.status = !o.inA ? 'new' : !o.inB ? 'sold' : Math.abs(o.qtyB - o.qtyA) > 1e-9 * Math.max(1, Math.abs(o.qtyA)) ? (o.qtyB > o.qtyA ? 'added' : 'reduced') : 'held';
  });
  // Cash moves with every trade; counting it as bought/sold would double the turnover.
  const traded = list.filter(o => o.row?.r.assetClass !== 'cash' && o.row?.def.group !== 'derivatives');
  const buys = sum(traded.map(o => Math.max(0, o.tradeEffect))), sells = sum(traded.map(o => Math.max(0, -o.tradeEffect)));
  const avgNav = (nav0 + vB.nav) / 2;
  return {
    from: a.date, to: b.date, v0, v1, vB, rows: list,
    ret: nav0 ? v1.nav / nav0 - 1 : NaN,
    flows: vB.nav - v1.nav, buys, sells, turnover: avgNav ? Math.min(buys, sells) / avgNav : 0,
    unpriced: rp.unpriced
  };
}

// ---- realised performance over all snapshots --------------------------------------------------------
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

export function realised(p, snaps, { rf = num(p.risk?.riskFree, 2) / 100 } = {}) {
  if (!snaps || snaps.length < 2) return null;
  const periods = [];
  for (let i = 1; i < snaps.length; i++) periods.push(period(p, snaps[i - 1], snaps[i]));
  const ret = periods.map(q => q.ret);
  const idx = [1];
  ret.forEach(r => idx.push(idx[idx.length - 1] * (1 + (isNum(r) ? r : 0))));
  const gap = mean(periods.map(q => days(q.from, q.to))) || 1;
  const ppy = 365.25 / gap;
  // Benchmark over the same dates, from its series in the price history.
  let bench = null;
  if (p.benchmark && p.history?.series?.[p.benchmark]) {
    const px = snaps.map(s => priceAt(p.history, p.benchmark, s.date));
    bench = px.slice(1).map((x, i) => (isNum(x) && isNum(px[i]) && px[i] > 0 ? x / px[i] - 1 : NaN));
  }
  const stats = ret.filter(isNum).length >= 5 ? perfStats(ret, { rf, periodsPerYear: ppy, bench }) : null;
  // Contribution by holding: arithmetic sum of period contributions (a good approximation for
  // short periods; it does not compound).
  const byKey = new Map();
  for (const q of periods) for (const o of q.rows) {
    const c = byKey.get(o.key) || byKey.set(o.key, { key: o.key, name: o.name, type: o.type, contrib: 0, pnl: 0 }).get(o.key);
    c.contrib += o.contrib; c.pnl += o.priceEffect; c.name = o.name;
  }
  const total = idx[idx.length - 1] - 1;
  return {
    dates: snaps.map(s => s.date), nav: [periods[0].v0.nav, ...periods.map(q => q.vB.nav)], index: idx,
    ret, periods, bench, stats, total, periodsPerYear: ppy,
    flows: sum(periods.map(q => q.flows)), turnover: sum(periods.map(q => q.turnover)),
    turnoverAnnual: sum(periods.map(q => q.turnover)) * 365.25 / Math.max(1, days(snaps[0].date, snaps[snaps.length - 1].date)),
    byHolding: [...byKey.values()].sort((x, y) => y.contrib - x.contrib),
    unpriced: [...new Set(periods.flatMap(q => q.unpriced.map(x => x.name || x.isin || x.ticker)))]
  };
}

// ---- key figures for comparisons (changes, what-if) ---------------------------------------------------
export function keyMetrics(p) {
  const v = valuePortfolio(p);
  const nav = v.nav || 1;
  const fi = fixedIncome(v), risk = factorModel(v), liq = liquidity(v), comp = compliance(v, liq), conc = concentration(v);
  const within = h => liq.buckets.find(b => b.h === h)?.pct ?? 0;
  const issuers = comp.rules.find(r => r.id === 'issuerMax');
  return {
    v, fi, risk, liq, comp,
    nav: v.nav, n: v.valid.length,
    varPct: risk.varPct, esPct: risk.esPct, volPct: risk.volPct,
    duration: fi.portfolioDuration, spreadDuration: fi.portfolioSpreadDuration,
    gross: v.leverage, commitment: v.derivCommit / nav, net: v.netExposure / nav,
    equity: sum(v.valid.map(x => x.r.eqDelta)) / nav, cash: v.cash / nav,
    liq1: within(1), liq7: within(7), illiquid: liq.illiquidPct, top10: conc.top10,
    maxIssuer: issuers ? issuers.value / 100 : null,
    breaches: comp.breaches, warnings: comp.warnings
  };
}
export const METRIC_KEYS = ['nav', 'n', 'varPct', 'esPct', 'volPct', 'duration', 'spreadDuration', 'gross', 'commitment', 'net', 'equity', 'cash', 'liq1', 'liq7', 'illiquid', 'top10', 'maxIssuer', 'breaches', 'warnings'];

// Rule by rule: status before and after, and what changed.
export function ruleChanges(before, after) {
  const ids = [...new Set([...before.comp.rules.map(r => r.id), ...after.comp.rules.map(r => r.id)])];
  const rank = { ok: 0, warn: 1, breach: 2 };
  return ids.map(id => {
    const a = before.comp.rules.find(r => r.id === id), b = after.comp.rules.find(r => r.id === id);
    const sa = a?.status || 'ok', sb = b?.status || 'ok';
    return { id, before: a, after: b, from: sa, to: sb, dir: rank[sb] - rank[sa] };
  });
}

// Everything the "Changes" page shows for two snapshots.
export function compareSnapshots(p, a, b) {
  const per = period(p, a, b);
  const before = keyMetrics(atSnapshot(p, a)), after = keyMetrics(atSnapshot(p, b));
  // Risk contributors that moved most.
  const riskOf = m => new Map(m.risk.byPosition.map(x => [posKey(x.row.pos), { name: x.row.name, pct: x.pct }]));
  const ra = riskOf(before), rb = riskOf(after);
  const riskMoves = [...new Set([...ra.keys(), ...rb.keys()])].map(k => ({ key: k, name: (rb.get(k) || ra.get(k)).name, from: ra.get(k)?.pct ?? 0, to: rb.get(k)?.pct ?? 0 }))
    .map(x => ({ ...x, delta: x.to - x.from })).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 10);
  return { period: per, before, after, rules: ruleChanges(before, after), riskMoves };
}

// ---- active vs passive breaches over time ---------------------------------------------------------------
// For each snapshot the limits are checked on the actual holdings and on the previous day's
// holdings at today's prices. A breach that the unchanged holdings would also have had is
// passive (the market moved); one that only the traded holdings have is active (a trade did it).
// UCITS art. 57: an active breach is corrected at once; a passive one as a priority, taking due
// account of unitholders' interests.
export function breachHistory(p, snaps, { max = 260 } = {}) {
  if (!snaps || !snaps.length) return null;
  const s = snaps.slice(-max);
  const check = pp => { const v = valuePortfolio(pp); return compliance(v, liquidity(v)); };
  const timeline = s.map((snap, i) => {
    const actual = check(atSnapshot(p, snap));
    let counter = null;
    if (i > 0) {
      const rp = reprice(s[i - 1].positions, snap.positions, { history: p.history, date: snap.date });
      counter = check({ ...atSnapshot(p, snap), positions: rp.positions });
    }
    return { date: snap.date, actual, counter };
  });
  const ids = [...new Set(timeline.flatMap(x => x.actual.rules.map(r => r.id)))];
  const episodes = [];
  for (const id of ids) {
    let open = null;
    timeline.forEach((d, i) => {
      const r = d.actual.rules.find(x => x.id === id);
      const breach = r?.status === 'breach';
      if (breach && !open) {
        const c = d.counter?.rules.find(x => x.id === id);
        const cause = i === 0 ? 'unknown' : c?.status === 'breach' ? 'passive' : 'active';
        open = { id, start: d.date, end: null, cause, peak: r.value, limit: r.limit, dir: r.dir, days: 0 };
        episodes.push(open);
      } else if (breach && open) {
        open.peak = r.dir === 'min' ? Math.min(open.peak, r.value) : Math.max(open.peak, r.value);
      } else if (!breach && open) {
        open.end = d.date; open = null;
      }
    });
  }
  const last = s[s.length - 1].date;
  episodes.forEach(e => { e.days = Math.round(days(e.start, e.end || last)); e.ongoing = !e.end; });
  episodes.sort((a, b) => b.start.localeCompare(a.start));
  return {
    dates: timeline.map(d => d.date),
    rules: ids.map(id => ({ id, statuses: timeline.map(d => d.actual.rules.find(r => r.id === id)?.status || 'ok'), values: timeline.map(d => d.actual.rules.find(r => r.id === id)?.value ?? null) })),
    episodes, checked: s.length, truncated: snaps.length > s.length
  };
}

// ---- pre-trade what-if ------------------------------------------------------------------------------------
// trades: [{ id (existing position) | pos (new position), mode: 'qty' | 'delta' | 'weight', value }]
//   qty    → set the size to value;  delta → add value to the size;  weight → size so the holding is value (fraction) of NAV
// The change in market value is booked against `cashId` (a cash position) unless cashId is '' (no offset).
export function applyTrades(p, trades, { cashId = null } = {}) {
  const before = valuePortfolio(p);
  const positions = p.positions.map(x => ({ ...x }));
  const mvOf = pos => { const v = valuePortfolio({ ...p, positions: [pos] }); return v.valid[0]?.r.mv ?? 0; };
  let cashNeeded = 0;
  const applied = [];
  for (const tr of trades) {
    // A new instrument comes in at the size it was entered with.
    if (tr.pos) {
      const pos = { ...tr.pos, id: tr.pos.id || uid() };
      positions.push(pos);
      const d = mvOf(pos);
      cashNeeded += d;
      applied.push({ tr, mv: d });
      continue;
    }
    const i = positions.findIndex(x => x.id === tr.id);
    if (i < 0) continue;
    const pos = positions[i];
    const size = sizeOf(pos) ?? 0;
    const mv0 = mvOf(pos);
    let target = size;
    if (tr.mode === 'qty') target = num(tr.value);
    else if (tr.mode === 'delta') target = size + num(tr.value);
    else if (tr.mode === 'weight') {
      const unit = size ? mv0 / size : mvOf({ ...pos, qty: 1 });
      target = unit ? num(tr.value) * before.nav / unit : size;
    }
    const next = size ? scalePosition(pos, target / size) : { ...pos, qty: target };
    positions[i] = next;
    const d = mvOf(next) - mv0;
    cashNeeded += d;
    applied.push({ tr, mv: d });
  }
  if (cashId !== '' && Math.abs(cashNeeded) > 0) {
    let c = cashId ? positions.findIndex(x => x.id === cashId) : positions.findIndex(x => x.type === 'cash' && (x.ccy || p.baseCcy) === p.baseCcy);
    if (c < 0) { positions.push({ id: uid(), type: 'cash', name: 'Cash ' + p.baseCcy, qty: 0, ccy: p.baseCcy }); c = positions.length - 1; }
    const cash = positions[c];
    const fx = mvOf({ ...cash, qty: 1 }) || 1;
    positions[c] = { ...cash, qty: num(cash.qty) - cashNeeded / fx };
  }
  return { portfolio: { ...p, positions }, cashNeeded, applied };
}

export function whatIf(p, trades, opts = {}) {
  const { portfolio, cashNeeded, applied } = applyTrades(p, trades, opts);
  const before = keyMetrics(p), after = keyMetrics(portfolio);
  return { portfolio, before, after, rules: ruleChanges(before, after), cashNeeded, applied };
}

// ---- Brinson-Fachler attribution -----------------------------------------------------------------------------
// port / bench: [{ segment, weight, ret }] with weights summing to 1 on each side.
//   allocation_i  = (wp_i − wb_i) · (Rb_i − Rb)
//   selection_i   = wb_i · (Rp_i − Rb_i)
//   interaction_i = (wp_i − wb_i) · (Rp_i − Rb_i)
// A segment missing on one side takes the other side's return there, so its effect lands in
// allocation (benchmark only) or interaction (portfolio only). Σ effects = Rp − Rb.
export function brinson(port, bench) {
  const norm = rows => { const t = sum(rows.map(r => num(r.weight))); return rows.map(r => ({ ...r, weight: t ? num(r.weight) / t : 0 })); };
  const P = norm(port), B = norm(bench);
  const key = s => String(s ?? '').trim().toLowerCase();
  const segs = [...new Set([...P.map(r => key(r.segment)), ...B.map(r => key(r.segment))])];
  const Rp = sum(P.map(r => r.weight * num(r.ret))), Rb = sum(B.map(r => r.weight * num(r.ret)));
  const rows = segs.map(k => {
    const p = P.find(r => key(r.segment) === k), b = B.find(r => key(r.segment) === k);
    const wp = p?.weight ?? 0, wb = b?.weight ?? 0;
    const rb = b ? num(b.ret) : Rb;
    const rp = p ? num(p.ret) : rb;
    return {
      segment: (p || b).segment, wp, wb, rp: p ? rp : null, rb: b ? rb : null,
      allocation: (wp - wb) * (rb - Rb), selection: wb * (rp - rb), interaction: (wp - wb) * (rp - rb),
      inPortfolio: !!p, inBenchmark: !!b
    };
  });
  rows.forEach(r => { r.total = r.allocation + r.selection + r.interaction; });
  const tot = k => sum(rows.map(r => r[k]));
  return { rows: rows.sort((a, b) => Math.abs(b.total) - Math.abs(a.total)), Rp, Rb, active: Rp - Rb, allocation: tot('allocation'), selection: tot('selection'), interaction: tot('interaction') };
}

export const SEGMENT_DIMS = ['assetClass', 'sector', 'region', 'country', 'currency'];
export function segmentOf(x, dim) {
  if (dim === 'assetClass') return x.r.assetClass || 'other';
  if (dim === 'sector') return x.pos.sector || '—';
  if (dim === 'region') return regionOf(x.pos.country);
  if (dim === 'country') return (x.pos.country || '—').toUpperCase();
  return x.pos.ccy || x.pos.buyCcy || '—';
}

// Portfolio side of the attribution, by segment. From two snapshots (holdings-based) when there
// are any, otherwise today's holdings over the price history between the two dates. Segments
// whose weight is too small to carry a return (a derivative overlay alone) go to `residual`,
// so the totals still reconcile.
export function portfolioSegments(p, dim, { from = null, to = null, snaps = null } = {}) {
  let items = [], nav = 0, basis = 'snapshots', coverage = 1;
  if (snaps && snaps.length >= 2) {
    const a = snaps.find(s => s.date === from) || snaps[0], b = snaps.find(s => s.date === to) || snaps[snaps.length - 1];
    const per = period(p, a, b);
    nav = per.v0.nav;
    items = per.rows.filter(o => o.inA).map(o => ({ seg: segmentOf(o.row, dim), mv0: o.mv0, pnl: o.priceEffect }));
    return finish(items, nav, { basis, from: a.date, to: b.date, coverage });
  }
  const h = p.history;
  if (!h?.dates?.length || !from || !to) return null;
  basis = 'history';
  const v = valuePortfolio(p);
  nav = v.nav;
  let covered = 0;
  items = v.valid.map(x => {
    const k = seriesKeyFor(x.pos, h);
    const a = k ? priceAt(h, k, from) : null, b = k ? priceAt(h, k, to) : null;
    const r = isNum(a) && isNum(b) && a > 0 ? b / a - 1 : (x.r.assetClass === 'cash' ? 0 : null);
    if (r !== null) covered += Math.abs(x.r.mv);
    return { seg: segmentOf(x, dim), mv0: x.r.mv, pnl: r === null ? 0 : x.r.mv * r };
  });
  coverage = sum(v.valid.map(x => Math.abs(x.r.mv))) ? covered / sum(v.valid.map(x => Math.abs(x.r.mv))) : 0;
  return finish(items, nav, { basis, from, to, coverage });
}
function finish(items, nav, meta) {
  const m = new Map();
  items.forEach(i => { const o = m.get(i.seg) || m.set(i.seg, { segment: i.seg, mv0: 0, pnl: 0 }).get(i.seg); o.mv0 += i.mv0; o.pnl += i.pnl; });
  const rows = [], small = [];
  for (const o of m.values()) {
    const w = nav ? o.mv0 / nav : 0;
    if (Math.abs(w) < 0.001) small.push(o); else rows.push({ segment: o.segment, weight: w, ret: o.mv0 ? o.pnl / o.mv0 : 0 });
  }
  const residual = nav ? sum(small.map(o => o.pnl)) / nav : 0;
  return { rows, residual, total: nav ? sum(items.map(i => i.pnl)) / nav : 0, ...meta };
}

// ---- liquidity stress test ---------------------------------------------------------------------------------------
// ESMA Guidelines on liquidity stress testing in UCITS and AIFs (ESMA34-39-897): does the fund
// meet a redemption of R % of NAV within the horizon, and what does it look like afterwards?
//   coverage = assets that can be sold within the horizon / redemption amount   (≥ 1 passes)
//   waterfall: sell the most liquid first;  vertical slice: sell R % of every asset.
// Derivatives are not sold, so the post-redemption portfolio carries the same derivative book on a
// smaller NAV. Market impact of the sales is not modelled.
export const LST_REDEMPTIONS = [0.05, 0.1, 0.2, 0.3];
export function liquidityStress(p, { redemptions = LST_REDEMPTIONS, horizon = 7, stressed = true } = {}) {
  const v = valuePortfolio(p);
  const liq = liquidity(v, { stressed });
  const within = h => sum(liq.rows.map(q => q.row.r.mv * (q.days <= h ? 1 : h / q.days)));
  const liquid = within(horizon);
  const nav = v.nav;
  const scenarios = redemptions.map(R => {
    const amount = R * nav;
    // Waterfall: fastest first, pro-rata inside the horizon.
    const order = [...liq.rows].sort((a, b) => a.days - b.days);
    let left = amount;
    const sold = new Map();
    for (const q of order) {
      if (left <= 0) break;
      const can = q.row.r.mv * (q.days <= horizon ? 1 : horizon / q.days);
      const s = Math.min(can, left);
      if (s > 0) { sold.set(q.row.pos.id, s); left -= s; }
    }
    const shortfall = Math.max(0, left);
    const scaleBy = (fn) => ({ ...p, positions: p.positions.map(pos => { const k = fn(pos); return k === 1 ? pos : scalePosition(pos, k); }) });
    const rowOf = new Map(v.valid.map(x => [x.pos.id, x]));
    const water = scaleBy(pos => { const s = sold.get(pos.id); const x = rowOf.get(pos.id); return s && x?.r.mv ? Math.max(0, 1 - s / x.r.mv) : 1; });
    const assetIds = new Set(liq.rows.map(q => q.row.pos.id));
    const vertical = scaleBy(pos => (assetIds.has(pos.id) ? 1 - R : 1));
    const post = pp => { const vv = valuePortfolio(pp); const l = liquidity(vv, { stressed }); const c = compliance(vv, l); return { nav: vv.nav, illiquid: l.illiquidPct, cash: vv.nav ? vv.cash / vv.nav : 0, commitment: vv.nav ? vv.derivCommit / vv.nav : 0, breaches: c.rules.filter(r => r.status === 'breach').map(r => r.id), comp: c }; };
    const daysNeeded = (() => { let acc = 0; for (const q of order) { acc += q.row.r.mv; if (acc >= amount) return q.days; } return Infinity; })();
    return {
      R, amount, coverage: amount ? liquid / amount : Infinity, pass: liquid >= amount - 1e-6, shortfall,
      daysNeeded, waterfall: post(water), vertical: post(vertical)
    };
  });
  const before = compliance(v, liq);
  return { nav, horizon, stressed, liquid, maxRedemption: nav ? liquid / nav : 0, scenarios, breachesBefore: before.rules.filter(r => r.status === 'breach').map(r => r.id) };
}

// Benchmark segments from a pasted table or file: segment | weight | return. Headers in English
// or Swedish are recognised; without them the first three columns are taken in that order.
// Weights are normalised later, so % or fractions both work. Returns: 'auto' reads them as %
// when any is above 1 in absolute value (a 1.5 % return is far more likely than a 150 % one).
const SEG_H = ['segment', 'sector', 'sektor', 'bransch', 'industry', 'region', 'country', 'land', 'class', 'assetclass', 'tillgångsslag', 'tillgangsslag', 'currency', 'valuta', 'category', 'kategori', 'name', 'namn'];
const W_H = ['weight', 'vikt', 'w', 'andel', 'weightpct', 'benchmarkweight', 'indexvikt', 'indexweight'];
const R_H = ['return', 'ret', 'avkastning', 'performance', 'totalreturn', 'r', 'utveckling'];
export function parseBenchmark(rows, { decimal = '.', unit = 'auto', parseNumber, normKey }) {
  if (!rows.length) return { rows: [], error: 'empty' };
  const h = rows[0].map(x => normKey(x));
  let si = h.findIndex(x => SEG_H.includes(x)), wi = h.findIndex(x => W_H.includes(x)), ri = h.findIndex(x => R_H.includes(x));
  const hasHeader = si >= 0 || wi >= 0 || ri >= 0;
  if (!hasHeader) [si, wi, ri] = [0, 1, 2];
  if (si < 0) si = [0, 1, 2].find(c => c !== wi && c !== ri);
  if (wi < 0 || ri < 0) return { rows: [], error: 'columns' };
  const out = [];
  for (const r of rows.slice(hasHeader ? 1 : 0)) {
    const seg = String(r[si] ?? '').trim(), w = parseNumber(r[wi], decimal), ret = parseNumber(r[ri], decimal);
    if (!seg || !isNum(w) || !isNum(ret) || /^(total|summa|sum)$/i.test(seg)) continue;
    out.push({ segment: seg, weight: w, ret });
  }
  const pct = unit === 'percent' || (unit === 'auto' && out.some(r => Math.abs(r.ret) > 1));
  if (pct) out.forEach(r => { r.ret /= 100; });
  return { rows: out, percent: pct, error: out.length ? null : 'empty' };
}
