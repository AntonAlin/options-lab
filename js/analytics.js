// Portfolio analytics. Every function takes plain data (a portfolio object) and returns plain
// data, so the same numbers drive the screen, the PDF and the tests.
import { INSTRUMENTS, validatePosition, regionOf, ratingScore, ratingFromScore, isInvestmentGrade, displayName, SUBUNITS, majorCcy } from './instruments.js';
import { normInv, normPDF } from './pricing.js';
import { isNum, num, sum, mean, stdev, quantile, covariance, todayISO } from './util.js';
import { FALLBACK_EUR_RATES, DEFAULT_CMA, DEFAULT_RISK } from './store.js';

// ---- valuation ----------------------------------------------------------------------------------
export function makeCtx(p) {
  const eur = p.fxEur || FALLBACK_EUR_RATES;
  const b = eur[p.baseCcy];
  const cma = { ...DEFAULT_CMA, ...(p.cma || {}) };
  return {
    base: p.baseCcy,
    valDate: p.valDate || todayISO(),
    fx: ccy => {
      if (SUBUNITS[ccy]) { const [major, k] = SUBUNITS[ccy]; ccy = major; if (ccy === p.baseCcy) return k; const c = eur[ccy]; return isNum(c) && isNum(b) && c > 0 ? k * b / c : undefined; }
      if (!ccy || ccy === p.baseCcy) return 1; const c = eur[ccy]; return isNum(c) && isNum(b) && c > 0 ? b / c : undefined;
    },
    cma: { ...cma, equitySpecificVol: cma.equitySpecificVol / 100 },
    useReported: p.risk?.useReported !== false
  };
}

const PRICE_EXPOSURE_TYPES = new Set(['future', 'option']);
const DEFAULT_LIQ_DAYS = { equity: 2, etf: 1, corp_bond: 3, frn: 3, govt_bond: 1, commodity: 1, alternative: 180, fund: 3 };

export function valuePortfolio(p) {
  const ctx = makeCtx(p);
  const rows = (p.positions || []).map(pos => {
    const def = INSTRUMENTS[pos.type];
    const errors = validatePosition(pos);
    let r;
    try { r = def ? def.risk(pos, ctx) : null; } catch (e) { r = null; errors.push({ field: 'type', code: 'calc_failed' }); }
    if (r) for (const k of ['mv', 'exposure', 'net', 'eqDelta', 'cs01', 'cmDelta', 'vega', 'gamma']) if (!isNum(r[k])) r[k] = 0;
    return { pos, def, r, errors, name: displayName(pos), warnings: r ? r.warnings : [] };
  });
  const valid = rows.filter(x => x.r);
  const nav = sum(valid.map(x => x.r.mv));
  const gross = sum(valid.map(x => x.r.exposure));
  const derivCommit = sum(valid.filter(x => x.def.group === 'derivatives').map(x => x.r.exposure));
  valid.forEach(x => {
    x.weight = nav ? x.r.mv / nav : 0;
    x.expWeight = nav ? x.r.exposure / nav : 0;
    x.netWeight = nav ? x.r.net / nav : 0;
    x.issuer = (x.pos.issuer || x.pos.name || x.name || '').trim();
  });
  const cash = sum(valid.filter(x => x.r.assetClass === 'cash').map(x => x.r.mv));
  return {
    p, ctx, rows, valid, nav, gross, derivCommit, cash,
    leverage: nav ? gross / nav : 0,
    netExposure: sum(valid.map(x => x.r.net)),
    errorsCount: rows.filter(x => x.errors.length).length,
    warningsCount: rows.filter(x => x.warnings.length).length,
    fxMissing: [...new Set(rows.flatMap(x => x.warnings.filter(w => w.startsWith('fx_missing:')).map(w => w.split(':')[1])))]
  };
}

