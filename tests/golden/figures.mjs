// The golden figures: every number a risk or compliance function would sign off, computed on the
// seeded demo fund at a fixed valuation date. Frozen in tests/fixtures/golden-expected.json; any
// change to one of them fails CI until the fixture is regenerated on purpose (scripts/golden.mjs).
// Regression evidence, not independent validation: the frozen values are what the code computed
// when they were last accepted. The closed-form checks at the end are independent.
import { fullAnalysis, valuePortfolio } from '../../js/analytics.js';
import { buildDemo } from '../../js/demo.js';
import { bsm, bondAnalytics, americanOption, black76, bachelier } from '../../js/pricing.js';
import * as G from '../../js/globalexposure.js';
import * as L from '../../js/lmt.js';

export const VAL_DATE = '2026-09-28';

// Each entry: [key, value, description]. Keys are stable identifiers; never reuse one for a new meaning.
export function computeFigures() {
  // The demo leaves valDate empty ("today" in the app); pin it or the figures move every midnight.
  const p = { ...buildDemo(VAL_DATE), valDate: VAL_DATE };
  const a = fullAnalysis(p);
  const { v, fi, risk, liq, liqStressed, comp, conc, perf } = a;
  const f = [];
  const add = (key, value, what) => f.push([key, value, what]);

  add('valuation.nav', v.nav, 'Net asset value (SEK)');
  add('valuation.gross', v.gross, 'Gross exposure (SEK)');
  add('valuation.derivCommit', v.derivCommit, 'Derivative commitment (SEK)');
  add('valuation.cash', v.cash, 'Cash (SEK)');
  add('valuation.leverage', v.leverage, 'Leverage, gross / NAV');
  add('valuation.netExposure', v.netExposure, 'Net economic exposure (SEK)');
  add('valuation.positions', v.rows.length, 'Positions valued');
  add('valuation.errors', v.errorsCount, 'Positions with valuation errors');

  add('fixedIncome.ytm', fi.ytm, 'Yield to maturity, fixed income sleeve');
  add('fixedIncome.modDur', fi.modDur, 'Modified duration, fixed income sleeve');
  add('fixedIncome.spreadDur', fi.spreadDur, 'Spread duration, fixed income sleeve');
  add('fixedIncome.convexity', fi.convexity, 'Convexity, fixed income sleeve');
  add('fixedIncome.portfolioDuration', fi.portfolioDuration, 'Portfolio duration incl. swaps and bond futures');
  add('fixedIncome.ir01', fi.ir01, 'IR01 / DV01 (SEK per bp)');
  add('fixedIncome.cs01', fi.cs01, 'CS01 (SEK per bp)');
  for (const [ccy, x] of Object.entries(fi.ir01ByCcy).sort()) add(`fixedIncome.ir01.${ccy}`, x, `IR01 in ${ccy} (SEK per bp)`);

  for (const [m, r] of [['parametric', risk.param], ['historical', risk.hist], ['ewma', risk.ewma]]) {
    add(`risk.${m}.var`, r.var, `${m} VaR 99 % 1d (SEK)`);
    add(`risk.${m}.es`, r.es, `${m} ES 99 % 1d (SEK)`);
    add(`risk.${m}.volPct`, r.volPct, `${m} annual volatility`);
  }
  for (const [g, x] of Object.entries(risk.param.byFactorGroup).sort()) add(`risk.parametric.contrib.${g}`, x, `Euler risk contribution, ${g} (SEK)`);
  add('risk.parametric.diversification', risk.param.diversification, 'Diversification benefit (SEK)');
  add('risk.drivers.top1', risk.drivers.top1, 'Share of variance, first principal component');
  add('risk.drivers.effective', risk.drivers.effective, 'Effective number of risk drivers');

  add('concentration.hhi', conc.hhi, 'Herfindahl index');
  add('concentration.top10', conc.top10, 'Top-10 weight');

  for (const r of comp.rules) add(`compliance.${r.id}`, r.value, `UCITS limit ${r.id}: value (limit ${r.limit})`);
  add('compliance.breaches', comp.breaches, 'Limit breaches');

  for (const b of liq.buckets) add(`liquidity.${b.h}d`, b.pct, `Share liquidated within ${b.h} days, normal`);
  for (const b of liqStressed.buckets) add(`liquidity.stressed.${b.h}d`, b.pct, `Share liquidated within ${b.h} days, stressed`);

  for (const s of a.stress) add(`stress.${s.scenario.id}`, s.pct, `Stress scenario ${s.scenario.id}: P&L / NAV`);

  for (const k of ['cagr', 'vol', 'sharpe', 'sortino', 'maxDD', 'beta', 'trackingError', 'infoRatio']) add(`performance.${k}`, perf[k], `Back-cast ${k}`);

  // Global exposure under the VaR approach, with its backtest.
  const vv = valuePortfolio({ ...p, globalExposure: { method: 'absoluteVar' } });
  const fv = G.fundVar(vv), bt = G.backtest(vv);
  add('globalExposure.absVar20d', fv.pct, 'Absolute VaR 99 % 20d, % of NAV');
  add('globalExposure.backtest.exceptions', bt.exceptions, 'VaR backtest exceptions over 250 days');
  add('globalExposure.backtest.kupiecLR', bt.lr, 'Kupiec likelihood ratio');

  // Liquidity management tools at the default settings.
  const sw = L.swingAnalysis(v, L.lmtSettings(p));
  for (const r of sw.table) add(`lmt.swing.${r.flow}pct`, r.factor, `Swing factor (bp) at ${r.flow} % net flow`);
  add('lmt.swing.threshold', sw.threshold, 'Swing threshold (% of NAV)');

  // Independent closed-form reference values (textbook, not frozen output).
  add('reference.bsm.hullCall', bsm('call', 42, 40, 0.5, 0.1, 0, 0.2).price, 'Black-Scholes call, Hull ex. 15.6 (4.7594)');
  add('reference.bond.parModDur', bondAnalytics({ valuationDate: '2026-01-15', maturity: '2031-01-15', couponPct: 4, freq: 1, cleanPrice: 100 }).modDur, '5y 4 % annual par bond: (1 − 1.04⁻⁵)/0.04');
  add('reference.american.put', americanOption('put', 100, 100, 1, 0.05, 0, 0.2), 'American put, CRR 200 steps (≈ 6.09)');
  add('reference.black76.call', black76('call', 100, 100, 1, 0.2).price, 'Black-76 undiscounted ATM call: 100·(2N(0.1) − 1)');
  add('reference.bachelier.call', bachelier('call', 0.03, 0.03, 1, 0.01).price, 'Bachelier ATM call: σ√T/√(2π)');
  return f;
}

