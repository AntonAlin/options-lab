// Fund rules: the investment restrictions in a fund's own rules and prospectus ("at least 90 % in
// Nordic equities", "no holding rated below BBB−", "duration between 2 and 5 years"), written by the
// user as data and checked by the same compliance machinery as the UCITS limits — so they show on
// the dashboard, in the breach history (active vs passive), in pre-trade and in the PDF.
//
// A rule: { id, name, on, measure, groupBy?, dir: 'max'|'min', limit, conds: [{ dim, op, values }] }
// Conditions are ANDed; values within one condition are ORed. The engine checks what is written; it
// does not know what a fund's rules say or how a supervisor reads them.
import { regionOf, ratingScore, isInvestmentGrade, majorCcy } from './instruments.js';
import { isNum, sum, uid } from './util.js';

export const RULE_DIMS = ['assetClass', 'type', 'group', 'region', 'country', 'sector', 'ccy', 'issuer', 'strategy', 'rating', 'name'];
export const RULE_OPS = { in: 'in', notin: 'notin', contains: 'contains', below: 'below', atleast: 'atleast' };
export const RULE_MEASURES = ['weight', 'exposure', 'gross', 'maxPosition', 'maxGroup', 'count', 'duration'];
export const GROUP_BY = ['issuer', 'sector', 'country', 'region', 'ccy', 'assetClass', 'type'];
export const UNIT = { weight: '%', exposure: '%', gross: '%', maxPosition: '%', maxGroup: '%', count: '', duration: 'yrs' };

function ratingBucket(x) {
  const r = x.pos.rating;
  if (!r || ratingScore(r) == null) return 'NR';
  return isInvestmentGrade(r) ? 'IG' : 'HY';
}
export function dimValue(x, dim) {
  switch (dim) {
    case 'assetClass': return x.r.assetClass;
    case 'type': return x.pos.type;
    case 'group': return x.def.group;
    case 'region': return regionOf(x.pos.country);
    case 'country': return String(x.pos.country || '').toUpperCase();
    case 'sector': return x.pos.sector || '';
    case 'ccy': return majorCcy(x.pos.ccy || '');
    case 'issuer': return x.issuer || '';
    case 'strategy': return x.pos.strategy || '';
    case 'rating': return ratingBucket(x);
    case 'name': return x.name || '';
    default: return '';
  }
}
const norm = s => String(s ?? '').trim().toLowerCase();

export function matches(x, conds = []) {
  return conds.every(c => {
    const vals = (c.values || []).map(norm).filter(Boolean);
    if (c.dim === 'rating' && (c.op === 'below' || c.op === 'atleast')) {
      const lim = ratingScore(c.values?.[0]);
      const s = ratingScore(x.pos.rating);
      if (lim == null) return true;
      // Scores run AAA = 1 … D = 22, so "below BBB−" is a higher score. Unrated counts as below.
      return c.op === 'below' ? (s == null || s > lim) : (s != null && s <= lim);
    }
    const v = norm(dimValue(x, c.dim));
    if (c.op === 'contains') return vals.some(q => v.includes(q));
    const hit = vals.includes(v);
    return c.op === 'notin' ? !hit : hit;
  });
}

// Value of one rule on a valued portfolio (analytics.valuePortfolio). Returns { value, details }.
export function measureRule(v, rule) {
  const nav = v.nav || 1;
  const pct = x => x / nav * 100;
  const rows = v.valid.filter(x => matches(x, rule.conds));
  const top = list => list.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 8);
  switch (rule.measure) {
    case 'weight': return { value: pct(sum(rows.map(x => x.r.mv))), details: top(rows.map(x => ({ name: x.name, value: pct(x.r.mv) }))) };
    case 'exposure': return { value: pct(sum(rows.map(x => x.r.net))), details: top(rows.map(x => ({ name: x.name, value: pct(x.r.net) }))) };
    case 'gross': return { value: pct(sum(rows.map(x => Math.abs(x.r.exposure)))), details: top(rows.map(x => ({ name: x.name, value: pct(Math.abs(x.r.exposure)) }))) };
    case 'maxPosition': {
      const list = top(rows.filter(x => x.def.group !== 'derivatives').map(x => ({ name: x.name, value: pct(x.r.mv) })));
      return { value: list[0]?.value || 0, details: list };
    }
    case 'maxGroup': {
      const m = new Map();
      rows.forEach(x => { const k = dimValue(x, rule.groupBy || 'issuer') || '—'; m.set(k, (m.get(k) || 0) + x.r.mv); });
      const list = top([...m.entries()].map(([name, e]) => ({ name, value: pct(e) })));
      return { value: list[0]?.value || 0, details: list };
    }
    case 'count': return { value: rows.length, details: rows.slice(0, 8).map(x => ({ name: x.name, value: pct(x.r.mv) })) };
    case 'duration': {
      // Duration the matched positions add to the portfolio: −Σ DV01 / NAV / 1 bp (swaps and futures included).
      const dv = x => sum(Object.values(x.r.ir01 || {}));
      return { value: -sum(rows.map(dv)) / nav / 1e-4, details: top(rows.filter(x => dv(x)).map(x => ({ name: x.name, value: -dv(x) / nav / 1e-4 }))) };
    }
    default: return { value: 0, details: [] };
  }
}

