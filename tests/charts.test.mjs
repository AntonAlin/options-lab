// Chart axes: every tick label distinct, whatever the range. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { pctTicks, niceStep, pctDecimals, lineSpec, histogramSpec, barHSpec } from '../js/charts.js';

const unique = a => new Set(a).size === a.length;

test('nice steps are 1, 2, 2.5 or 5 × 10ⁿ', () => {
  for (const span of [0.0003, 0.0021, 0.012, 0.07, 0.4, 3, 47]) {
    const s = niceStep(span);
    const m = s / Math.pow(10, Math.floor(Math.log10(s) + 1e-9));
    assert.ok([1, 2, 2.5, 5, 10].some(x => Math.abs(m - x) < 1e-9), `${span} → ${s}`);
  }
  assert.equal(pctDecimals(0.005), 1);
  assert.equal(pctDecimals(0.0025), 2);
  assert.equal(pctDecimals(0.1), 0);
  assert.equal(pctDecimals(0.025), 1);
});

test('percentage ticks never repeat a label', () => {
  // The CSV demo's cumulative return and drawdown move within a fraction of a percent; the old
  // '.0%' format printed −1%, −1%, 0%.
  const cases = [[-0.012, -0.002, 0.001], [-0.0028, 0, 0.0011], [0, 0], [0.05, 0.05], [0.001, 0.0013], [0, 0.376], [-0.35, 0.12], [-1e-6, 1e-6], [0.0885, 0.0893]];
  for (const v of cases) {
    const t = pctTicks(v);
    assert.ok(t.ticktext.length >= 2, JSON.stringify(v));
    assert.ok(unique(t.ticktext), `${JSON.stringify(v)}: ${t.ticktext.join(' ')}`);
    assert.ok(Math.min(...t.tickvals) <= Math.min(...v) + 1e-12 && Math.max(...t.tickvals) >= Math.max(...v) - 1e-12, 'ticks cover the data');
  }
  assert.deepEqual(pctTicks([-0.012, 0.001]).ticktext, ['−1.5%', '−1.0%', '−0.5%', '0.0%', '0.5%']);
  assert.ok(pctTicks([0.01, 0.02], { zero: true }).tickvals.includes(0));
});

test('the chart builders use the computed ticks', () => {
  const dates = ['2026-04-30', '2026-05-29', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30'];
  const flat = lineSpec(dates, [{ name: 'x', y: [0, 0, 0, 0, 0, 0] }], { th: 'light', zero: true });
  assert.ok(unique(flat.layout.yaxis.ticktext));
  const small = lineSpec(dates, [{ name: 'x', y: [0, -0.004, -0.002, -0.003, 0.001, -0.0028] }], { th: 'light', area: true });
  assert.ok(unique(small.layout.yaxis.ticktext), small.layout.yaxis.ticktext.join(' '));
  const h = histogramSpec([-0.01, 0, 0.002, 0.004, 0.006], { th: 'light' });
  assert.ok(unique(h.layout.xaxis.ticktext));
  const b = barHSpec([{ label: 'a', value: 0.004 }, { label: 'b', value: -0.002 }], { th: 'light' });
  assert.ok(unique(b.layout.xaxis.ticktext));
});
