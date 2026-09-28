// Asset allocation on an economic basis, and the derivative book behind it.
//
// Market value answers "where is the money"; economic exposure answers "what moves the NAV".
// The difference is the derivative overlay: a short index future has ~zero market value but
// removes equity exposure one-for-one, a put removes it by its delta. Mixed funds are looked
// through with their equity share so a 60/40 fund shows up as 60 % equity and 40 % bonds.
import { regionOf } from './instruments.js';
import { sum, num, isNum } from './util.js';
import { RATING_BUCKETS } from './analytics.js';
import { ratingScore } from './instruments.js';

export const ALLOC_DIMS = ['auto', 'sector', 'region', 'currency', 'type'];
export const ALLOC_MEASURES = ['economic', 'mv', 'gross'];

function ratingBucket(r) {
  const s = ratingScore(r);
  if (s == null) return 'NR';
  return RATING_BUCKETS[s <= 1 ? 0 : s <= 4 ? 1 : s <= 7 ? 2 : s <= 10 ? 3 : s <= 13 ? 4 : s <= 16 ? 5 : 6];
}

// One row can land in several classes (a mixed fund). Each piece carries both its market value
// and its economic exposure, so the two views always add up to the same holdings.
export function pieces(x) {
  const { pos, r, def } = x;
  const deriv = def.group === 'derivatives';
  if (deriv) {
    // FX forwards and FX options are currency hedges, not asset-class bets: their economic value
    // is just the MTM. The currency split itself lives on the Exposure page.
    const econ = pos.type === 'fx_forward' || pos.underlyingClass === 'fx' ? r.mv : r.net;
    return [{ cls: r.assetClass, mv: r.mv, econ, deriv: true }];
  }
  if ((pos.type === 'fund' || pos.type === 'etf') && (pos.subClass || 'mixed') === 'mixed') {
    const eq = Math.min(1, Math.max(0, num(pos.equityShare, 50) / 100));
    return [
      { cls: 'equity', mv: r.mv * eq, econ: r.mv * eq, deriv: false, share: eq },
      { cls: 'fixed_income', mv: r.mv * (1 - eq), econ: r.mv * (1 - eq), deriv: false, share: 1 - eq }
    ].filter(p => p.share > 0);
  }
  return [{ cls: r.assetClass, mv: r.mv, econ: r.mv, deriv: false }];
}

function groupKey(x, cls, dim, base) {
  const { pos } = x;
  const d = dim === 'auto' ? (cls === 'equity' ? 'sector' : cls === 'fixed_income' ? 'rating' : 'type') : dim;
  if (d === 'sector') return (pos.sector || '').trim() || '—';
  if (d === 'rating') return pos.type === 'irs' ? '—' : ratingBucket(pos.rating);
  if (d === 'region') return regionOf(pos.country);
  if (d === 'currency') return pos.type === 'fx_forward' ? `${pos.buyCcy || '?'}/${pos.sellCcy || '?'}` : (pos.ccy || base);
  return 'type:' + pos.type;
}

export function allocationAnalysis(v, p = {}) {
  const nav = v.nav;
  const W = x => (nav ? x / nav : 0);
  const byCls = new Map();
  const get = k => {
    if (!byCls.has(k)) byCls.set(k, { key: k, mv: 0, econ: 0, physical: 0, overlay: 0, long: 0, short: 0, gross: 0, n: 0 });
    return byCls.get(k);
  };
  for (const x of v.valid) {
    for (const pc of pieces(x)) {
      const c = get(pc.cls);
      c.mv += pc.mv;
      c.econ += pc.econ;
      if (pc.deriv) c.overlay += pc.econ - pc.mv; else c.physical += pc.mv;
      if (pc.econ >= 0) c.long += pc.econ; else c.short += pc.econ;
      c.gross += Math.abs(pc.econ);
      c.n++;
    }
  }
  const targets = p.allocTargets || {};
  const classes = [...byCls.values()].filter(c => c.n && (Math.abs(W(c.mv)) >= 0.0005 || Math.abs(W(c.econ)) >= 0.0005 || targets[c.key])).map(c => {
    const t = targets[c.key] || {};
    const econW = W(c.econ);
    const lo = isNum(t.min) ? t.min / 100 : null, hi = isNum(t.max) ? t.max / 100 : null, tgt = isNum(t.target) ? t.target / 100 : null;
    const status = lo == null && hi == null ? null : (lo != null && econW < lo - 1e-9) || (hi != null && econW > hi + 1e-9) ? 'breach'
      : (lo != null && econW < lo + 0.02) || (hi != null && econW > hi - 0.02) ? 'warn' : 'ok';
    return { ...c, mvW: W(c.mv), econW, overlayW: W(c.overlay), longW: W(c.long), shortW: W(c.short), grossW: W(c.gross), target: tgt, min: lo, max: hi, active: tgt != null ? econW - tgt : null, status };
  });
  // Classes with a target but no holdings still belong in the table: an empty bucket can breach a minimum.
  for (const [k, t] of Object.entries(targets)) {
    if (classes.some(c => c.key === k) || !(isNum(t.target) || isNum(t.min) || isNum(t.max))) continue;
    const lo = isNum(t.min) ? t.min / 100 : null;
    classes.push({ key: k, mv: 0, econ: 0, physical: 0, overlay: 0, long: 0, short: 0, gross: 0, n: 0, mvW: 0, econW: 0, overlayW: 0, longW: 0, shortW: 0, grossW: 0,
      target: isNum(t.target) ? t.target / 100 : null, min: lo, max: isNum(t.max) ? t.max / 100 : null, active: isNum(t.target) ? -t.target / 100 : null, status: lo != null && lo > 0 ? 'breach' : 'ok' });
  }
  classes.sort((a, b) => Math.abs(b.econ) + Math.abs(b.mv) - Math.abs(a.econ) - Math.abs(a.mv));
  const econ = sum(classes.map(c => c.econ));
  const gross = sum(classes.map(c => c.gross));
  return {
    nav, classes, econ, gross, econW: W(econ), grossW: W(gross),
    overlay: sum(classes.map(c => c.overlay)), overlayW: W(sum(classes.map(c => c.overlay))),
    breaches: classes.filter(c => c.status === 'breach').length
  };
}

