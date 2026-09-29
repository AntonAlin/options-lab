// Risk estimated from the loaded price history rather than from assumptions:
//   ewmaRisk      RiskMetrics exponentially weighted volatility (λ = 0.94 by default), so the VaR
//                 reacts to the current market instead of weighting a calm year like a stormy week
//   riskDrivers   a statistical factor model: principal components of the positions' P&L covariance,
//                 with the correlations shrunk by Ledoit-Wolf so a short history with many holdings
//                 does not invent structure, and each component's share of the portfolio's variance
// Pure functions on the back-cast from analytics.historicalPnl; covered by tests/core.test.mjs.
import { normInv, normPDF } from './pricing.js';
import { isNum, num, sum, mean } from './util.js';

export const EWMA_LAMBDA = 0.94;

// EWMA variance of a zero-mean series, seeded with the plain variance of the first 20 points.
export function ewmaVariance(x, lambda = EWMA_LAMBDA) {
  const r = x.filter(isNum);
  if (r.length < 20) return null;
  let v = mean(r.slice(0, 20).map(a => a * a));
  for (let i = 20; i < r.length; i++) v = lambda * v + (1 - lambda) * r[i] * r[i];
  return v;
}
export function ewmaCovariance(a, b, lambda = EWMA_LAMBDA) {
  const pairs = a.map((x, i) => [x, b[i]]).filter(([x, y]) => isNum(x) && isNum(y));
  if (pairs.length < 20) return null;
  let c = mean(pairs.slice(0, 20).map(([x, y]) => x * y));
  for (let i = 20; i < pairs.length; i++) c = lambda * c + (1 - lambda) * pairs[i][0] * pairs[i][1];
  return c;
}

export function ewmaRisk(v, hp, { lambda = EWMA_LAMBDA } = {}) {
  if (!hp || hp.obs < 20) return null;
  const risk = v.p.risk || {};
  const conf = risk.confidence ?? 0.99, h = risk.horizonDays ?? 1;
  const port = hp.portfolioPnl;
  const varD = ewmaVariance(port, lambda);
  if (!varD) return null;
  const sd = Math.sqrt(varD), z = normInv(conf);
  const sigA = sd * Math.sqrt(252);
  const byPosition = hp.covered.map(c => {
    const cv = ewmaCovariance(c.pnl.map(num), port.map(num), lambda) ?? 0;
    return { row: c.row, contrib: sd ? cv / sd * Math.sqrt(252) : 0 };
  }).sort((x, y) => y.contrib - x.contrib);
  byPosition.forEach(b => { b.pct = sigA ? b.contrib / sigA : 0; });
  const cls = {};
  for (const b of byPosition) {
    const k = b.row.r.assetClass, part = b.row.def.group === 'derivatives' ? 'derivatives' : 'securities';
    const o = cls[k] || (cls[k] = { key: k, total: 0, securities: 0, derivatives: 0 });
    o.total += b.contrib; o[part] += b.contrib;
  }
  const plainSd = Math.sqrt(mean(port.filter(isNum).map(x => x * x)));
  const varAbs = z * sd * Math.sqrt(h), esAbs = sd * Math.sqrt(h) * normPDF(z) / (1 - conf);
  return {
    method: 'ewma', lambda, halfLife: Math.log(0.5) / Math.log(lambda),
    var: varAbs, es: esAbs, varPct: v.nav ? varAbs / v.nav : 0, esPct: v.nav ? esAbs / v.nav : 0,
    sigmaAnnual: sigA, volPct: v.nav ? sigA / v.nav : 0, vsLongRun: plainSd ? sd / plainSd : null,
    confidence: conf, horizonDays: h, obs: port.filter(isNum).length, coverage: hp.coverage,
    byPosition, byAssetClass: Object.values(cls).sort((a, b) => b.total - a.total)
  };
}