export const ruleStatus = (val, lim, dir) => {
  const tol = Math.abs(lim) * 0.1;
  if (dir === 'max') return val > lim + 1e-9 ? 'breach' : val > lim - tol ? 'warn' : 'ok';
  return val < lim - 1e-9 ? 'breach' : val < lim + tol ? 'warn' : 'ok';
};

// Results in the shape compliance() uses for its own limits; ids are prefixed 'fr:'.
export function checkFundRules(v, rules = v.p.rules || []) {
  return rules.filter(r => r.on !== false && isNum(r.limit)).map(r => {
    const { value, details } = measureRule(v, r);
    return { id: 'fr:' + r.id, label: r.name, unit: UNIT[r.measure] ?? '%', value, limit: r.limit, dir: r.dir === 'min' ? 'min' : 'max', status: ruleStatus(value, r.limit, r.dir === 'min' ? 'min' : 'max'), details, custom: true };
  });
}

// Starting points for the rules most fund rules contain. The user adjusts the numbers to their own.
export const RULE_EXAMPLES = [
  { key: 'maxHolding', rule: { name: 'Max 10 % in a single holding', measure: 'maxPosition', dir: 'max', limit: 10, conds: [{ dim: 'group', op: 'notin', values: ['cash'] }] } },
  { key: 'minEquity', rule: { name: 'At least 90 % in equities', measure: 'exposure', dir: 'min', limit: 90, conds: [{ dim: 'assetClass', op: 'in', values: ['equity'] }] } },
  { key: 'sector', rule: { name: 'Max 25 % per sector', measure: 'maxGroup', groupBy: 'sector', dir: 'max', limit: 25, conds: [{ dim: 'group', op: 'notin', values: ['derivatives', 'cash'] }] } },
  { key: 'rating', rule: { name: 'No bonds rated below BBB−', measure: 'count', dir: 'max', limit: 0, conds: [{ dim: 'assetClass', op: 'in', values: ['fixed_income'] }, { dim: 'group', op: 'notin', values: ['derivatives', 'funds'] }, { dim: 'rating', op: 'below', values: ['BBB-'] }] } },
  { key: 'region', rule: { name: 'Max 10 % outside the Nordics', measure: 'weight', dir: 'max', limit: 10, conds: [{ dim: 'region', op: 'notin', values: ['nordics'] }, { dim: 'group', op: 'notin', values: ['cash', 'derivatives'] }] } },
  { key: 'durMin', rule: { name: 'Duration at least 2 years', measure: 'duration', dir: 'min', limit: 2, conds: [] } },
  { key: 'durMax', rule: { name: 'Duration at most 5 years', measure: 'duration', dir: 'max', limit: 5, conds: [] } },
  { key: 'ccy', rule: { name: 'Max 30 % in non-SEK assets', measure: 'weight', dir: 'max', limit: 30, conds: [{ dim: 'ccy', op: 'notin', values: ['SEK'] }, { dim: 'group', op: 'notin', values: ['derivatives'] }] } }
];
export const newRule = (base = {}) => ({ id: uid('fr'), on: true, measure: 'weight', dir: 'max', limit: 10, conds: [], name: 'New rule', ...JSON.parse(JSON.stringify(base)) });
