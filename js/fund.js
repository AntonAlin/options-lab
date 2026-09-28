// Fund-level calculations on top of the analytics: cash-flow and expiry calendar, the regulatory
// risk indicators (UCITS SRRI and PRIIPs SRI) and an indicative NAV per unit with a
// subscription/redemption simulator. Pure functions, covered by tests/core.test.mjs.
import { couponSchedule } from './pricing.js';
import { valuePortfolio, liquidity, compliance } from './analytics.js';
import { isNum, num, freqOf, sum, mean, stdev, parseISODate, toISODate, addMonthsISO, DAY_MS, uid } from './util.js';

// ============================================================================================
//  CASH-FLOW & EXPIRY CALENDAR
// ============================================================================================
// Each event: { date, kind, posId, name, ccy, amount (local), amountBase, cash (true = moves cash),
//               estimate (true = depends on future fixings or exercise) }
export const CF_KINDS = ['coupon', 'redemption', 'fx_settle', 'swap', 'cds_premium', 'option_expiry', 'future_expiry'];

function cdsDates(fromISO, toISO) {
  // Standard CDS coupon dates: 20 March, June, September, December.
  const out = [];
  const from = parseISODate(fromISO), to = parseISODate(toISO);
  if (!from || !to) return out;
  for (let y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
    for (const m of [2, 5, 8, 11]) {
      const d = new Date(Date.UTC(y, m, 20));
      if (d > from && d <= to) out.push(toISODate(d));
    }
  }
  return out;
}

export function cashflows(v, { months = 12 } = {}) {
  const { ctx } = v;
  const start = ctx.valDate, end = addMonthsISO(start, months);
  const inRange = d => d && d > start && d <= end;
  const events = [];
  const push = (x, e) => {
    const fx = ctx.fx(e.ccy);
    events.push({ posId: x.pos.id, name: x.name, type: x.pos.type, estimate: false, cash: true, ...e, amountBase: isNum(fx) ? e.amount * fx : NaN });
  };
  for (const x of v.valid) {
    const p = x.pos, q = num(p.qty);
    switch (p.type) {
      case 'govt_bond': case 'corp_bond': case 'frn': case 'money_market': {
        if (!p.maturity) break;
        const f = freqOf(p.freq, 1);
        if (p.type !== 'money_market' && num(p.coupon) !== 0) {
          for (const d of couponSchedule(start, p.maturity, f).dates) {
            if (inRange(d)) push(x, { date: d, kind: 'coupon', ccy: p.ccy, amount: q * num(p.coupon) / 100 / f, estimate: p.type === 'frn' });
          }
        }
        if (inRange(p.maturity)) push(x, { date: p.maturity, kind: 'redemption', ccy: p.ccy, amount: q });
        break;
      }
      case 'fx_forward':
        if (inRange(p.maturity)) {
          push(x, { date: p.maturity, kind: 'fx_settle', ccy: p.buyCcy, amount: num(p.buyAmount) });
          push(x, { date: p.maturity, kind: 'fx_settle', ccy: p.sellCcy, amount: -num(p.sellAmount) });
        }
        break;
      case 'irs': {
        if (!p.maturity) break;
        const f = freqOf(p.freq, 1);
        const sign = p.direction === 'pay' ? -1 : 1;
        // Net of fixed and the floating leg estimated at today's par rate.
        for (const d of couponSchedule(start, p.maturity, f).dates) {
          if (inRange(d)) push(x, { date: d, kind: 'swap', ccy: p.ccy, amount: sign * q * (num(p.fixedRate) - num(p.marketRate)) / 100 / f, estimate: true });
        }
        break;
      }
      case 'cds': {
        if (!p.maturity) break;
        const sign = p.protection === 'buy' ? -1 : 1; // buyer pays the running spread
        for (const d of cdsDates(start, p.maturity < end ? p.maturity : end)) push(x, { date: d, kind: 'cds_premium', ccy: p.ccy, amount: sign * q * num(p.spread) / 1e4 / 4 });
        break;
      }
      case 'option':
        if (inRange(p.maturity)) {
          // Informational: value if exercised at today's underlying price. Physical settlement moves
          // shares, not cash, so it is not part of the cash totals.
          const S = num(p.underlyingPrice), K = num(p.strike);
          const intrinsic = p.optType === 'put' ? Math.max(K - S, 0) : Math.max(S - K, 0);
          push(x, { date: p.maturity, kind: 'option_expiry', ccy: p.ccy, amount: q * num(p.multiplier, 1) * intrinsic, cash: false, estimate: true, itm: intrinsic > 0 });
        }
        break;
      case 'future':
        if (inRange(p.maturity)) push(x, { date: p.maturity, kind: 'future_expiry', ccy: p.ccy, amount: q * num(p.price) * num(p.multiplier, 1), cash: false, estimate: true });
        break;
      default: break;
    }
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amountBase - a.amountBase));

  // Monthly buckets in base currency (cash events only) and projected cash balance.
  const monthsList = [];
  for (let i = 0; i < months; i++) monthsList.push(addMonthsISO(start, i + 1).slice(0, 7));
  const byMonth = new Map(monthsList.map(m => [m, { month: m, inflow: 0, outflow: 0, byKind: {} }]));
  for (const e of events) {
    if (!e.cash || !isNum(e.amountBase)) continue;
    const b = byMonth.get(e.date.slice(0, 7));
    if (!b) continue;
    if (e.amountBase >= 0) b.inflow += e.amountBase; else b.outflow += e.amountBase;
    b.byKind[e.kind] = (b.byKind[e.kind] || 0) + e.amountBase;
  }
  let running = v.cash;
  const buckets = [...byMonth.values()].map(b => { running += b.inflow + b.outflow; return { ...b, net: b.inflow + b.outflow, cashAfter: running }; });
  const within = days => {
    const lim = toISODate(new Date(parseISODate(start).getTime() + days * DAY_MS));
    return sum(events.filter(e => e.cash && e.date <= lim && isNum(e.amountBase)).map(e => e.amountBase));
  };
  return {
    start, end, events, buckets, cashNow: v.cash,
    next30: within(30), next90: within(90),
    maturing1y: sum(events.filter(e => e.kind === 'redemption' && isNum(e.amountBase)).map(e => e.amountBase)),
    optionExpiries30: events.filter(e => e.kind === 'option_expiry' && e.date <= toISODate(new Date(parseISODate(start).getTime() + 30 * DAY_MS))).length
  };
}

