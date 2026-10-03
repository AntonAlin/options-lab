// Golden figures: the demo fund's key risk, compliance and pricing numbers must not move unless the
// change is intended. To accept a change: node scripts/golden.mjs --update, and say why in the PR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeFigures, compare, INDEPENDENT } from './golden/figures.mjs';

const expected = JSON.parse(readFileSync(new URL('./fixtures/golden-expected.json', import.meta.url), 'utf8'));

test('golden figures match the frozen fixture', () => {
  const rows = compare(computeFigures(), expected.figures);
  const bad = rows.filter(r => r.status !== 'ok');
  assert.equal(bad.length, 0, 'figures changed — if intended, run `node scripts/golden.mjs --update`:\n' +
    bad.map(r => `  ${r.status.padEnd(8)}${r.key}: expected ${r.expected}, got ${r.actual}`).join('\n'));
});

test('golden figures are deterministic', () => {
  assert.deepEqual(computeFigures().map(f => f[1]), computeFigures().map(f => f[1]));
});

test('golden figures are finite', () => {
  const bad = computeFigures().filter(([, v]) => !Number.isFinite(v));
  assert.equal(bad.length, 0, bad.map(b => b[0]).join(', '));
});

test('reference figures match closed-form values independently of the fixture', () => {
  const got = Object.fromEntries(computeFigures().map(([k, v]) => [k, v]));
  for (const [k, [want, tol]] of Object.entries(INDEPENDENT)) assert.ok(Math.abs(got[k] - want) <= tol, `${k}: expected ${want} ± ${tol}, got ${got[k]}`);
});