// ---- allocation ----------------------------------------------------------------------------------
function groupBy(rows, keyFn, valFn, nav) {
  const m = new Map();
  for (const x of rows) {
    const k = keyFn(x) || '—';
    m.set(k, (m.get(k) || 0) + valFn(x));
  }
  return [...m.entries()].map(([key, value]) => ({ key, value, weight: nav ? value / nav : 0 }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

export function allocations(v) {
  const rows = v.valid, nav = v.nav;
  const mv = x => x.r.mv;
  const fiRows = rows.filter(x => x.r.fi && !x.r.fi.derivative && !x.r.fi.fund);
  return {
    assetClass: groupBy(rows, x => x.r.assetClass, mv, nav),
    exposureByClass: groupBy(rows, x => x.r.assetClass, x => x.r.net, nav),
    type: groupBy(rows, x => x.pos.type, mv, nav),
    sector: groupBy(rows.filter(x => !['cash', 'fx_forward', 'irs'].includes(x.pos.type) && x.pos.type !== 'govt_bond'), x => (x.pos.sector || '').trim() || '—', mv, nav),
    region: groupBy(rows.filter(x => !['cash', 'fx_forward'].includes(x.pos.type)), x => regionOf(x.pos.country), mv, nav),
    country: groupBy(rows, x => (x.pos.country || '').toUpperCase().trim() || '—', mv, nav),
    currency: groupBy(rows.filter(x => x.pos.type !== 'fx_forward'), x => majorCcy(x.pos.ccy) || v.ctx.base, mv, nav),
    rating: groupBy(fiRows, x => bucketRating(x.pos.rating), mv, nav),
    issuer: groupBy(rows.filter(x => !['cash', 'fx_forward', 'irs', 'future'].includes(x.pos.type)), x => x.issuer, mv, nav).slice(0, 15),
    // By strategy the economic (net) exposure is what matters: a futures overlay has no market value.
    strategy: groupBy(rows.filter(x => x.pos.type !== 'cash'), x => (x.pos.strategy || '').trim() || '—', x => x.r.net, nav)
  };
}
export function bucketRating(r) {
  const s = ratingScore(r);
  if (s == null) return 'NR';
  return ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC-D'][s <= 1 ? 0 : s <= 4 ? 1 : s <= 7 ? 2 : s <= 10 ? 3 : s <= 13 ? 4 : s <= 16 ? 5 : 6];
}
export const RATING_BUCKETS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC-D', 'NR'];

export function concentration(v) {
  const rows = v.valid.filter(x => x.r.assetClass !== 'cash' && x.def.group !== 'derivatives' && x.r.mv > 0);
  const tot = sum(rows.map(x => x.r.mv));
  const w = rows.map(x => x.r.mv / (tot || 1));
  const hhi = sum(w.map(x => x * x));
  const sorted = [...v.valid].filter(x => x.def.group !== 'derivatives').sort((a, b) => b.r.mv - a.r.mv);
  return {
    hhi, effectiveN: hhi ? 1 / hhi : 0,
    top10: sum(sorted.slice(0, 10).map(x => x.weight)),
    top10Rows: sorted.slice(0, 10)
  };
}

// ---- fixed income ------------------------------------------------------------------------------
export const MATURITY_BUCKETS = [[0, 1, '0–1'], [1, 3, '1–3'], [3, 5, '3–5'], [5, 7, '5–7'], [7, 10, '7–10'], [10, 999, '10+']];
export function fixedIncome(v) {
  const rows = v.valid.filter(x => x.r.fi && !x.r.fi.derivative && !x.r.fi.fund);
  const fiMv = sum(rows.map(x => x.r.mv));
  const wavg = f => {
    const rr = rows.filter(x => isNum(f(x)));
    const w = sum(rr.map(x => x.r.mv));
    return w ? sum(rr.map(x => f(x) * x.r.mv)) / w : NaN;
  };
  const ir01ByCcy = {};
  let ir01 = 0, cs01 = 0;
  for (const x of v.valid) {
    for (const [c, val] of Object.entries(x.r.ir01)) { ir01ByCcy[c] = (ir01ByCcy[c] || 0) + val; ir01 += val; }
    cs01 += x.r.cs01;
  }
  const scored = rows.filter(x => ratingScore(x.pos.rating) != null);
  const sw = sum(scored.map(x => x.r.mv));
  const avgScore = sw ? sum(scored.map(x => ratingScore(x.pos.rating) * x.r.mv)) / sw : null;
  const maturity = MATURITY_BUCKETS.map(([lo, hi, label]) => {
    const value = sum(rows.filter(x => x.r.fi.years >= lo && x.r.fi.years < hi).map(x => x.r.mv));
    return { key: label, value, weight: v.nav ? value / v.nav : 0, share: fiMv ? value / fiMv : 0 };
  });
  // Key-rate style ladder of DV01 by maturity bucket, derivatives included — this is where a
  // receive-fixed swap or a short bond future shows up.
  const dv01Ladder = MATURITY_BUCKETS.map(([lo, hi, label]) => ({
    key: label,
    value: sum(v.valid.filter(x => x.r.fi && isNum(x.r.fi.years) && x.r.fi.years >= lo && x.r.fi.years < hi).map(x => sum(Object.values(x.r.ir01))))
  }));
  const hy = sum(rows.filter(x => x.pos.rating && !isInvestmentGrade(x.pos.rating)).map(x => x.r.mv));
  return {
    rows, fiMv, fiWeight: v.nav ? fiMv / v.nav : 0,
    ytm: wavg(x => x.r.fi.ytm), modDur: wavg(x => x.r.fi.modDur), spreadDur: wavg(x => x.r.fi.spreadDur),
    convexity: wavg(x => x.r.fi.convexity), years: wavg(x => x.r.fi.years),
    portfolioDuration: v.nav ? -ir01 / v.nav / 1e-4 : 0,
    portfolioSpreadDuration: v.nav ? -cs01 / v.nav / 1e-4 : 0,
    ir01, cs01, ir01ByCcy, avgRating: ratingFromScore(avgScore), avgScore,
    maturity, dv01Ladder, highYield: hy, highYieldWeight: v.nav ? hy / v.nav : 0,
    unrated: sum(rows.filter(x => ratingScore(x.pos.rating) == null).map(x => x.r.mv))
  };
}

// ---- currency ------------------------------------------------------------------------------------
export function currencyExposure(v) {
  const gross = {}, hedge = {};
  for (const x of v.valid) {
    for (const [c, a] of Object.entries(x.r.fx)) {
      if (x.pos.type === 'fx_forward' || (['future', 'option'].includes(x.pos.type) && x.pos.underlyingClass === 'fx')) hedge[c] = (hedge[c] || 0) + a;
      else gross[c] = (gross[c] || 0) + a;
    }
  }
  const ccys = [...new Set([...Object.keys(gross), ...Object.keys(hedge)])];
  const out = ccys.map(c => {
    const g = gross[c] || 0, h = hedge[c] || 0, net = g + h;
    return { ccy: c, gross: g, hedge: h, net, grossW: v.nav ? g / v.nav : 0, netW: v.nav ? net / v.nav : 0, hedgeRatio: g ? -h / g : 0 };
  }).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const totalNet = sum(out.map(x => Math.abs(x.net)));
  return { rows: out, totalNet, totalNetW: v.nav ? totalNet / v.nav : 0 };
}

// ---- parametric factor risk -------------------------------------------------------------------
// Delta-normal model on a handful of macro factors plus uncorrelated stock-specific risk.
// Sensitivities come straight from the instrument registry; vols and correlations are the
// portfolio's capital-market assumptions (editable in Settings).
export function factorModel(v) {
  const c = { ...DEFAULT_CMA, ...(v.p.cma || {}) };
  const rateCcys = new Set(), fxCcys = new Set(), infCcys = new Set();
  v.valid.forEach(x => { Object.keys(x.r.ir01).forEach(k => rateCcys.add(k)); Object.keys(x.r.fx).forEach(k => fxCcys.add(k)); Object.keys(x.r.inf01 || {}).forEach(k => infCcys.add(k)); });
  const factors = [
    { id: 'EQ', group: 'equity', vol: c.equityVol / 100 },
    { id: 'CS', group: 'credit', vol: c.creditVolBp },
    { id: 'CMD', group: 'commodity', vol: c.commodityVol / 100 },
    { id: 'VOL', group: 'volatility', vol: c.volOfVolPts },
    ...[...rateCcys].sort().map(k => ({ id: 'IR:' + k, group: 'rates', vol: c.ratesVolBp, ccy: k })),
    ...[...infCcys].sort().map(k => ({ id: 'INF:' + k, group: 'inflation', vol: c.inflationVolBp, ccy: k })),
    ...[...fxCcys].sort().map(k => ({ id: 'FX:' + k, group: 'currency', vol: c.fxVol / 100, ccy: k }))
  ];
  const n = factors.length;
  const corr = (a, b) => {
    if (a === b) return 1;
    const g = [a.group, b.group].sort().join('|');
    switch (g) {
      case 'equity|rates': return c.corrEqRates;
      case 'credit|equity': return c.corrEqCredit;
      case 'currency|equity': return c.corrEqFx;
      case 'commodity|equity': return c.corrEqCmd;
      case 'equity|volatility': return c.corrEqVol;
      case 'credit|rates': return c.corrRatesCredit;
      case 'rates|rates': return c.corrRatesRates;
      case 'currency|currency': return c.corrFxFx;
      case 'commodity|currency': return c.corrCmdFx;
      case 'credit|volatility': return 0.5;
      // Breakeven inflation moves with nominal rates of the same currency, less with others.
      case 'inflation|rates': return a.ccy === b.ccy ? c.corrRatesInfl : c.corrRatesInfl * c.corrRatesRates;
      case 'inflation|inflation': return c.corrRatesRates;
      case 'commodity|inflation': return c.corrCmdInfl;
      case 'commodity|credit': return -0.2;
      default: return 0;
    }
  };
  const cov = factors.map(a => factors.map(b => corr(a, b) * a.vol * b.vol));
  const sensOf = x => factors.map(f => {
    switch (f.id) {
      case 'EQ': return x.r.eqDelta * x.r.beta;
      case 'CS': return x.r.cs01;
      case 'CMD': return x.r.cmDelta;
      case 'VOL': return x.r.vega;
      default: return f.group === 'rates' ? (x.r.ir01[f.ccy] || 0) : f.group === 'inflation' ? ((x.r.inf01 || {})[f.ccy] || 0) : (x.r.fx[f.ccy] || 0);
    }
  });
  const S = v.valid.map(sensOf);
  const s = factors.map((_, k) => sum(S.map(row => row[k])));
  const Cs = cov.map(row => sum(row.map((cv, j) => cv * s[j])));
  const specVar = v.valid.map(x => (x.r.specificVol * Math.abs(x.r.eqDelta)) ** 2);
  const sysVar = Math.max(0, sum(s.map((si, i) => si * Cs[i])));
  const variance = sysVar + sum(specVar);
  const sigma = Math.sqrt(variance);

  const risk = { ...DEFAULT_RISK, ...(v.p.risk || {}) };
  const scale = Math.sqrt(risk.horizonDays / 252);
  const z = normInv(risk.confidence);
  const sigH = sigma * scale;

  const byFactorGroup = {};
  factors.forEach((f, k) => { byFactorGroup[f.group] = (byFactorGroup[f.group] || 0) + (sigma ? s[k] * Cs[k] / sigma : 0); });
  byFactorGroup.specific = sigma ? sum(specVar) / sigma : 0;
  // The same Euler contributions rolled up the way a manager thinks: per asset class, with the
  // market factor, stock-specific risk, implied vol and the derivatives on that class in one
  // bucket. Currency is its own bucket across all positions, because that is where the hedges
  // net against the foreign holdings.
  const byAssetClass = {};
  const bucketOf = (x, f) => (f && f.group === 'currency' ? 'currency' : x.r.assetClass);
  const addTo = (key, part, val) => { const b = byAssetClass[key] || (byAssetClass[key] = { key, total: 0, securities: 0, derivatives: 0, standalone: 0 }); b.total += val; b[part] += val; };
  v.valid.forEach((x, i) => {
    const part = x.def.group === 'derivatives' ? 'derivatives' : 'securities';
    factors.forEach((f, k) => { const c = sigma ? S[i][k] * Cs[k] / sigma : 0; if (c) addTo(bucketOf(x, f), part, c); });
    if (specVar[i]) addTo(x.r.assetClass, part, sigma ? specVar[i] / sigma : 0);
  });
  // Stand-alone vol of each bucket: the positions' own factors (FX excluded) or, for currency, the FX factors of everyone.
  for (const b of Object.values(byAssetClass)) {
    const sb = factors.map((f, k) => sum(v.valid.map((x, i) => (bucketOf(x, f) === b.key ? S[i][k] : 0))));
    let vv = sum(v.valid.map((x, i) => (x.r.assetClass === b.key && b.key !== 'currency' ? specVar[i] : 0)));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) vv += sb[i] * cov[i][j] * sb[j];
    b.standalone = Math.sqrt(Math.max(0, vv));
  }
  const byPosition = v.valid.map((x, i) => {
    const contrib = sigma ? (sum(S[i].map((si, k) => si * Cs[k])) + specVar[i]) / sigma : 0;
    return { row: x, contrib, pct: sigma ? contrib / sigma : 0 };
  }).sort((a, b) => b.contrib - a.contrib);
  const standalone = {};
  for (const g of new Set(factors.map(f => f.group))) {
    const idx = factors.map((f, k) => f.group === g ? k : -1).filter(k => k >= 0);
    let vv = 0;
    for (const i of idx) for (const j of idx) vv += s[i] * cov[i][j] * s[j];
    standalone[g] = Math.sqrt(Math.max(0, vv));
  }
  standalone.specific = Math.sqrt(sum(specVar));

  return {
    method: 'parametric', factors, exposures: s, sigmaAnnual: sigma, volPct: v.nav ? sigma / v.nav : 0,
    var: z * sigH, es: sigH * normPDF(z) / (1 - risk.confidence),
    varPct: v.nav ? z * sigH / v.nav : 0, esPct: v.nav ? sigH * normPDF(z) / (1 - risk.confidence) / v.nav : 0,
    confidence: risk.confidence, horizonDays: risk.horizonDays,
    byFactorGroup, byAssetClass: Object.values(byAssetClass).sort((a, b) => b.total - a.total), standalone, byPosition, diversification: sum(Object.values(standalone)) - sigma
  };
}

// ---- price history & historical analytics -----------------------------------------------------
export function seriesKeyFor(pos, history) {
  const keys = Object.keys(history?.series || {});
  if (!keys.length) return null;
  const lower = new Map(keys.map(k => [k.toLowerCase().trim(), k]));
  for (const cand of [pos.seriesKey, pos.isin, pos.ticker, pos.name]) {
    if (cand && lower.has(String(cand).toLowerCase().trim())) return lower.get(String(cand).toLowerCase().trim());
  }
  return null;
}

function returnsOf(prices) {
  const out = new Array(prices.length).fill(NaN);
  for (let i = 1; i < prices.length; i++) {
    const a = prices[i - 1], b = prices[i];
    out[i] = isNum(a) && isNum(b) && a > 0 ? b / a - 1 : NaN;
  }
  return out;
}

// Returns aligned daily P&L (base ccy) for each covered position, and the portfolio.
// Missing observations inside a series count as a flat day, which is what a pricing gap is.
export function historicalPnl(v) {
  const h = v.p.history;
  if (!h || !h.dates || h.dates.length < 3) return null;
  const n = h.dates.length;
  const base = v.ctx.base;
  const fxRet = ccy => {
    if (!ccy || ccy === base) return null;
    const k = seriesKeyFor({ ticker: ccy + base, name: ccy + '/' + base, isin: 'FX:' + ccy }, h);
    return k ? returnsOf(h.series[k]) : null;
  };
  const covered = [], uncovered = [];
  for (const x of v.valid) {
    if (['cash', 'fx_forward'].includes(x.pos.type)) continue;
    const key = seriesKeyFor(x.pos, h);
    const exposure = PRICE_EXPOSURE_TYPES.has(x.pos.type) ? x.r.net : x.r.mv;
    if (!key) { if (x.r.assetClass !== 'money_market') uncovered.push(x); continue; }
    const r = returnsOf(h.series[key]);
    const fr = fxRet(x.pos.ccy);
    const pnl = r.map((ri, t) => {
      if (t === 0) return NaN;
      const loc = isNum(ri) ? ri : 0;
      const fx = fr && isNum(fr[t]) ? fr[t] : 0;
      return exposure * ((1 + loc) * (1 + fx) - 1);
    });
    covered.push({ row: x, key, pnl, exposure });
  }
  // FX-forward hedges earn the FX return on their currency legs if FX series exist.
  for (const x of v.valid.filter(x => x.pos.type === 'fx_forward')) {
    const legs = Object.entries(x.r.fx).map(([c, a]) => ({ a, r: fxRet(c) })).filter(l => l.r);
    if (!legs.length) continue;
    const pnl = h.dates.map((_, t) => t === 0 ? NaN : sum(legs.map(l => l.a * (isNum(l.r[t]) ? l.r[t] : 0))));
    covered.push({ row: x, key: 'FX', pnl, exposure: 0 });
  }
  const riskyNav = sum(v.valid.filter(x => !['cash', 'money_market', 'currency'].includes(x.r.assetClass)).map(x => Math.abs(PRICE_EXPOSURE_TYPES.has(x.pos.type) ? x.r.net : x.r.mv)));
  const coveredExp = sum(covered.map(c => Math.abs(c.exposure)));
  const pnl = h.dates.map((_, t) => t === 0 ? NaN : sum(covered.map(c => c.pnl[t])));
  return {
    dates: h.dates, covered, uncovered, portfolioPnl: pnl,
    portfolioRet: pnl.map(x => v.nav ? x / v.nav : NaN),
    coverage: riskyNav ? Math.min(1, coveredExp / riskyNav) : (covered.length ? 1 : 0), obs: n - 1
  };
}

// Per-position return, volatility and risk contribution over the last `window` observations of
// the back-cast — the three axes of the performance map. Weight and market value size the marker.
export function positionPerformance(hp, v, window = 252) {
  if (!hp) return [];
  const n = hp.dates.length, from = Math.max(1, n - window);
  const port = hp.portfolioPnl.slice(from).map(x => num(x));
  const sdPort = stdev(port);
  return hp.covered.filter(c => c.key !== 'FX' && c.exposure).map(c => {
    const pnl = c.pnl.slice(from).map(x => num(x));
    const rets = pnl.map(x => x / c.exposure);
    const total = rets.reduce((g, r) => g * (1 + r), 1) - 1;
    const vol = stdev(rets) * Math.sqrt(252);
    const contrib = sdPort ? covariance(pnl, port) / sdPort * Math.sqrt(252) : 0;
    return { row: c.row, name: c.row.name, cls: c.row.r.assetClass, ret: total, retAnn: rets.length >= 20 ? Math.pow(1 + total, 252 / rets.length) - 1 : total, vol, contrib, contribPct: v.nav ? contrib / v.nav : 0, weight: c.row.weight, exposureW: v.nav ? c.exposure / v.nav : 0, obs: rets.length };
  });
}

export function perfStats(ret, { rf = 0, periodsPerYear = 252, bench = null } = {}) {
  const r = ret.filter(isNum);
  if (r.length < 5) return null;
  const nav = [1];
  r.forEach(x => nav.push(nav[nav.length - 1] * (1 + x)));
  const total = nav[nav.length - 1] - 1;
  const years = r.length / periodsPerYear;
  const cagr = Math.pow(1 + total, 1 / years) - 1;
  const vol = stdev(r) * Math.sqrt(periodsPerYear);
  const rfP = rf / periodsPerYear;
  const downside = Math.sqrt(sum(r.map(x => Math.min(0, x - rfP) ** 2)) / r.length) * Math.sqrt(periodsPerYear);
  let peak = 1, mdd = 0, ddSeries = [];
  for (const x of nav) { peak = Math.max(peak, x); const dd = x / peak - 1; ddSeries.push(dd); mdd = Math.min(mdd, dd); }
  const m = mean(r), sd = stdev(r);
  const skew = sum(r.map(x => ((x - m) / sd) ** 3)) / r.length;
  const kurt = sum(r.map(x => ((x - m) / sd) ** 4)) / r.length - 3;
  const out = {
    total, cagr, vol, sharpe: vol ? (cagr - rf) / vol : NaN, sortino: downside ? (cagr - rf) / downside : NaN,
    maxDD: mdd, calmar: mdd ? cagr / -mdd : NaN, skew, kurt,
    best: Math.max(...r), worst: Math.min(...r), hitRate: r.filter(x => x > 0).length / r.length,
    var95: -quantile(r, 0.05), var99: -quantile(r, 0.01),
    es95: -mean(r.filter(x => x <= quantile(r, 0.05))), es99: -mean(r.filter(x => x <= quantile(r, 0.01))),
    nav, drawdown: ddSeries, n: r.length
  };
  if (bench) {
    const pairs = ret.map((x, i) => [x, bench[i]]).filter(([a, b]) => isNum(a) && isNum(b));
    if (pairs.length > 5) {
      const a = pairs.map(q => q[0]), b = pairs.map(q => q[1]);
      const beta = covariance(a, b) / (stdev(b) ** 2);
      const active = a.map((x, i) => x - b[i]);
      const te = stdev(active) * Math.sqrt(periodsPerYear);
      const bStats = perfStats(b, { rf, periodsPerYear });
      const up = pairs.filter(q => q[1] > 0), dn = pairs.filter(q => q[1] < 0);
      Object.assign(out, {
        beta, correlation: covariance(a, b) / (stdev(a) * stdev(b)),
        alpha: (cagr - rf) - beta * ((bStats?.cagr ?? 0) - rf),
        trackingError: te, infoRatio: te ? (cagr - (bStats?.cagr ?? 0)) / te : NaN,
        upCapture: up.length ? mean(up.map(q => q[0])) / mean(up.map(q => q[1])) : NaN,
        downCapture: dn.length ? mean(dn.map(q => q[0])) / mean(dn.map(q => q[1])) : NaN,
        bench: bStats
      });
    }
  }
  return out;
}

export function historicalRisk(v, hp = historicalPnl(v)) {
  if (!hp || hp.obs < 20) return null;
  const risk = { ...DEFAULT_RISK, ...(v.p.risk || {}) };
  const pnl = hp.portfolioPnl.filter(isNum);
  const a = 1 - risk.confidence;
  const q = quantile(pnl, a);
  const scale = Math.sqrt(risk.horizonDays);
  const tail = pnl.filter(x => x <= q);
  const sd = stdev(pnl);
  const byPosition = hp.covered.map(c => {
    const cv = covariance(c.pnl.slice(1).map(x => num(x)), hp.portfolioPnl.slice(1).map(x => num(x)));
    return { row: c.row, contrib: sd ? cv / sd * Math.sqrt(252) : 0 };
  }).sort((x, y) => y.contrib - x.contrib);
  const sigA = sd * Math.sqrt(252);
  byPosition.forEach(b => { b.pct = sigA ? b.contrib / sigA : 0; });
  const cls = {};
  for (const b of byPosition) { const k = b.row.r.assetClass, part = b.row.def.group === 'derivatives' ? 'derivatives' : 'securities'; const o = cls[k] || (cls[k] = { key: k, total: 0, securities: 0, derivatives: 0 }); o.total += b.contrib; o[part] += b.contrib; }
  const byAssetClass = Object.values(cls).sort((a, b) => b.total - a.total);
  return {
    method: 'historical', var: -q * scale, es: -mean(tail) * scale,
    varPct: v.nav ? -q * scale / v.nav : 0, esPct: v.nav ? -mean(tail) * scale / v.nav : 0,
    sigmaAnnual: sigA, volPct: v.nav ? sigA / v.nav : 0,
    confidence: risk.confidence, horizonDays: risk.horizonDays, obs: pnl.length, coverage: hp.coverage, byPosition, byAssetClass
  };
}

export function chooseRisk(v) {
  const param = factorModel(v);
  const hp = historicalPnl(v);
  const hist = historicalRisk(v, hp);
  const method = v.p.risk?.method || 'auto';
  let headline = param;
  if (method === 'historical' && hist) headline = hist;
  else if (method === 'auto' && hist && hist.coverage >= 0.7 && hist.obs >= 120) headline = hist;
  return { param, hist, hp, headline };
}

export function correlationMatrix(hp, maxN = 12) {
  if (!hp) return null;
  const top = [...hp.covered].filter(c => c.key !== 'FX').sort((a, b) => Math.abs(b.exposure) - Math.abs(a.exposure)).slice(0, maxN);
  const rets = top.map(c => c.pnl.map(x => (c.exposure ? x / c.exposure : NaN)));
  const valid = rets.map(r => r.slice(1).map(x => num(x)));
  const M = valid.map(a => valid.map(b => {
    const sa = stdev(a), sb = stdev(b);
    return sa && sb ? covariance(a, b) / (sa * sb) : 0;
  }));
  return { labels: top.map(c => c.row.name), matrix: M };
}

export function rollingVol(ret, window = 63) {
  const out = ret.map(() => NaN);
  for (let i = window; i < ret.length; i++) {
    const w = ret.slice(i - window + 1, i + 1).filter(isNum);
    if (w.length > window * 0.8) out[i] = stdev(w) * Math.sqrt(252);
  }
  return out;
}

export function monthlyReturns(dates, ret) {
  const m = new Map();
  dates.forEach((d, i) => {
    if (!isNum(ret[i])) return;
    const k = d.slice(0, 7);
    m.set(k, (m.get(k) ?? 1) * (1 + ret[i]));
  });
  const out = {};
  for (const [k, g] of m) {
    const [y, mo] = k.split('-');
    (out[y] ||= {})[+mo] = g - 1;
  }
  for (const y of Object.keys(out)) {
    const months = Object.values(out[y]);
    out[y].ytd = months.reduce((a, r) => a * (1 + r), 1) - 1;
  }
  return out;
}

// ---- stress testing -----------------------------------------------------------------------------
// Shock units: eq/cmd/fx are returns (−0.2 = −20 %), rates/cs in basis points, vol in vol points.
// fxAll is the move of every foreign currency against the base (+0.1 = foreign currencies +10 %,
// i.e. the base currency weakens). These are stylised calibrations of well-known episodes, not a
// replay of history — the page says so.
export const SCENARIOS = [
  { id: 'gfc2008', en: 'Global financial crisis (autumn 2008)', sv: 'Finanskrisen (hösten 2008)', eq: -0.35, rates: -150, cs: 300, fxAll: 0.15, cmd: -0.40, vol: 30, infl: -150 },
  { id: 'euro2011', en: 'Euro debt crisis (2011)', sv: 'Eurokrisen (2011)', eq: -0.22, rates: -100, cs: 180, fxAll: 0.05, cmd: -0.15, vol: 20, infl: -40 },
  { id: 'covid2020', en: 'Covid crash (Feb–Mar 2020)', sv: 'Coronakraschen (feb–mar 2020)', eq: -0.30, rates: -80, cs: 200, fxAll: 0.08, cmd: -0.30, vol: 40, infl: -90 },
  { id: 'rates2022', en: 'Inflation & rate shock (2022)', sv: 'Inflations- och räntechocken (2022)', eq: -0.20, rates: 250, cs: 120, fxAll: 0.12, cmd: 0.20, vol: 10, infl: 60 },
  { id: 'eq10', en: 'Equities −10 %', sv: 'Aktier −10 %', eq: -0.10, rates: 0, cs: 0, fxAll: 0, cmd: 0, vol: 5 },
  { id: 'eq20up', en: 'Equities +15 %', sv: 'Aktier +15 %', eq: 0.15, rates: 0, cs: -30, fxAll: 0, cmd: 0, vol: -4 },
  { id: 'rup100', en: 'Rates +100 bp parallel', sv: 'Räntor +100 bp parallellt', eq: 0, rates: 100, cs: 0, fxAll: 0, cmd: 0, vol: 0 },
  { id: 'rdn100', en: 'Rates −100 bp parallel', sv: 'Räntor −100 bp parallellt', eq: 0, rates: -100, cs: 0, fxAll: 0, cmd: 0, vol: 0 },
  { id: 'cs100', en: 'Credit spreads +100 bp', sv: 'Kreditspreadar +100 bp', eq: 0, rates: 0, cs: 100, fxAll: 0, cmd: 0, vol: 0 },
  { id: 'basestrong', en: 'Base currency +10 %', sv: 'Basvalutan +10 %', eq: 0, rates: 0, cs: 0, fxAll: -0.0909, cmd: 0, vol: 0 },
  { id: 'stagflation', en: 'Stagflation', sv: 'Stagflation', eq: -0.15, rates: 150, cs: 150, fxAll: 0.03, cmd: 0.25, vol: 12, infl: 100 }
];

export function stressPosition(x, s, ctx) {
  // A type's own revaluation wins; null means it has nothing better than the sensitivities.
  if (x.def.stressPnl) { const v = x.def.stressPnl(x.pos, ctx, s); if (v != null) return v; }
  const r = x.r;
  let pnl = r.eqDelta * r.beta * (s.eq || 0) + r.cmDelta * (s.cmd || 0) + r.vega * (s.vol || 0) + 0.5 * r.gamma * (s.eq || 0) ** 2;
  for (const [c, v] of Object.entries(r.ir01)) pnl += v * (s.ratesBy?.[c] ?? s.rates ?? 0);
  for (const v of Object.values(r.inf01 || {})) pnl += v * (s.infl || 0);
  pnl += r.cs01 * (s.cs || 0);
  if (r.fi && r.fi.convexity && !r.fi.derivative) {
    const dy = ((s.ratesBy?.[x.pos.ccy] ?? s.rates ?? 0) + (r.fi.spreadDur ? (s.cs || 0) : 0)) / 1e4;
    pnl += 0.5 * r.mv * r.fi.convexity * dy * dy;
  }
  // Translation P&L on the currency exposure, plus the cross term: the local-market P&L above is
  // itself converted at the shocked rate.
  const localPnl = pnl;
  const ownMove = x.pos.ccy && x.pos.ccy !== ctx.base ? (s.fx?.[x.pos.ccy] ?? s.fxAll ?? 0) : 0;
  pnl += localPnl * ownMove;
  for (const [c, v] of Object.entries(r.fx)) pnl += v * (s.fx?.[c] ?? s.fxAll ?? 0);
  return pnl;
}

export function runStress(v, scenarios = SCENARIOS) {
  return scenarios.map(s => {
    const per = v.valid.map(x => ({ row: x, pnl: stressPosition(x, s, v.ctx) }));
    const total = sum(per.map(q => q.pnl));
    const byClass = {};
    per.forEach(q => { byClass[q.row.r.assetClass] = (byClass[q.row.r.assetClass] || 0) + q.pnl; });
    return { scenario: s, total, pct: v.nav ? total / v.nav : 0, per: per.sort((a, b) => a.pnl - b.pnl), byClass };
  });
}

// ---- liquidity ----------------------------------------------------------------------------------
export const LIQ_HORIZONS = [1, 7, 30, 90, 365];
export function liquidity(v, { stressed = false } = {}) {
  const part = Math.max(0.01, num(v.p.risk?.participation, 20) / 100) * (stressed ? 0.5 : 1);
  const rows = v.valid.filter(x => x.r.mv > 0).map(x => {
    let days = x.r.liqDays, basis = 'type';
    const adv = num(x.pos.adv);
    if (days == null && adv > 0) { days = Math.max(1, Math.ceil(Math.abs(num(x.pos.qty)) / (adv * part))); basis = 'adv'; }
    else if (days == null) days = DEFAULT_LIQ_DAYS[x.pos.type] ?? 5;
    else if (stressed && days > 1) days = days * 1.5;
    return { row: x, days: Math.max(0, days), basis };
  });
  const assets = sum(rows.map(q => q.row.r.mv));
  // Pro-rata: a position that needs 10 days has 70 % sold by day 7.
  const within = h => sum(rows.map(q => q.row.r.mv * (q.days <= h ? 1 : h / q.days)));
  const buckets = LIQ_HORIZONS.map(h => ({ h, value: within(h), pct: assets ? within(h) / assets : 0 }));
  const illiquid = sum(rows.filter(q => q.days > 90).map(q => q.row.r.mv));
  return { rows: rows.sort((a, b) => b.days - a.days), assets, buckets, illiquid, illiquidPct: v.nav ? illiquid / v.nav : 0, participation: part };
}

// ---- compliance ---------------------------------------------------------------------------------
const GOVT_RE = /(govern|treasur|stat(en|s)|riksg|kingdom|republic|bund|federal|sovereign|kommun|municipal|supranational|\beib\b|world bank|nordic investment)/i;
function isGovt(x) { return x.pos.type === 'govt_bond' || (['money_market', 'inflation_linked'].includes(x.pos.type) && (!x.pos.issuer || GOVT_RE.test(x.pos.issuer))); }
// UCITS art. 51(3): derivatives on a financial index are not combined with the issuer limits, so a
// CDS on iTraxx / CDX is not one issuer (it is 125 of them).
const INDEX_CDS_RE = /\b(itraxx|cdx|markit|index)\b/i;
const isIndexCds = x => x.pos.type === 'cds' && INDEX_CDS_RE.test(`${x.pos.issuer || ''} ${x.pos.name || ''}`);
const ISSUER_TYPES = new Set(['equity', 'corp_bond', 'frn', 'money_market', 'alternative', 'commodity', 'cds', 'inflation_linked', 'convertible', 'certificate']);

export function compliance(v, liq = liquidity(v)) {
  const L = v.p.limits || {};
  const nav = v.nav || 1;
  const pct = x => x / nav * 100;
  const status = (val, lim, dir = 'max') => {
    if (dir === 'max') return val > lim + 1e-9 ? 'breach' : val > lim * 0.9 ? 'warn' : 'ok';
    return val < lim - 1e-9 ? 'breach' : val < lim * 1.1 ? 'warn' : 'ok';
  };
  const out = [];
  const add = (id, value, dir, details = []) => {
    const lim = L[id];
    if (!lim || !lim.on) return;
    out.push({ id, value, limit: lim.value, dir, status: status(value, lim.value, dir), details });
  };

  const issuerExp = new Map();
  for (const x of v.valid) {
    if (!ISSUER_TYPES.has(x.pos.type) || isGovt(x) || isIndexCds(x)) continue;
    const e = x.pos.type === 'cds' ? (x.pos.protection === 'sell' ? x.r.exposure : 0) : x.r.mv;
    issuerExp.set(x.issuer, (issuerExp.get(x.issuer) || 0) + e);
  }
  const issuers = [...issuerExp.entries()].map(([k, e]) => ({ name: k, value: pct(e) })).sort((a, b) => b.value - a.value);
  add('issuerMax', issuers[0]?.value || 0, 'max', issuers.filter(i => i.value > (L.issuerMax?.value ?? 10) * 0.9).slice(0, 8));
  const over5 = issuers.filter(i => i.value > 5);
  add('issuer5_10_40', sum(over5.map(i => i.value)), 'max', over5);

  const govt = new Map();
  v.valid.filter(isGovt).forEach(x => govt.set(x.issuer, (govt.get(x.issuer) || 0) + x.r.mv));
  const gl = [...govt.entries()].map(([k, e]) => ({ name: k, value: pct(e) })).sort((a, b) => b.value - a.value);
  add('govtIssuerMax', gl[0]?.value || 0, 'max', gl.slice(0, 5));

  const banks = new Map();
  v.valid.filter(x => x.pos.type === 'cash' && x.r.mv > 0).forEach(x => { const k = x.pos.issuer || x.pos.name || 'Bank'; banks.set(k, (banks.get(k) || 0) + x.r.mv); });
  const bl = [...banks.entries()].map(([k, e]) => ({ name: k, value: pct(e) })).sort((a, b) => b.value - a.value);
  add('bankDepositMax', bl[0]?.value || 0, 'max', bl.slice(0, 5));

  const funds = v.valid.filter(x => ['fund', 'etf'].includes(x.pos.type)).map(x => ({ name: x.name, value: pct(x.r.mv) })).sort((a, b) => b.value - a.value);
  add('fundMax', funds[0]?.value || 0, 'max', funds.slice(0, 5));

  const deriv = v.valid.filter(x => x.def.group === 'derivatives').map(x => ({ name: x.name, value: pct(x.r.exposure) })).sort((a, b) => b.value - a.value);
  add('commitment', pct(v.derivCommit), 'max', deriv.slice(0, 8));

  const cpty = new Map();
  // OTC: forwards and swaps, and options with a counterparty in the issuer field (listed options clear).
  // OTC derivatives at positive market value, plus securities lending and repos at their exposure
  // after collateral (UCITS art. 52 applies the counterparty limit to efficient portfolio management too).
  const OTC = ['fx_forward', 'irs', 'cds', 'equity_swap', 'ccs', 'otc', 'swaption', 'cap_floor', 'inflation_swap', 'variance_swap', 'exotic_option'];
  v.valid.forEach(x => {
    const exp = isNum(x.r.cptyExposure) ? x.r.cptyExposure : (OTC.includes(x.pos.type) || (x.pos.type === 'option' && x.pos.issuer)) ? Math.max(0, x.r.mv) : 0;
    if (exp > 0) { const k = x.pos.issuer || '—'; cpty.set(k, (cpty.get(k) || 0) + exp); }
  });
  const cl = [...cpty.entries()].map(([k, e]) => ({ name: k, value: pct(e) })).sort((a, b) => b.value - a.value);
  add('otcCounterparty', cl[0]?.value || 0, 'max', cl.slice(0, 5));

  const pos = v.valid.filter(x => x.def.group !== 'derivatives' && x.pos.type !== 'cash').map(x => ({ name: x.name, value: pct(x.r.mv) })).sort((a, b) => b.value - a.value);
  add('positionMax', pos[0]?.value || 0, 'max', pos.slice(0, 5));

  const sectors = new Map();
  v.valid.filter(x => x.pos.sector && x.def.group !== 'derivatives').forEach(x => sectors.set(x.pos.sector, (sectors.get(x.pos.sector) || 0) + x.r.mv));
  const sl = [...sectors.entries()].map(([k, e]) => ({ name: k, value: pct(e) })).sort((a, b) => b.value - a.value);
  add('sectorMax', sl[0]?.value || 0, 'max', sl.slice(0, 5));

  const hy = v.valid.filter(x => x.r.fi && !x.r.fi.derivative && x.pos.rating && !isInvestmentGrade(x.pos.rating));
  add('highYieldMax', pct(sum(hy.map(x => x.r.mv))), 'max', hy.map(x => ({ name: x.name, value: pct(x.r.mv) })).sort((a, b) => b.value - a.value).slice(0, 8));

  const b7 = liq.buckets.find(b => b.h === 7);
  add('liquidity7d', b7 ? b7.value / nav * 100 : 0, 'min');
  add('cashMin', pct(v.cash), 'min');
  add('illiquidMax', pct(liq.illiquid), 'max', liq.rows.filter(q => q.days > 90).map(q => ({ name: q.row.name, value: pct(q.row.r.mv) })));

  return {
    rules: out,
    breaches: out.filter(r => r.status === 'breach').length,
    warnings: out.filter(r => r.status === 'warn').length
  };
}

// ---- everything at once (dashboard & report) -----------------------------------------------------
export function fullAnalysis(p) {
  const v = valuePortfolio(p);
  const alloc = allocations(v);
  const fi = fixedIncome(v);
  const fx = currencyExposure(v);
  const risk = chooseRisk(v);
  const liq = liquidity(v);
  const liqStressed = liquidity(v, { stressed: true });
  const comp = compliance(v, liq);
  const stress = runStress(v);
  const conc = concentration(v);
  const bench = p.benchmark && p.history?.series?.[p.benchmark] ? returnsOf(p.history.series[p.benchmark]) : null;
  const perf = risk.hp ? perfStats(risk.hp.portfolioRet, { rf: num(p.risk?.riskFree, 2) / 100, bench }) : null;
  return { v, alloc, fi, fx, risk, liq, liqStressed, comp, stress, conc, perf, bench };
}

export { returnsOf };
