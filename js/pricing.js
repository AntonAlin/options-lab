// Pricing maths: normal distribution, Black-Scholes-Merton / Black-76, plain-vanilla bond
// analytics and swap annuities. Pure functions, no DOM, covered by tests/pricing.test.mjs.
import { addMonthsISO, parseISODate, DAY_MS, isNum, mulberry32, gaussian } from './util.js';

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

// ============================================================================================
//  Rates options, inflation and variance swaps, barrier/digital options, autocalls, amortising
//  bonds. Flat curves throughout: the inputs are the forward rate, the market breakeven, the
//  implied vol you have, not a full term structure. Every function is covered by a parity or
//  known-value test in tests/core.test.mjs.
// ============================================================================================

// Bachelier (normal) and Black-76 (lognormal) on a forward. Price per unit of annuity / discount.
export function bachelier(type, F, K, T, sigma) {
  if (!(T > 0) || !(sigma > 0)) return { price: Math.max(0, type === 'call' ? F - K : K - F), delta: type === 'call' ? (F > K ? 1 : 0) : (F < K ? -1 : 0), vega: 0 };
  const s = sigma * Math.sqrt(T), d = (F - K) / s;
  const price = type === 'call' ? (F - K) * normCDF(d) + s * normPDF(d) : (K - F) * normCDF(-d) + s * normPDF(d);
  return { price, delta: type === 'call' ? normCDF(d) : normCDF(d) - 1, vega: Math.sqrt(T) * normPDF(d) };
}
export function black76(type, F, K, T, sigma) {
  if (!(T > 0) || !(sigma > 0) || !(F > 0) || !(K > 0)) return { price: Math.max(0, type === 'call' ? F - K : K - F), delta: type === 'call' ? (F > K ? 1 : 0) : (F < K ? -1 : 0), vega: 0 };
  const s = sigma * Math.sqrt(T), d1 = (Math.log(F / K) + 0.5 * s * s) / s, d2 = d1 - s;
  const price = type === 'call' ? F * normCDF(d1) - K * normCDF(d2) : K * normCDF(-d2) - F * normCDF(-d1);
  return { price, delta: type === 'call' ? normCDF(d1) : normCDF(d1) - 1, vega: F * Math.sqrt(T) * normPDF(d1) };
}
const rateOption = (volType, type, F, K, T, vol) => (volType === 'lognormal' ? black76(type, F, K, T, vol) : bachelier(type, F, K, T, vol));

// European swaption on a swap starting at expiry T and running `tenor` years, paying `freq` a year.
// Rates as decimals; normal vol in decimals (0.0080 = 80 bp), lognormal vol as a decimal (0.25).
// Returns per 1 of notional: { pv, annuity, dPVdF (value change per unit move of the forward), vega }.
export function swaption({ payer = true, F, K, T, tenor, freq = 1, vol, volType = 'normal' }) {
  const n = Math.max(1, Math.round(tenor * freq)), tau = 1 / freq;
  let annuity = 0;
  for (let i = 1; i <= n; i++) annuity += tau * Math.exp(-F * (T + i * tau));
  const o = rateOption(volType, payer ? 'call' : 'put', F, K, T, vol);
  const vegaUnit = volType === 'lognormal' ? o.vega : o.vega; // per 1.00 of vol
  return { pv: annuity * o.price, annuity, dPVdF: annuity * o.delta, vega: annuity * vegaUnit };
}

// Cap (call on the rate) or floor, from `start` to `start + tenor` years, one caplet per period.
// The first period's rate is already fixed, so it is left out (market convention).
export function capFloor({ cap = true, F, K, start = 0, tenor, freq = 4, vol, volType = 'normal' }) {
  const n = Math.max(1, Math.round(tenor * freq)), tau = 1 / freq;
  let pv = 0, dPVdF = 0, vega = 0;
  for (let i = 1; i < n; i++) {
    const tFix = start + i * tau, df = Math.exp(-F * (tFix + tau));
    const o = rateOption(volType, cap ? 'call' : 'put', F, K, tFix, vol);
    pv += tau * df * o.price; dPVdF += tau * df * o.delta; vega += tau * df * o.vega;
  }
  return { pv, dPVdF, vega };
}

// Zero-coupon inflation swap, receiving inflation: PV = N·DF(T)·[(1+b)^T − (1+K)^T].
export function zcInflationSwap({ receiveInflation = true, T, fixed, breakeven, rate }) {
  const df = Math.exp(-rate * T), sign = receiveInflation ? 1 : -1;
  const pv = sign * df * ((1 + breakeven) ** T - (1 + fixed) ** T);
  const dPVdB = sign * df * T * (1 + breakeven) ** (T - 1);
  return { pv, dPVdB, dPVdR: -T * pv };
}

