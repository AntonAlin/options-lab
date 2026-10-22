// Performance statistics on the frequency the data really has. Run with: npm test
// The bug this guards: six month-end snapshots annualised as if they were six trading days, which
// turned a −0.2 % half year into a −11 % "annualised return" and a Sharpe of −1.35.
import test from 'node:test';
import assert from 'node:assert/strict';
import { perfStats, inferPeriodsPerYear, rollingVol, rollingWindow, seriesKeyFor, periodDays } from '../js/analytics.js';
import { demoWorkbook } from '../js/demofile.js';
import { parseExtras } from '../js/sourcefile.js';
import { toISODate, DAY_MS } from '../js/util.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a}`);
// Dates from `start`, every `step` calendar days (weekdays only when step is 1).
function dates(n, step, start = '2023-01-02') {
  const out = [];
  for (let d = Date.parse(start); out.length < n; d += step * DAY_MS) {
    const wd = new Date(d).getUTCDay();
    if (step === 1 && (wd === 0 || wd === 6)) continue;
    out.push(toISODate(new Date(d)));
  }
  return out;
}
const monthEnds = (n, y = 2025, m = 0) => Array.from({ length: n }, (_, i) => toISODate(new Date(Date.UTC(y, m + i + 1, 0))));

test('frequency from the median gap between dates', () => {
  assert.equal(inferPeriodsPerYear(dates(30, 1)), 252);
  assert.equal(inferPeriodsPerYear(dates(30, 7)), 52);
  assert.equal(inferPeriodsPerYear(monthEnds(8)), 12);
  assert.equal(inferPeriodsPerYear(dates(8, 91)), 4);
  assert.equal(inferPeriodsPerYear(dates(4, 365)), 1);
  // One long gap (a missing month in a daily series) does not change the answer.
  const gappy = [...dates(20, 1), ...dates(20, 1, '2023-03-01')];
  assert.equal(inferPeriodsPerYear(gappy), 252);
  assert.equal(inferPeriodsPerYear([]), 252);
  assert.equal(periodDays(12), 21);
});

test('daily series: three years annualise over the calendar span', () => {
  const d = dates(757, 1);
  const r = [NaN, ...Array.from({ length: 756 }, (_, i) => (i % 2 ? 0.004 : -0.003))];
  const s = perfStats(r, { dates: d });
  assert.equal(s.periodsPerYear, 252);
  assert.equal(s.freq, 'daily');
  assert.ok(s.annualised);
  const years = (Date.parse(d.at(-1)) - Date.parse(d[0])) / DAY_MS / 365.25;
  close(s.years, years, 1e-12);
  close(s.cagr, Math.pow(1 + s.total, 1 / years) - 1, 1e-12, 'CAGR over the real span');
  const sd = Math.sqrt(r.slice(1).reduce((a, x, _, arr) => a + (x - arr.reduce((p, q) => p + q, 0) / arr.length) ** 2, 0) / 755);
  close(s.vol, sd * Math.sqrt(252), 1e-12);
  assert.ok(Number.isFinite(s.sharpe) && Number.isFinite(s.calmar));
});

test('monthly series: annualised by 12, not 252', () => {
  const d = monthEnds(37, 2022);
  const r = [NaN, ...Array.from({ length: 36 }, (_, i) => (i % 3 ? 0.012 : -0.008))];
  const s = perfStats(r, { dates: d });
  assert.equal(s.periodsPerYear, 12);
  assert.equal(s.freq, 'monthly');
  assert.ok(s.annualised);
  close(s.years, 3, 0.01);
  close(s.cagr, Math.pow(1 + s.total, 1 / s.years) - 1, 1e-12);
  const m = r.slice(1), mu = m.reduce((a, b) => a + b, 0) / m.length;
  close(s.vol, Math.sqrt(m.reduce((a, x) => a + (x - mu) ** 2, 0) / (m.length - 1)) * Math.sqrt(12), 1e-12, 'vol · √12');
  // The old code (n / 252 years) would have compounded 36 months into a few weeks.
  assert.ok(Math.abs(s.cagr) < 0.2, 'plausible CAGR ' + s.cagr);
});

