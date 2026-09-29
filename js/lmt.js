// Liquidity management tools (LMTs) for open-ended funds: which tools the fund has selected, a
// calibration of swing pricing / anti-dilution levies from estimated trading costs, and what a
// redemption gate does to a large outflow. As the developer reads Directive (EU) 2024/927 (amending
// the AIFMD and the UCITS Directive, applying from 16 April 2026) and ESMA's guidelines and RTS on
// LMTs. Regulation changes and is read differently; this is one reading, not legal advice.
import { liquidity, seriesKeyFor } from './analytics.js';
import { isNum, num, sum, stdev } from './util.js';

// The Annex list, in order. Suspension is always available and side pockets are separate, so as
// read here the "select at least two" (one for a money market fund) counts the tools in between.
export const LMT_TOOLS = ['suspension', 'gates', 'notice', 'fees', 'swing', 'dual', 'adl', 'inKind', 'sidePockets'];
export const SELECTABLE = ['gates', 'notice', 'fees', 'swing', 'dual', 'adl', 'inKind'];
export const ANTI_DILUTION = ['swing', 'dual', 'adl'];
export const LMT_DEFAULTS = { selected: [], mmf: false, costs: {}, stressMult: 3, materialityBp: 5, capPct: 2, gatePct: 10, impact: true, flows: [1, 2, 5, 10, 20] };
export const lmtSettings = p => ({ ...LMT_DEFAULTS, ...(p.lmt || {}), costs: { ...(p.lmt?.costs || {}) } });

export function lmtCheck(cfg) {
  const chosen = SELECTABLE.filter(k => cfg.selected.includes(k));
  const required = cfg.mmf ? 1 : 2;
  const anti = ANTI_DILUTION.filter(k => cfg.selected.includes(k));
  return { chosen, count: chosen.length, required, ok: chosen.length >= required, antiDilutionOverlap: anti.length > 1, anti };
}

// One-way cost of trading, in basis points of the amount traded: half the bid-ask spread,
// commission and taxes. Rough defaults per instrument type, to be replaced by the fund's own.
export const DEFAULT_COST_BP = {
  equity: 10, etf: 8, fund: 0, govt_bond: 5, corp_bond: 30, frn: 20, money_market: 2, inflation_linked: 10, convertible: 40,
  alternative: 150, commodity: 15, certificate: 50, cash: 0
};
export const costBp = (cfg, type) => (isNum(cfg.costs[type]) ? cfg.costs[type] : DEFAULT_COST_BP[type] ?? 20);

// Positions the fund would sell (or buy) pro rata for a flow: everything with a positive value
// except derivatives, whose notional is adjusted at little cost. Cash pays its share at no cost.
function slice(v, cfg) {
  const h = v.p.history;
  const rows = v.valid.filter(x => x.def.group !== 'derivatives' && x.r.mv > 0).map(x => {
    let sigma = null;
    const key = cfg.impact && x.pos.adv > 0 && h ? seriesKeyFor(x.pos, h) : null;
    if (key) {
      const s = h.series[key].filter(y => isNum(y) && y > 0).slice(-252);
      const r = s.slice(1).map((y, i) => Math.log(y / s[i]));
      if (r.length >= 20) sigma = stdev(r);
    }
    return { row: x, cost: costBp(cfg, x.pos.type), sigma, qty: Math.abs(num(x.pos.qty)), adv: num(x.pos.adv) };
  });
  const tot = sum(rows.map(q => q.row.r.mv));
  rows.forEach(q => { q.w = tot ? q.row.r.mv / tot : 0; });
  return rows;
}

// Market impact by the square-root law: σ_daily · √(traded quantity / average daily volume), in bp.
const impactBp = (q, f, stressed) => (q.sigma && q.adv > 0 ? 1e4 * q.sigma * (stressed ? 1.5 : 1) * Math.sqrt(f * q.qty / (q.adv * (stressed ? 0.5 : 1))) : 0);

// Swing factor for a net flow of f (fraction of NAV): the average cost per unit traded, which is
// what the swung price charges the investors who trade. Without it, the investors who stay lose
// f · factor / (1 − f) of NAV — the dilution.
export function swingAnalysis(v, cfg) {
  const rows = slice(v, cfg);
  if (!rows.length) return null;
  const factor = (f, stressed) => sum(rows.map(q => q.w * (q.cost * (stressed ? cfg.stressMult : 1) + (cfg.impact ? impactBp(q, f, stressed) : 0))));
  const dilution = (f, stressed) => f * factor(f, stressed) / (1 - f);
  const table = cfg.flows.map(pct => {
    const f = pct / 100;
    return { flow: pct, factor: factor(f, false), factorStressed: factor(f, true), dilution: dilution(f, false), dilutionStressed: dilution(f, true) };
  });
  const threshold = stressed => { for (let x = 1; x <= 500; x++) { const f = x / 1000; if (dilution(f, stressed) >= cfg.materialityBp) return f * 100; } return null; };
  const contributors = rows.map(q => ({ row: q.row, w: q.w, cost: q.cost, impact: impactBp(q, 0.05, false), bp: q.w * (q.cost + impactBp(q, 0.05, false)) }))
    .sort((a, b) => b.bp - a.bp).slice(0, 10);
  const maxStressed = Math.max(...table.map(r => r.factorStressed));
  return {
    table, threshold: threshold(false), thresholdStressed: threshold(true), contributors,
    capBp: cfg.capPct * 100, overCap: maxStressed > cfg.capPct * 100, maxStressed,
    impactCoverage: sum(rows.filter(q => q.sigma && q.adv > 0).map(q => q.w)), cashShare: sum(rows.filter(q => q.row.pos.type === 'cash').map(q => q.w))
  };
}

// A redemption gate of g (fraction of NAV per dealing day) against requests of r: how many dealing
// days it takes to pay, and whether the assets that can be sold in a day cover what the gate pays.
export function gateAnalysis(v, cfg, { requests = [5, 10, 20, 30, 50] } = {}) {
  const g = cfg.gatePct / 100;
  const nav = v.nav || 1;
  const run = stressed => {
    const liq = liquidity(v, { stressed });
    const within = h => liq.buckets.find(b => b.h === h)?.value ?? 0;
    const day1 = within(1) / nav;
    return requests.map(pct => {
      const r = pct / 100;
      const firstDay = Math.min(r, g);
      const horizons = liq.buckets.map(b => b.h);
      const coverIn = horizons.find(h => within(h) / nav >= r) ?? null;
      return { request: pct, gated: r > g, days: Math.ceil(r / g), firstDay: firstDay * 100, deferred: Math.max(0, r - g) * 100, day1Liquid: day1 * 100, coversFirstDay: day1 >= firstDay, coverIn };
    });
  };
  return { normal: run(false), stressed: run(true) };
}