// Variance swap (vols in points, 20 = 20 %): long receives realised variance. Vega notional Nv gives a
// variance notional of Nv / (2K). `elapsed` = share of the observation period already realised.
export function varianceSwap({ long = true, vegaNotional, strike, implied, realised = 0, elapsed = 0, T, rate = 0, kind = 'variance' }) {
  const df = Math.exp(-rate * T), sign = long ? 1 : -1, a = Math.min(1, Math.max(0, elapsed));
  const expVar = a * realised ** 2 + (1 - a) * implied ** 2;
  if (kind === 'volatility') {
    const expVol = Math.sqrt(expVar);
    return { pv: sign * vegaNotional * (expVol - strike) * df, vega: sign * vegaNotional * (1 - a) * (implied / (expVol || 1)) * df };
  }
  const varNotional = vegaNotional / (2 * strike);
  return { pv: sign * varNotional * (expVar - strike ** 2) * df, vega: sign * varNotional * 2 * implied * (1 - a) * df };
}

// Barrier options, Reiner-Rubinstein (Haug, The Complete Guide to Option Pricing Formulas, §4.17),
// no rebate. kind: 'down-and-in' | 'down-and-out' | 'up-and-in' | 'up-and-out'. b = r − q.
export function barrierOption(type, kind, S, K, H, T, r, q, sigma) {
  const vanilla = () => bsmPrice(type, S, K, T, r, q, sigma);
  const down = kind.startsWith('down'), isIn = kind.endsWith('in');
  if ((down && S <= H) || (!down && S >= H)) return isIn ? vanilla() : 0; // already hit
  if (!(T > 0)) return Math.max(0, type === 'call' ? S - K : K - S);
  const b = r - q, sT = sigma * Math.sqrt(T), mu = (b - sigma * sigma / 2) / (sigma * sigma);
  const phi = type === 'call' ? 1 : -1, eta = down ? 1 : -1;
  const eb = Math.exp((b - r) * T), er = Math.exp(-r * T);
  const x1 = Math.log(S / K) / sT + (1 + mu) * sT, x2 = Math.log(S / H) / sT + (1 + mu) * sT;
  const y1 = Math.log(H * H / (S * K)) / sT + (1 + mu) * sT, y2 = Math.log(H / S) / sT + (1 + mu) * sT;
  const A = phi * S * eb * normCDF(phi * x1) - phi * K * er * normCDF(phi * x1 - phi * sT);
  const B = phi * S * eb * normCDF(phi * x2) - phi * K * er * normCDF(phi * x2 - phi * sT);
  const C = phi * S * eb * (H / S) ** (2 * (mu + 1)) * normCDF(eta * y1) - phi * K * er * (H / S) ** (2 * mu) * normCDF(eta * y1 - eta * sT);
  const D = phi * S * eb * (H / S) ** (2 * (mu + 1)) * normCDF(eta * y2) - phi * K * er * (H / S) ** (2 * mu) * normCDF(eta * y2 - eta * sT);
  const hi = K > H;
  const table = {
    'call|down-and-in': hi ? C : A - B + D, 'call|up-and-in': hi ? A : B - C + D,
    'put|down-and-in': hi ? B - C + D : A, 'put|up-and-in': hi ? A - B + D : C,
    'call|down-and-out': hi ? A - C : B - D, 'call|up-and-out': hi ? 0 : A - B + C - D,
    'put|down-and-out': hi ? A - B + C - D : 0, 'put|up-and-out': hi ? B - D : A - C
  };
  return Math.max(0, table[type + '|' + kind]);
}
function bsmPrice(type, S, K, T, r, q, sigma) { return bsm(type, S, K, T, r, q, sigma).price; }