// Ledoit-Wolf (2004) shrinkage of a sample covariance towards a scaled identity. X: T×N, demeaned.
// Returns the shrunk matrix and the shrinkage intensity (0 = sample, 1 = target).
export function ledoitWolf(X) {
  const T = X.length, N = X[0]?.length || 0;
  const S = Array.from({ length: N }, () => new Array(N).fill(0));
  for (const x of X) for (let i = 0; i < N; i++) for (let j = i; j < N; j++) S[i][j] += x[i] * x[j] / T;
  for (let i = 0; i < N; i++) for (let j = 0; j < i; j++) S[i][j] = S[j][i];
  const mu = sum(S.map((r, i) => r[i])) / N;
  let d2 = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) d2 += (S[i][j] - (i === j ? mu : 0)) ** 2;
  d2 /= N;
  let b2 = 0;
  for (const x of X) { let s = 0; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) s += (x[i] * x[j] - S[i][j]) ** 2; b2 += s / N; }
  b2 /= T * T;
  const shrink = d2 ? Math.min(1, Math.min(b2, d2) / d2) : 1;
  return { S: S.map((r, i) => r.map((s, j) => shrink * (i === j ? mu : 0) + (1 - shrink) * s)), shrink };
}

// Eigen-decomposition of a symmetric matrix by cyclic Jacobi rotations. Returns eigenvalues in
// descending order with their unit eigenvectors.
export function eigenSym(A, { tol = 1e-24, maxSweeps = 100 } = {}) {
  const n = A.length;
  const a = A.map(r => r.slice());
  const norm = sum(a.map(r => sum(r.map(x => x * x))));
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off <= tol * norm) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return a.map((r, i) => ({ value: r[i], vector: V.map(row => row[i]) })).sort((x, y) => y.value - x.value);
}

// Statistical risk drivers of the portfolio. Correlations of the positions' daily returns are
// shrunk (Ledoit-Wolf on standardised returns), turned back into a P&L covariance with each
// position's own volatility, and decomposed. Portfolio variance = Σ λk (vk · 1)², so each
// component's share of it says how concentrated the portfolio's risk really is.
export function riskDrivers(hp, { maxN = 60, minObs = 60 } = {}) {
  if (!hp || hp.obs < minObs) return null;
  const pos = hp.covered.filter(c => c.key !== 'FX' && c.exposure && c.pnl.filter(isNum).length >= minObs)
    .sort((a, b) => Math.abs(b.exposure) - Math.abs(a.exposure)).slice(0, maxN);
  if (pos.length < 3) return null;
  const T = hp.dates.length;
  const rows = [];
  for (let t = 1; t < T; t++) { const r = pos.map(c => c.pnl[t]); if (r.every(isNum)) rows.push(r); }
  if (rows.length < minObs) return null;
  const N = pos.length;
  const m = pos.map((_, i) => mean(rows.map(r => r[i])));
  const sd = pos.map((_, i) => Math.sqrt(mean(rows.map(r => (r[i] - m[i]) ** 2))));
  if (sd.some(s => !(s > 0))) return null;
  const Z = rows.map(r => r.map((x, i) => (x - m[i]) / sd[i]));
  const { S: R, shrink } = ledoitWolf(Z);
  const Sigma = R.map((r, i) => r.map((x, j) => x * sd[i] * sd[j]));
  const eig = eigenSym(Sigma);
  const total = sum(eig.map(e => e.value * sum(e.vector) ** 2));
  const comps = eig.map((e, k) => {
    const load = e.vector.map((w, i) => ({ row: pos[i].row, w: w * Math.sqrt(Math.max(0, e.value)) }));
    const dir = Math.sign(sum(e.vector)) || 1;
    return {
      k: k + 1, share: total ? e.value * sum(e.vector) ** 2 / total : 0, varianceShare: e.value / sum(eig.map(x => x.value)),
      top: load.map(l => ({ ...l, w: l.w * dir })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 4)
    };
  });
  const shares = comps.map(c => c.share).filter(s => s > 1e-12);
  const effective = Math.exp(-sum(shares.map(s => s * Math.log(s))));
  let acc = 0, n80 = 0;
  for (const c of [...comps].sort((a, b) => b.share - a.share)) { acc += c.share; n80++; if (acc >= 0.8) break; }
  // Numbered by their share of the portfolio's variance, which is the order that matters here.
  const components = comps.sort((a, b) => b.share - a.share).map((c, i) => ({ ...c, k: i + 1 }));
  return { n: N, obs: rows.length, shrink, components, effective, n80, top1: components[0].share };
}
