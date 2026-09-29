// Pricing maths: normal distribution, Black-Scholes-Merton / Black-76, plain-vanilla bond
// analytics and swap annuities. Pure functions, no DOM, covered by tests/pricing.test.mjs.
import { addMonthsISO, parseISODate, DAY_MS, isNum } from './util.js';

const SQRT2PI = Math.sqrt(2 * Math.PI);

// Hart (1968) / West (2005) double-precision normal CDF — same routine the options lab uses.
export function normCDF(x) {
  const ax = Math.abs(x);
  let c;
  if (ax > 37) c = 0;
  else {
    const e = Math.exp(-ax * ax / 2);
    if (ax < 7.07106781186547) {
      let b = 0.0352624965998911 * ax + 0.700383064443688;
      b = b * ax + 6.37396220353165; b = b * ax + 33.912866078383; b = b * ax + 112.079291497871;
      b = b * ax + 221.213596169931; b = b * ax + 220.206867912376;
      let d = 0.0883883476483184 * ax + 1.75566716318264;
      d = d * ax + 16.064177579207; d = d * ax + 86.7807322029461; d = d * ax + 296.564248779674;
      d = d * ax + 637.333633378831; d = d * ax + 793.826512519948; d = d * ax + 440.413735824752;
      c = e * b / d;
    } else {
      let b = ax + 0.65; b = ax + 4 / b; b = ax + 3 / b; b = ax + 2 / b; b = ax + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}
export function normPDF(x) { return Math.exp(-0.5 * x * x) / SQRT2PI; }

// Acklam's inverse normal, refined with one Halley step. Good to ~1e-15, used for VaR z-scores.
export function normInv(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q, r, x;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    q = p - 0.5; r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const e = normCDF(x) - p;
  const u = e * SQRT2PI * Math.exp(x * x / 2);
  return x - u / (1 + x * u / 2);
}

// ---- options ---------------------------------------------------------------------------------
// Generalised BSM: q is the continuous carry yield. Black-76 on a future is q = r.
export function bsm(type, S, K, T, r, q, sigma) {
  const call = type !== 'put';
  if (!(S > 0) || !(K > 0)) return { price: 0, delta: 0, gamma: 0, vega: 0, theta: 0 };
  if (T <= 1e-10 || sigma <= 1e-10) {
    const intrinsic = call ? Math.max(S - K, 0) : Math.max(K - S, 0);
    const itm = call ? S > K : S < K;
    return { price: intrinsic, delta: itm ? (call ? 1 : -1) : 0, gamma: 0, vega: 0, theta: 0 };
  }
  const sq = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sq);
  const d2 = d1 - sigma * sq;
  const dq = Math.exp(-q * T), dr = Math.exp(-r * T);
  const price = call ? S * dq * normCDF(d1) - K * dr * normCDF(d2) : K * dr * normCDF(-d2) - S * dq * normCDF(-d1);
  const delta = call ? dq * normCDF(d1) : -dq * normCDF(-d1);
  const gamma = dq * normPDF(d1) / (S * sigma * sq);
  const vega = S * dq * normPDF(d1) * sq / 100; // per 1 vol point
  const thetaY = call
    ? -S * dq * normPDF(d1) * sigma / (2 * sq) - r * K * dr * normCDF(d2) + q * S * dq * normCDF(d1)
    : -S * dq * normPDF(d1) * sigma / (2 * sq) + r * K * dr * normCDF(-d2) - q * S * dq * normCDF(-d1);
  return { price, delta, gamma, vega, theta: thetaY / 365 };
}

// ---- bonds -----------------------------------------------------------------------------------
// Coupon schedule rolled back from maturity (unadjusted, end-of-month preserved by addMonthsISO).
export function couponSchedule(valISO, maturityISO, freq) {
  const f = Math.max(1, Math.round(freq || 1));
  const step = 12 / f;
  const val = parseISODate(valISO), mat = parseISODate(maturityISO);
  if (!val || !mat || mat <= val) return { dates: [], prev: null };
  const dates = [maturityISO];
  let k = 1, d = addMonthsISO(maturityISO, -step);
  while (parseISODate(d) > val) {
    dates.unshift(d);
    k++;
    d = addMonthsISO(maturityISO, -step * k);
    if (k > 1200) break; // 100y monthly — anything beyond is garbage input
  }
  return { dates, prev: d };
}

// American option on a Cox-Ross-Rubinstein tree (early exercise checked at every node). Same inputs
// as bsm(); q is the dividend yield (or the foreign rate, or r for a future).
export function americanOption(type, S, K, T, r, q, sigma, steps = 200) {
  if (!(T > 0) || !(sigma > 0) || !(S > 0)) return Math.max(0, type === 'call' ? S - K : K - S);
  const dt = T / steps, u = Math.exp(sigma * Math.sqrt(dt)), d = 1 / u;
  const disc = Math.exp(-r * dt), pu = (Math.exp((r - q) * dt) - d) / (u - d), pd = 1 - pu;
  const pay = s => Math.max(0, type === 'call' ? s - K : K - s);
  const v = new Float64Array(steps + 1);
  for (let j = 0; j <= steps; j++) v[j] = pay(S * u ** (steps - j) * d ** j);
  for (let n = steps - 1; n >= 0; n--) {
    for (let j = 0; j <= n; j++) v[j] = Math.max(disc * (pu * v[j] + pd * v[j + 1]), pay(S * u ** (n - j) * d ** j));
  }
  return v[0];
}

// Street-convention bond analytics. price = clean % of par. Returns per-100 figures.
// Yield solved by Newton with bisection fallback. Coupon 0 gives a zero-coupon bond.
// `redemption` is the amount repaid per 100 at `maturity`: 100 for a bullet, the call price when a
// callable is priced to its call date.
export function bondAnalytics({ valuationDate, maturity, couponPct = 0, freq = 1, cleanPrice, yieldPct, redemption = 100 }) {
  const f = Math.max(1, Math.round(freq || 1));
  const { dates, prev } = couponSchedule(valuationDate, maturity, f);
  if (!dates.length) return null;
  const cpn = (couponPct || 0) / f;
  const val = parseISODate(valuationDate);
  const prevD = parseISODate(prev), nextD = parseISODate(dates[0]);
  const periodDays = (nextD - prevD) / DAY_MS;
  const w = Math.min(1, Math.max(0, ((nextD - val) / DAY_MS) / periodDays)); // fraction to next coupon
  const accrued = couponPct ? cpn * (1 - w) : 0;
  const flows = dates.map((d, i) => ({ t: (i + w) / f, n: i + w, cf: cpn + (i === dates.length - 1 ? redemption : 0) }));

  const pv = y => {
    const g = 1 + y / f;
    let p = 0, dp = 0;
    for (const fl of flows) {
      const disc = Math.pow(g, -fl.n);
      p += fl.cf * disc;
      dp += -fl.n / f * fl.cf * disc / g;
    }
    return { p, dp };
  };

  let y, dirty;
  if (isNum(cleanPrice) && cleanPrice > 0) {
    dirty = cleanPrice + accrued;
    y = isNum(yieldPct) ? yieldPct / 100 : (couponPct || 3) / 100;
    let ok = false;
    for (let i = 0; i < 60; i++) {
      const { p, dp } = pv(y);
      const step = (p - dirty) / dp;
      if (!isNum(step)) break;
      y -= step;
      if (y <= -f + 1e-6) break;
      if (Math.abs(step) < 1e-12) { ok = true; break; }
    }
    if (!ok || !isNum(y)) {
      let lo = -0.99 * f, hi = 5;
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (pv(mid).p > dirty) lo = mid; else hi = mid;
      }
      y = (lo + hi) / 2;
    }
  } else if (isNum(yieldPct)) {
    y = yieldPct / 100;
    dirty = pv(y).p;
  } else return null;

  const g = 1 + y / f;
  let mac = 0, conv = 0, p = 0;
  for (const fl of flows) {
    const disc = Math.pow(g, -fl.n);
    p += fl.cf * disc;
    mac += fl.t * fl.cf * disc;
    conv += fl.cf * disc * fl.n * (fl.n + 1) / (f * f);
  }
  mac /= p;
  const modDur = mac / g;
  const convexity = conv / (p * g * g);
  return {
    ytm: y, dirty: p, clean: p - accrued, accrued, macaulay: mac, modDur, convexity,
    yearsToMaturity: flows[flows.length - 1].t, nextCoupon: dates[0]
  };
}

// Annuity factor of a fixed leg priced flat at `ratePct` (single-curve approximation).
export function swapAnnuity(valuationDate, maturity, freq, ratePct) {
  const { dates } = couponSchedule(valuationDate, maturity, freq);
  if (!dates.length) return { annuity: 0, years: 0 };
  const f = Math.max(1, Math.round(freq || 1));
  const val = parseISODate(valuationDate), next = parseISODate(dates[0]);
  const w = Math.min(1, ((next - val) / DAY_MS) / (365.25 / f));
  const g = 1 + (ratePct || 0) / 100 / f;
  let a = 0;
  dates.forEach((_, i) => { a += (1 / f) * Math.pow(g, -(i + w)); });
  return { annuity: a, years: (dates.length - 1 + w) / f };
}
