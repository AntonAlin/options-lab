// Global exposure of a UCITS by the VaR approach, and the backtest of the VaR model, as the
// developer reads the UCITS Directive (art. 51(3)) and the CESR/10-788 guidelines on risk
// measurement and global exposure. Regulation changes and is read differently by different people;
// this is one reading, not legal advice — see the note on the Global exposure page.
//
//   absolute VaR   VaR(99 %, 20 business days) ≤ 20 % of NAV
//   relative VaR   VaR(fund) ≤ 2 × VaR(reference portfolio), same confidence and horizon
//   backtest       1-day 99 % VaR against the next day's P&L over the last 250 days; more than
//                  4 overshootings is read here as a signal to review the model (and, in some
//                  jurisdictions, to tell the supervisor)
// The P&L is the back-cast of today's holdings on the loaded price history (analytics.historicalPnl),
// cut at the valuation date, so a past snapshot never sees later prices.
import { historicalPnl, factorModel, returnsOf } from './analytics.js';
import { normInv, normCDF } from './pricing.js';
import { isNum, num, quantile, mean } from './util.js';
import { ewmaVariance, EWMA_LAMBDA } from './riskstats.js';

export const GE_DEFAULTS = { method: 'commitment', absLimit: 20, relLimit: 2, confidence: 0.99, horizon: 20, window: 250, model: 'historical', reference: '' };
export const geSettings = p => ({ ...GE_DEFAULTS, ...(p.globalExposure || {}) });
export const usesVar = p => ['absoluteVar', 'relativeVar'].includes(geSettings(p).method);

// History up to and including the valuation date.
function cutHistory(p, date) {
  const h = p.history;
  if (!h?.dates?.length || !date) return h;
  const n = h.dates.filter(d => d <= date).length;
  if (n === h.dates.length) return h;
  return { dates: h.dates.slice(0, n), series: Object.fromEntries(Object.entries(h.series).map(([k, s]) => [k, s.slice(0, n)])) };
}
export function backcast(v) {
  const h = cutHistory(v.p, v.ctx.valDate);
  return historicalPnl({ ...v, p: { ...v.p, history: h } });
}

// VaR of a daily series (P&L in money, or returns) at confidence c, scaled by √horizon.
function seriesVar(x, { confidence, horizon, window, model }) {
  const s = x.filter(isNum).slice(-window);
  if (s.length < 20) return null;
  const d = model === 'ewma' ? normInv(confidence) * Math.sqrt(ewmaVariance(s, EWMA_LAMBDA) ?? 0) : -quantile(s, 1 - confidence);
  return { var1d: d, varH: d * Math.sqrt(horizon), obs: s.length };
}

// The fund's VaR as % of NAV. Falls back to the factor model (flagged) without enough history.
export function fundVar(v, cfg = geSettings(v.p), hp = backcast(v)) {
  const nav = v.nav || 1;
  const hv = hp && hp.obs >= 20 ? seriesVar(hp.portfolioPnl, cfg) : null;
  if (hv) return { pct: hv.varH / nav * 100, pct1d: hv.var1d / nav * 100, obs: hv.obs, model: cfg.model, coverage: hp.coverage, short: hv.obs < 250 };
  const f = factorModel({ ...v, p: { ...v.p, risk: { ...(v.p.risk || {}), confidence: cfg.confidence, horizonDays: cfg.horizon } } });
  return { pct: f.varPct * 100, pct1d: f.varPct * 100 / Math.sqrt(cfg.horizon), obs: 0, model: 'parametric', coverage: 0, short: true };
}

// VaR of the reference portfolio, given as a price series in the loaded history (an index, or an
// index fund that stands for the reference portfolio), as % of its own value.
export function referenceVar(v, cfg = geSettings(v.p)) {
  const key = cfg.reference;
  const h = cutHistory(v.p, v.ctx.valDate);
  if (!key || !h?.series?.[key]) return null;
  const r = returnsOf(h.series[key]);
  const rv = seriesVar(r, { ...cfg, model: cfg.model === 'ewma' ? 'ewma' : 'historical' });
  return rv ? { pct: rv.varH * 100, obs: rv.obs, key } : null;
}

// The limit as a compliance rule (same shape as analytics.compliance), or null under the commitment approach.
export function globalExposureRule(v) {
  const cfg = geSettings(v.p);
  if (!usesVar(v.p)) return null;
  const fv = fundVar(v, cfg);
  const status = (val, lim) => (val > lim + 1e-9 ? 'breach' : val > lim * 0.9 ? 'warn' : 'ok');
  if (cfg.method === 'absoluteVar') return { id: 'varAbs', value: fv.pct, limit: cfg.absLimit, dir: 'max', unit: '%', status: status(fv.pct, cfg.absLimit), details: [] };
  const ref = referenceVar(v, cfg);
  if (!ref || !(ref.pct > 0)) return { id: 'varRel', value: NaN, limit: cfg.relLimit, dir: 'max', unit: '×', status: 'warn', details: [{ name: 'no reference portfolio series', value: NaN }] };
  const ratio = fv.pct / ref.pct;
  return { id: 'varRel', value: ratio, limit: cfg.relLimit, dir: 'max', unit: '×', status: status(ratio, cfg.relLimit), details: [] };
}

// Kupiec's proportion-of-failures test: LR ~ χ²(1) under a correct model.
export function kupiec(x, n, p) {
  if (!n) return { lr: NaN, pValue: NaN };
  // Log-likelihood of k failures in n at rate q; a zero count contributes nothing (0 · log 0 = 0).
  const ll = (q, k) => (k === 0 ? 0 : k * Math.log(q)) + (n - k === 0 ? 0 : (n - k) * Math.log(1 - q));
  const lr = Math.max(0, -2 * (ll(p, x) - ll(x / n, x)));
  return { lr, pValue: 2 * (1 - normCDF(Math.sqrt(lr))) };
}
// Basel traffic light for 250 observations at 99 %: 0–4 green, 5–9 yellow, 10+ red.
export const zoneOf = x => (x <= 4 ? 'green' : x <= 9 ? 'yellow' : 'red');

// Rolling 1-day VaR from the window before each day, against that day's P&L.
export function backtest(v, cfg = geSettings(v.p), hp = backcast(v), { testDays = 250 } = {}) {
  if (!hp) return null;
  const pnl = hp.portfolioPnl.map(num);
  const dates = hp.dates;
  const W = cfg.window, c = cfg.confidence;
  const start = Math.max(W + 1, pnl.length - testDays);
  if (pnl.length - start < 20) return null;
  const rows = [];
  for (let t = start; t < pnl.length; t++) {
    const past = pnl.slice(Math.max(1, t - W), t);
    const var1 = cfg.model === 'ewma' ? normInv(c) * Math.sqrt(ewmaVariance(past, EWMA_LAMBDA) ?? 0) : -quantile(past, 1 - c);
    rows.push({ date: dates[t], pnl: pnl[t], var: var1, exception: pnl[t] < -var1 });
  }
  const n = rows.length, x = rows.filter(r => r.exception).length;
  return {
    rows, n, exceptions: x, expected: n * (1 - c), rate: x / n, zone: zoneOf(Math.round(x * 250 / n)), review: x * 250 / n > 4,
    ...kupiec(x, n, 1 - c), avgVarPct: v.nav ? mean(rows.map(r => r.var)) / v.nav * 100 : 0, full: n >= 250, model: cfg.model
  };
}