// Closed-form values the reference figures must match regardless of the frozen fixture.
export const INDEPENDENT = {
  'reference.bsm.hullCall': [4.7594, 1e-4],
  'reference.bond.parModDur': [(1 - 1.04 ** -5) / 0.04, 1e-3],
  'reference.american.put': [6.09, 0.01],
  'reference.black76.call': [100 * (2 * 0.539827837277029 - 1), 1e-9],
  'reference.bachelier.call': [0.01 / Math.sqrt(2 * Math.PI), 1e-12]
};

// Floating-point noise across Node versions stays far below this; a real change does not.
export const REL_TOL = 1e-9, ABS_TOL = 1e-12;
export function compare(actual, expected) {
  const exp = new Map(expected.map(e => [e.key, e]));
  const act = new Map(actual.map(([key, value, what]) => [key, { key, value, what }]));
  const rows = [];
  for (const [key, a] of act) {
    const e = exp.get(key);
    if (!e) { rows.push({ key, what: a.what, actual: a.value, expected: null, status: 'new' }); continue; }
    const same = (a.value === e.value) || (Number.isFinite(a.value) && Number.isFinite(e.value) && Math.abs(a.value - e.value) <= Math.max(ABS_TOL, REL_TOL * Math.abs(e.value)));
    rows.push({ key, what: a.what, actual: a.value, expected: e.value, status: same ? 'ok' : 'changed' });
  }
  for (const [key, e] of exp) if (!act.has(key)) rows.push({ key, what: e.what, actual: null, expected: e.value, status: 'missing' });
  return rows;
}