test('under a year: total return only, nothing annualised', async () => {
  // The CSV demo: six month-ends, five monthly returns, a small loss.
  const d = monthEnds(6, 2026, 3);
  const r = [NaN, -0.004, 0.002, -0.001, 0.003, -0.0024];
  const s = perfStats(r, { dates: d, rf: 0.02 });
  assert.equal(s.freq, 'monthly');
  assert.equal(s.annualised, false);
  for (const k of ['cagr', 'sharpe', 'sortino', 'calmar']) assert.equal(s[k], null, k);
  close(s.total, r.slice(1).reduce((a, x) => a * (1 + x), 1) - 1, 1e-15);
  assert.ok(Math.abs(s.total) < 0.01);
  // The table leaves the annualised ratios and the per-period tail figures out. (labels.js pulls in
  // the UI toolkit, which listens on document; a stub is enough for the pure function used here.)
  globalThis.document ??= { addEventListener() {} };
  const { perfStatRows } = await import('../js/labels.js');
  const keys = perfStatRows(s).map(x => x.k);
  assert.ok(keys.includes('total') && keys.includes('vol') && keys.includes('maxDD'));
  for (const k of ['cagr', 'sharpe', 'sortino', 'calmar', 'var95', 'best', 'hitRate']) assert.ok(!keys.includes(k), k);
  // A benchmark over the same dates is not annualised either.
  // (Benchmark statistics need six paired returns, so seven month-ends here.)
  const d7 = monthEnds(8, 2026, 0), r7 = [NaN, -0.004, 0.002, -0.001, 0.003, -0.0024, 0.001, 0.002];
  const sb = perfStats(r7, { dates: d7, bench: [NaN, -0.003, 0.001, -0.002, 0.004, -0.001, 0.0, 0.003] });
  assert.equal(sb.bench.annualised, false);
  assert.equal(sb.alpha, null);
  assert.equal(sb.infoRatio, null);
});

test('a full year of month-ends counts as a year', () => {
  const d = monthEnds(13, 2025, 0);
  const s = perfStats([NaN, ...Array(12).fill(0.005)], { dates: d });
  assert.ok(s.annualised, 'span ' + s.spanDays);
  close(s.cagr, 1.005 ** 12 - 1, 1e-3);
});

test('fewer than five returns: no statistics at all', () => {
  assert.equal(perfStats([NaN, 0.01, -0.02, 0.005, 0.0], { dates: monthEnds(5) }), null);
  assert.equal(perfStats([0.01, 0.02], {}), null);
});

test('without dates the old daily reading still holds', () => {
  const r = Array.from({ length: 252 }, (_, i) => (i % 2 ? 0.01 : -0.005));
  const s = perfStats([NaN, ...r], { rf: 0 });
  assert.equal(s.periodsPerYear, 252);
  close(s.years, 252 / 252, 1e-12);
  assert.ok(s.annualised);
});

test('rolling volatility: a 3-month window, and no chart without two windows', () => {
  assert.equal(rollingWindow(252), 63);
  assert.equal(rollingWindow(52), 13);
  assert.equal(rollingWindow(12), 3);
  assert.equal(rollingVol([NaN, 0.01, -0.01, 0.02, 0, 0.01], { periodsPerYear: 12 }), null);
  const daily = Array.from({ length: 200 }, (_, i) => (i ? (i % 2 ? 0.01 : -0.01) : NaN));
  const rv = rollingVol(daily);
  assert.ok(rv && rv.some(Number.isFinite));
  close(rv.filter(Number.isFinite)[0], 0.01 * Math.sqrt(63 / 62) * Math.sqrt(252), 1e-3);
});

test('a holding with a daily and a month-end series uses the daily one', () => {
  const h = { dates: ['a', 'b', 'c', 'd'], series: { SE0000115446: [null, 1, null, 2], 'VOLV B': [1, 1.1, 1.2, 2], Volvo: [1, 2, 3, 4] } };
  assert.equal(seriesKeyFor({ isin: 'SE0000115446', ticker: 'VOLV B' }, h), 'VOLV B');
  // Equal length: the ISIN keeps priority. An explicit match always wins.
  assert.equal(seriesKeyFor({ isin: 'SE0000115446', ticker: 'VOLV B', seriesKey: 'Volvo' }, h), 'Volvo');
  assert.equal(seriesKeyFor({ isin: 'volv b', name: 'Volvo' }, h), 'VOLV B');
});

test('the demo workbook has no sheet name Excel reserves, and old History sheets still read', () => {
  const names = [];
  const X = { utils: { book_new: () => ({}), aoa_to_sheet: () => ({}), book_append_sheet: (wb, ws, n) => names.push(n) } };
  demoWorkbook(X, '2026-09-30');
  assert.deepEqual(names, ['Holdings', 'Prices', 'Instructions']);
  names.length = 0;
  demoWorkbook(X, '2026-09-30', { empty: true });
  assert.ok(!names.some(n => /^history$/i.test(n)), names.join());
  const rows = [['Date', 'AAA'], ['2026-01-02', 1], ['2026-01-05', 1.1], ['2026-01-06', 1.2]];
  for (const name of ['Prices', 'History', 'HISTORY', 'history', 'Price history']) assert.ok(parseExtras([{ name, rows }]).history, name);
});