// Flat node list for a Plotly sunburst/treemap: class → group → holding. Sizes are absolute values
// (neither chart can draw a negative area), the sign travels in `signed` and `short`.
export function allocationTree(v, { measure = 'economic', dim = 'auto', base = '' } = {}) {
  const val = pc => (measure === 'mv' ? pc.mv : pc.econ);
  const leaves = [];
  for (const x of v.valid) {
    for (const pc of pieces(x)) {
      const s = val(pc);
      if (Math.abs(s) < 1e-6) continue;
      leaves.push({ cls: pc.cls, grp: groupKey(x, pc.cls, dim, base), id: x.pos.id, name: x.name, signed: s, size: Math.abs(s), deriv: pc.deriv, type: x.pos.type, share: pc.share });
    }
  }
  const nodes = [];
  const add = (id, parent, kind, extra) => { let n = nodes.find(z => z.id === id); if (!n) { n = { id, parent, kind, size: 0, signed: 0, ...extra }; nodes.push(n); } return n; };
  for (const l of leaves) {
    const c = add(l.cls, '', 'class', { cls: l.cls, key: l.cls });
    const g = add(l.cls + '/' + l.grp, l.cls, 'group', { cls: l.cls, key: l.grp });
    const h = add(g.id + '/' + l.id, g.id, 'holding', { cls: l.cls, key: l.name, deriv: l.deriv, type: l.type, share: l.share });
    for (const n of [c, g, h]) { n.size += l.size; n.signed += l.signed; }
  }
  nodes.forEach(n => { n.short = n.signed < 0; n.weight = v.nav ? n.signed / v.nav : 0; });
  return nodes;
}

// ---- derivative book ----------------------------------------------------------------------------
// Underlying for display: an option or future says so explicitly, swaps are rates/credit, forwards FX.
export function underlyingOf(pos) {
  if (pos.type === 'irs') return 'rates';
  if (pos.type === 'cds') return 'credit';
  if (pos.type === 'fx_forward') return 'fx';
  return pos.underlyingClass || 'equity';
}

export function derivativesBook(v) {
  const rows = v.valid.filter(x => x.r.deriv).map(x => {
    const d = x.r.deriv;
    // Commitment (UCITS style): delta-adjusted for options, notional for the rest; FX forwards
    // count the bought leg because the sold one is its funding.
    const commitment = x.pos.type === 'fx_forward' ? Math.abs(d.notional) : Math.abs(d.deltaExp);
    const isFx = x.pos.type === 'fx_forward' || x.pos.underlyingClass === 'fx';
    return { x, pos: x.pos, name: x.name, type: x.pos.type, und: underlyingOf(x.pos), ...d, commitment, isFx, source: d.used ? 'reported' : 'model' };
  });
  const nav = v.nav, W = y => (nav ? y / nav : 0);
  const byUnd = new Map();
  for (const r of rows) {
    const u = byUnd.get(r.und) || { key: r.und, notional: 0, grossNotional: 0, deltaExp: 0, commitment: 0, n: 0 };
    u.notional += r.notional; u.grossNotional += Math.abs(r.notional); u.deltaExp += r.isFx ? 0 : r.deltaExp; u.commitment += r.commitment; u.n++;
    byUnd.set(r.und, u);
  }
  const grossNotional = sum(rows.map(r => Math.abs(r.notional)));
  const commitment = sum(rows.map(r => r.commitment));
  const options = rows.filter(r => r.type === 'option');
  return {
    rows,
    byUnderlying: [...byUnd.values()].map(u => ({ ...u, notionalW: W(u.notional), deltaW: W(u.deltaExp), commitW: W(u.commitment) })).sort((a, b) => b.commitment - a.commitment),
    count: rows.length,
    withReported: rows.filter(r => r.hasReported).length,
    reportable: rows.filter(r => r.type === 'option' || r.type === 'future').length,
    usingReported: rows.filter(r => r.used).length,
    mismatches: rows.filter(r => r.mismatch).length,
    grossNotional, grossNotionalW: W(grossNotional),
    commitment, commitmentW: W(commitment),
    netDelta: sum(rows.filter(r => !r.isFx).map(r => r.deltaExp)),
    optionNetDelta: sum(options.map(r => r.deltaExp)),
    optionModelDelta: sum(options.map(r => r.modelDeltaExp))
  };
}