// iCalendar export so the events land in Outlook/Google Calendar.
export function toICS(events, { fundName = 'Portfolio', labels = {} } = {}) {
  const esc = s => String(s).replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nexus Portfolio Lab//Cash-flow calendar//EN', 'CALSCALE:GREGORIAN'];
  events.forEach((e, i) => {
    const d = e.date.replace(/-/g, '');
    const next = toISODate(new Date(parseISODate(e.date).getTime() + DAY_MS)).replace(/-/g, '');
    const amt = isNum(e.amount) ? ` ${e.amount >= 0 ? '+' : ''}${Math.round(e.amount).toLocaleString('en-US')} ${e.ccy}` : '';
    lines.push('BEGIN:VEVENT', `UID:${d}-${i}-${String(e.posId).replace(/[^A-Za-z0-9]/g, '')}@nexus-portfolio-lab`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${esc(`${labels[e.kind] || e.kind}: ${e.name}${amt}`)}`,
      `DESCRIPTION:${esc(`${fundName}${e.estimate ? ' (estimate)' : ''}`)}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ============================================================================================
//  RISK INDICATORS: UCITS SRRI and PRIIPs SRI
// ============================================================================================
export const SRRI_BANDS = [0.005, 0.02, 0.05, 0.10, 0.15, 0.25];          // CESR/10-673, annualised weekly vol
export const MRM_BANDS = [0.005, 0.05, 0.12, 0.20, 0.30, 0.80];           // PRIIPs RTS Annex II, VaR-equivalent vol
const CRM_TABLE = [ // [MRM-1][CRM-1] → SRI (PRIIPs RTS Annex III, point 52)
  [1, 1, 3, 5, 5, 6], [2, 2, 3, 5, 5, 6], [3, 3, 3, 5, 5, 6], [4, 4, 4, 5, 5, 6], [5, 5, 5, 5, 5, 6], [6, 6, 6, 6, 6, 6], [7, 7, 7, 7, 7, 7]
];
export const bandOf = (x, bands) => 1 + bands.filter(b => x >= b).length;

// Levels from a return series (portfolio back-cast) or straight from a price series.
function levelsFrom(dates, { returns = null, prices = null }) {
  const out = [];
  if (prices) { dates.forEach((d, i) => { if (isNum(prices[i]) && prices[i] > 0) out.push([d, prices[i]]); }); return out; }
  let lvl = 1;
  dates.forEach((d, i) => { if (i > 0 && isNum(returns[i])) lvl *= 1 + returns[i]; if (i === 0 || isNum(returns[i])) out.push([d, lvl]); });
  return out;
}
// Last level of each ISO week.
function weekly(levels) {
  const m = new Map();
  for (const [d, x] of levels) {
    const dt = parseISODate(d);
    const th = new Date(dt.getTime() + (3 - ((dt.getUTCDay() + 6) % 7)) * DAY_MS); // Thursday of the ISO week
    m.set(`${th.getUTCFullYear()}-${Math.floor((th - Date.UTC(th.getUTCFullYear(), 0, 1)) / (7 * DAY_MS))}`, [d, x]);
  }
  return [...m.values()];
}

// input: { dates, returns } or { dates, prices }. Returns both indicators plus the inputs used.
export function riskIndicators(input, { rhpYears = 5, crm = 1 } = {}) {
  const levels = levelsFrom(input.dates, input);
  if (levels.length < 30) return null;
  const yearsAvail = (parseISODate(levels[levels.length - 1][0]) - parseISODate(levels[0][0])) / DAY_MS / 365.25;

  // SRRI: weekly returns over (up to) the last 5 years, annualised with √52.
  const wk = weekly(levels).slice(-261);
  const wr = wk.slice(1).map(([, x], i) => x / wk[i][1] - 1);
  const srriVol = stdev(wr) * Math.sqrt(52);
  const srri = bandOf(srriVol, SRRI_BANDS);

  // PRIIPs category 2: daily log returns over (up to) 5 years, Cornish-Fisher VaR 97.5 % at the
  // recommended holding period, converted to a VaR-equivalent volatility.
  const lv = levels.slice(-1281);
  const lr = lv.slice(1).map(([, x], i) => Math.log(x / lv[i][1]));
  const m = mean(lr), sd = stdev(lr, 0);
  const skew = sum(lr.map(r => ((r - m) / sd) ** 3)) / lr.length;
  const kurt = sum(lr.map(r => ((r - m) / sd) ** 4)) / lr.length - 3;
  const N = 256 * rhpYears;
  const varRet = sd * Math.sqrt(N) * (-1.96 + 0.474 * skew / Math.sqrt(N) - 0.0687 * kurt / N + 0.146 * skew * skew / N) - 0.5 * sd * sd * N;
  const vev = (Math.sqrt(Math.max(0, 3.842 - 2 * varRet)) - 1.96) / Math.sqrt(rhpYears);
  const mrm = bandOf(vev, MRM_BANDS);
  const c = Math.min(6, Math.max(1, Math.round(crm || 1)));
  const sri = CRM_TABLE[mrm - 1][c - 1];

  // Rolling 52-week volatility of weekly returns, for the chart.
  const allWk = weekly(levels);
  const allWr = allWk.slice(1).map(([, x], i) => x / allWk[i][1] - 1);
  const rolling = allWk.slice(1).map(([d], i) => [d, i >= 51 ? stdev(allWr.slice(i - 51, i + 1)) * Math.sqrt(52) : null]);

  return {
    srri, srriVol, weeks: wr.length, srriFull: wr.length >= 259,
    sri, mrm, crm: c, vev, varReturn: varRet, skew, kurt, dailyObs: lr.length, sriEnough: lr.length >= 2 * 250, rhpYears,
    yearsAvail, rolling, from: levels[0][0], to: levels[levels.length - 1][0]
  };
}

// ============================================================================================
//  INDICATIVE NAV PER UNIT & FLOWS
// ============================================================================================
// cfg (stored on the portfolio as p.fund):
//   { classes: [{ id, name, ccy, units, lastNav, lastNavDate, feePct }], liabilities, receivables, feeFrom }
export function defaultFund() { return { classes: [], liabilities: 0, receivables: 0, feeFrom: '' }; }

export function navPerUnit(v, cfg) {
  const f = { ...defaultFund(), ...(cfg || {}) };
  const classes = (f.classes || []).filter(c => num(c.units) > 0);
  if (!classes.length) return { ok: false, reason: 'no_classes' };
  const fx = c => v.ctx.fx(c.ccy || v.ctx.base);
  if (classes.some(c => !isNum(fx(c)))) return { ok: false, reason: 'fx_missing' };
  if (classes.length > 1 && classes.some(c => !(num(c.lastNav) > 0))) return { ok: false, reason: 'need_last_nav' };
  const gross = v.nav;
  const netBeforeFees = gross - num(f.liabilities) + num(f.receivables);
  const valDate = v.ctx.valDate;
  const feeDays = f.feeFrom ? Math.max(0, (parseISODate(valDate) - parseISODate(f.feeFrom)) / DAY_MS) : 0;
  // Split net assets by each class's capital at its last official NAV. One class takes it all.
  const caps = classes.map(c => (classes.length === 1 ? 1 : num(c.units) * num(c.lastNav) * fx(c)));
  const capSum = sum(caps);
  const rows = classes.map((c, i) => {
    const share = caps[i] / capSum;
    const assets = share * netBeforeFees;
    const fee = num(c.feePct) / 100 * assets * feeDays / 365;
    const net = assets - fee;
    const nav = net / fx(c) / num(c.units);
    return {
      ...c, share, assetsBase: assets, accruedFee: fee, netBase: net, navPerUnit: nav,
      feePerDay: num(c.feePct) / 100 * assets / 365,
      vsLast: num(c.lastNav) > 0 ? nav / num(c.lastNav) - 1 : null
    };
  });
  return { ok: true, gross, netBeforeFees, liabilities: num(f.liabilities), receivables: num(f.receivables), feeDays, accruedFees: sum(rows.map(r => r.accruedFee)), net: sum(rows.map(r => r.netBase)), classes: rows };
}

// Subscription (+) or redemption (−) of `amountBase` into one class, settled in base-currency cash.
// Re-runs liquidity and compliance on the portfolio after the flow.
export function simulateFlow(p, nav, classId, amountBase) {
  const cls = nav.classes.find(c => c.id === classId) || nav.classes[0];
  const v0 = valuePortfolio(p);
  const p2 = { ...p, positions: [...p.positions, { id: uid('flow'), type: 'cash', name: 'Flow', qty: amountBase, ccy: p.baseCcy, issuer: 'Flow' }] };
  const v1 = valuePortfolio(p2);
  const liq0 = liquidity(v0), liq1 = liquidity(v1);
  const c0 = compliance(v0, liq0), c1 = compliance(v1, liq1);
  const fx = v0.ctx.fx(cls.ccy || p.baseCcy);
  const unitsDelta = amountBase / (cls.navPerUnit * fx);
  const newlyBroken = c1.rules.filter(r => r.status === 'breach' && c0.rules.find(o => o.id === r.id)?.status !== 'breach');
  const liquid1d = liq0.buckets.find(b => b.h === 1)?.value || 0;
  return {
    amountBase, unitsDelta, unitsAfter: num(cls.units) + unitsDelta, navAfter: v1.nav,
    cashBefore: v0.cash, cashAfter: v1.cash, cashPctAfter: v1.nav ? v1.cash / v1.nav : 0,
    overdraft: v1.cash < 0, coveredByCash: amountBase >= 0 || v0.cash + amountBase >= 0,
    coveredByLiquid1d: amountBase >= 0 || liquid1d + amountBase >= 0, liquid1d,
    rulesBefore: c0, rulesAfter: c1, newlyBroken
  };
}

// Everything the fund pages need, computed once per analysis.
export function fundAnalysis(p, a) {
  const src = p.risk?.sriSource || '';
  const h = p.history || { dates: [], series: {} };
  let ri = null;
  if (src && h.series?.[src]) ri = riskIndicators({ dates: h.dates, prices: h.series[src] }, { rhpYears: num(p.risk?.rhp, 5), crm: num(p.risk?.crm, 1) });
  else if (a.risk.hp) ri = riskIndicators({ dates: a.risk.hp.dates, returns: a.risk.hp.portfolioRet }, { rhpYears: num(p.risk?.rhp, 5), crm: num(p.risk?.crm, 1) });
  return { cf: cashflows(a.v, { months: num(p.risk?.cfMonths, 12) }), ri, nav: navPerUnit(a.v, p.fund) };
}