// Cash-or-nothing digital paying `payout` if in the money at expiry.
export function digitalOption(type, S, K, T, r, q, sigma, payout = 1) {
  if (!(T > 0)) return (type === 'call' ? S > K : S < K) ? payout : 0;
  const d2 = (Math.log(S / K) + (r - q - sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  return payout * Math.exp(-r * T) * normCDF(type === 'call' ? d2 : -d2);
}

// Autocallable note per 100 nominal, Monte Carlo (seeded, antithetic). On each remaining observation
// date, if the underlying is at or above autocall × initial, it repays 100 plus the coupon for every
// period since issue and ends. If never called: 100 at maturity if above protection × initial (plus
// the coupons if above the autocall level), otherwise 100 × final / initial.
export function autocall({ S, initial, T, obsPerYear = 1, periodsElapsed = 0, autocallLevel = 1, couponPct, protection = 0.6, r, q = 0, sigma, paths = 4000, seed = 7 }) {
  const n = Math.max(1, Math.round(T * obsPerYear));
  const dt = T / n, drift = (r - q - sigma * sigma / 2) * dt, sd = sigma * Math.sqrt(dt);
  const rng = mulberry32(seed);
  let total = 0;
  for (let k = 0; k < paths / 2; k++) {
    const z = Array.from({ length: n }, () => gaussian(rng));
    for (const sign of [1, -1]) {
      let s = S, pv = null;
      for (let i = 1; i <= n; i++) {
        s *= Math.exp(drift + sd * sign * z[i - 1]);
        const t = i * dt, periods = periodsElapsed + i;
        if (i < n && s >= autocallLevel * initial) { pv = (100 + couponPct * periods) * Math.exp(-r * t); break; }
        if (i === n) {
          const pay = s >= autocallLevel * initial ? 100 + couponPct * periods : s >= protection * initial ? 100 : 100 * s / initial;
          pv = pay * Math.exp(-r * T);
        }
      }
      total += pv;
    }
  }
  return total / (2 * Math.floor(paths / 2));
}

// Amortising bond (ABS, RMBS, CLO): level-pay (annuity) or linear amortisation over the remaining
// periods, with prepayments at a constant CPR. Prices per 100 of CURRENT face. Returns the same
// shape as bondAnalytics plus the weighted average life.
export function amortisingAnalytics({ valuationDate, maturity, couponPct = 0, freq = 12, cpr = 0, cleanPrice, yieldPct, style = 'annuity' }) {
  const f = Math.max(1, Math.round(freq || 12));
  const { dates, prev } = couponSchedule(valuationDate, maturity, f);
  if (!dates.length) return null;
  const c = (couponPct || 0) / 100 / f, smm = 1 - (1 - Math.min(0.99, Math.max(0, cpr / 100))) ** (1 / f);
  const val = parseISODate(valuationDate), prevD = parseISODate(prev), nextD = parseISODate(dates[0]);
  const w = Math.min(1, Math.max(0, ((nextD - val) / DAY_MS) / ((nextD - prevD) / DAY_MS)));
  const accrued = (couponPct || 0) / f * (1 - w);
  let bal = 100, walNum = 0;
  const flows = [];
  for (let i = 0; i < dates.length && bal > 1e-9; i++) {
    const left = dates.length - i, interest = bal * c;
    let sched = style === 'linear' ? bal / left : (c ? bal * c / (1 - (1 + c) ** -left) - interest : bal / left);
    sched = Math.min(bal, sched);
    const prepay = (bal - sched) * (i === dates.length - 1 ? 0 : smm);
    const principal = i === dates.length - 1 ? bal : sched + prepay;
    bal -= principal;
    const t = (i + w) / f;
    walNum += t * principal;
    flows.push({ t, n: i + w, cf: interest + principal });
  }
  const pv = y => { const g = 1 + y / f; let p = 0, dp = 0; for (const fl of flows) { const d = g ** -fl.n; p += fl.cf * d; dp += -fl.n / f * fl.cf * d / g; } return { p, dp }; };
  let y, dirty;
  if (isNum(cleanPrice) && cleanPrice > 0) {
    dirty = cleanPrice + accrued; y = (couponPct || 3) / 100;
    for (let i = 0; i < 80; i++) { const { p, dp } = pv(y); const step = (p - dirty) / dp; if (!isNum(step)) break; y -= step; if (Math.abs(step) < 1e-12) break; }
  } else if (isNum(yieldPct)) { y = yieldPct / 100; dirty = pv(y).p; } else return null;
  const g = 1 + y / f;
  let p = 0, mac = 0, conv = 0;
  for (const fl of flows) { const d = g ** -fl.n; p += fl.cf * d; mac += fl.t * fl.cf * d; conv += fl.cf * d * fl.n * (fl.n + 1) / (f * f); }
  mac /= p;
  return { ytm: y, dirty: p, clean: p - accrued, accrued, macaulay: mac, modDur: mac / g, convexity: conv / (p * g * g), yearsToMaturity: flows[flows.length - 1].t, wal: walNum / 100 };
}
