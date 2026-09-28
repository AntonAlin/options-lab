// Demo workspace: a fictional Nordic balanced fund with one of every instrument type and three
// years of synthetic (seeded, so identical on every load) price history. Prices are illustrative,
// not market data.
import { newPortfolio } from './store.js';
import { bondAnalytics } from './pricing.js';
import { mulberry32, gaussian, parseISODate, toISODate, uid, DAY_MS, addMonthsISO } from './util.js';

const FX_EUR = { EUR: 1, SEK: 11.2, NOK: 11.6, DKK: 7.46, USD: 1.12, GBP: 0.85, CHF: 0.94, JPY: 165, CAD: 1.55, AUD: 1.7, PLN: 4.3, CNY: 8.1, HKD: 8.75, SGD: 1.48, NZD: 1.85, ISK: 150 };
const toSek = ccy => FX_EUR.SEK / FX_EUR[ccy];

// value = target market value in SEK; qty is solved from it so weights come out sensible.
function eq(name, ticker, isin, price, ccy, sector, country, value, beta, adv) {
  return { type: 'equity', name, ticker, isin, issuer: name.replace(/\s+[AB]$/, ''), price, ccy, sector, country, beta, adv, _value: value };
}

export function buildDemo(valDate) {
  const plus = m => addMonthsISO(valDate, m);
  const raw = [
    eq('Investor B', 'INVE B', 'SE0015811963', 291.4, 'SEK', 'Financials', 'SE', 62e6, 1.05, 3.1e6),
    eq('Atlas Copco A', 'ATCO A', 'SE0017486889', 172.5, 'SEK', 'Industrials', 'SE', 55e6, 1.15, 5.2e6),
    eq('Volvo B', 'VOLV B', 'SE0000115446', 262.0, 'SEK', 'Industrials', 'SE', 48e6, 1.2, 3.6e6),
    eq('Ericsson B', 'ERIC B', 'SE0000108656', 79.8, 'SEK', 'Information Technology', 'SE', 30e6, 0.95, 12e6),
    eq('ASSA ABLOY B', 'ASSA B', 'SE0007100581', 331.2, 'SEK', 'Industrials', 'SE', 44e6, 0.95, 1.9e6),
    eq('Hexagon B', 'HEXA B', 'SE0015961909', 114.6, 'SEK', 'Information Technology', 'SE', 26e6, 1.25, 4.1e6),
    eq('Sandvik', 'SAND', 'SE0000667891', 214.9, 'SEK', 'Industrials', 'SE', 32e6, 1.2, 2.8e6),
    eq('SEB A', 'SEB A', 'SE0000148884', 176.3, 'SEK', 'Financials', 'SE', 40e6, 1.1, 3.9e6),
    eq('Swedbank A', 'SWED A', 'SE0000242455', 241.7, 'SEK', 'Financials', 'SE', 36e6, 1.1, 3.2e6),
    eq('Essity B', 'ESSITY B', 'SE0009922164', 279.5, 'SEK', 'Consumer Staples', 'SE', 22e6, 0.6, 1.4e6),
    eq('Evolution', 'EVO', 'SE0012673267', 905.0, 'SEK', 'Consumer Discretionary', 'SE', 18e6, 1.0, 0.45e6),
    eq('Novo Nordisk B', 'NOVO B', 'DK0062498333', 452.0, 'DKK', 'Health Care', 'DK', 38e6, 0.8, 5.5e6),
    eq('Equinor', 'EQNR', 'NO0010096985', 262.0, 'NOK', 'Energy', 'NO', 20e6, 0.9, 7e6),
    eq('Nokia', 'NOKIA', 'FI0009000681', 4.52, 'EUR', 'Information Technology', 'FI', 12e6, 0.9, 30e6),
    eq('Microsoft', 'MSFT', 'US5949181045', 482.0, 'USD', 'Information Technology', 'US', 46e6, 1.05, 21e6),
    eq('Apple', 'AAPL', 'US0378331005', 231.0, 'USD', 'Information Technology', 'US', 34e6, 1.1, 55e6),
    eq('NVIDIA', 'NVDA', 'US67066G1040', 171.0, 'USD', 'Information Technology', 'US', 30e6, 1.7, 190e6),
    eq('ASML', 'ASML', 'NL0010273215', 702.0, 'EUR', 'Information Technology', 'NL', 24e6, 1.3, 1.1e6),
    eq('Nestlé', 'NESN', 'CH0038863350', 84.6, 'CHF', 'Consumer Staples', 'CH', 18e6, 0.55, 5e6),
    { type: 'etf', name: 'iShares Core MSCI EM IMI', ticker: 'EIMI', isin: 'IE00BKM4GZ66', price: 38.2, ccy: 'USD', subClass: 'equity', beta: 1.0, country: 'IE', adv: 900000, _value: 45e6 },
    { type: 'fund', name: 'Nordic High Yield Fund A', ticker: 'NHYF', isin: '', issuer: 'Demo Fund Management', price: 131.4, ccy: 'SEK', subClass: 'fixed_income', duration: 1.1, beta: 0.25, liquidityDays: 3, country: 'SE', _value: 40e6 },
    { type: 'govt_bond', name: 'Sweden 0.75% 2029', ticker: 'SGB 29', issuer: 'Kingdom of Sweden', price: 95.9, ccy: 'SEK', coupon: 0.75, freq: '1', maturity: plus(32), rating: 'AAA', country: 'SE', _value: 70e6 },
    { type: 'govt_bond', name: 'Sweden 2.25% 2032', ticker: 'SGB 32', issuer: 'Kingdom of Sweden', price: 100.8, ccy: 'SEK', coupon: 2.25, freq: '1', maturity: plus(68), rating: 'AAA', country: 'SE', _value: 55e6 },
    { type: 'govt_bond', name: 'US Treasury 4.125% 2031', ticker: 'T 4.125 31', issuer: 'US Treasury', price: 101.3, ccy: 'USD', coupon: 4.125, freq: '2', maturity: plus(62), rating: 'AA+', country: 'US', _value: 30e6 },
    { type: 'govt_bond', name: 'Germany 2.50% 2035', ticker: 'DBR 35', issuer: 'Federal Republic of Germany', price: 98.1, ccy: 'EUR', coupon: 2.5, freq: '1', maturity: plus(104), rating: 'AAA', country: 'DE', _value: 35e6 },
    { type: 'corp_bond', name: 'Volvo Treasury 3.625% 2029', ticker: 'VOLVO 29', issuer: 'Volvo', price: 101.4, ccy: 'EUR', coupon: 3.625, freq: '1', maturity: plus(36), rating: 'A', sector: 'Industrials', country: 'SE', adv: 2e6, _value: 28e6 },
    { type: 'corp_bond', name: 'Stadshypotek 1.50% 2028 (covered)', ticker: 'STADS 28', issuer: 'Stadshypotek', price: 97.7, ccy: 'SEK', coupon: 1.5, freq: '1', maturity: plus(22), rating: 'AAA', sector: 'Financials', country: 'SE', _value: 45e6 },
    { type: 'corp_bond', name: 'Vattenfall 2.875% 2033', ticker: 'VATT 33', issuer: 'Vattenfall', price: 97.2, ccy: 'SEK', coupon: 2.875, freq: '1', maturity: plus(80), rating: 'BBB+', sector: 'Utilities', country: 'SE', _value: 22e6 },
    { type: 'corp_bond', name: 'Ørsted 3.25% 2031', ticker: 'ORSTED 31', issuer: 'Ørsted', price: 99.4, ccy: 'EUR', coupon: 3.25, freq: '1', maturity: plus(58), rating: 'BBB+', sector: 'Utilities', country: 'DK', adv: 1.5e6, _value: 18e6 },
    { type: 'frn', name: 'Castellum FRN 2028', ticker: 'CAST FRN 28', issuer: 'Castellum', price: 100.6, ccy: 'SEK', coupon: 4.05, spread: 185, freq: '4', maturity: plus(19), rating: 'BBB-', sector: 'Real Estate', country: 'SE', _value: 24e6 },
    { type: 'frn', name: 'Heimstaden Bostad FRN 2027', ticker: 'HEIM FRN 27', issuer: 'Heimstaden Bostad', price: 98.9, ccy: 'SEK', coupon: 5.3, spread: 310, freq: '4', maturity: plus(14), rating: 'BB+', sector: 'Real Estate', country: 'SE', _value: 16e6 },
    { type: 'frn', name: 'SBAB FRN 2029', ticker: 'SBAB FRN 29', issuer: 'SBAB', price: 100.3, ccy: 'SEK', coupon: 3.1, spread: 90, freq: '4', maturity: plus(40), rating: 'A', sector: 'Financials', country: 'SE', _value: 26e6 },
    { type: 'money_market', name: 'Swedish T-bill', ticker: 'SSVX', issuer: 'Riksgälden', yield: 1.95, ccy: 'SEK', maturity: plus(3), rating: 'AAA', country: 'SE', _value: 40e6 },
    { type: 'money_market', name: 'Nordea commercial paper', ticker: 'NDA CP', issuer: 'Nordea Bank', yield: 2.2, ccy: 'SEK', maturity: plus(2), rating: 'A+', country: 'FI', _value: 25e6 },
    { type: 'cash', name: 'Custody account SEK', issuer: 'SEB', qty: 38e6, ccy: 'SEK' },
    { type: 'cash', name: 'Custody account NOK', issuer: 'SEB', qty: 4.5e6, ccy: 'NOK' },
    { type: 'cash', name: 'Custody account USD', issuer: 'SEB', qty: 1.2e6, ccy: 'USD' },
    { type: 'cash', name: 'Margin account EUR', issuer: 'Nordea', qty: 0.9e6, ccy: 'EUR' },
    { type: 'future', name: 'OMXS30 Index Future', ticker: 'OMXS30F', qty: -120, price: 2655, multiplier: 100, ccy: 'SEK', underlyingClass: 'equity', maturity: plus(3), beta: 1, mtm: 0, reportedNotional: 31860000 },
    { type: 'future', name: 'US 10y T-Note Future', ticker: 'TY', qty: -35, price: 111.2, multiplier: 1000, ccy: 'USD', underlyingClass: 'rates', maturity: plus(3), duration: 6.3, mtm: 0 },
    { type: 'future', name: 'Euro-Bund Future', ticker: 'RX', qty: 25, price: 128.4, multiplier: 1000, ccy: 'EUR', underlyingClass: 'rates', maturity: plus(3), duration: 8.6, mtm: 0, reportedNotional: 3210000 },
    { type: 'future', name: 'Brent Crude Future', ticker: 'CO', qty: 30, price: 67.8, multiplier: 1000, ccy: 'USD', underlyingClass: 'commodity', maturity: plus(2), mtm: 0 },
    { type: 'option', name: 'OMXS30 Put 2400', ticker: 'OMXS30P2400', qty: 250, optType: 'put', strike: 2400, maturity: plus(3), underlyingPrice: 2655, vol: 21, multiplier: 100, ccy: 'SEK', underlyingClass: 'equity', rate: 2, reportedDelta: -0.152 },
    { type: 'option', name: 'Volvo B Call 270', ticker: 'VOLVB 270C', issuer: 'Volvo', qty: 400, optType: 'call', strike: 270, maturity: plus(2), underlyingPrice: 262.0, vol: 26, multiplier: 100, ccy: 'SEK', underlyingClass: 'equity', rate: 2, divYield: 2.8, sector: 'Industrials', country: 'SE', reportedDelta: 0.52 },
    // USD put / SEK call: the right to sell USD at 9.60, protecting the unhedged part of the USD book.
    { type: 'option', name: 'USD put / SEK call 9.60', ticker: 'USDSEK P9.60', issuer: 'SEB', qty: 40, optType: 'put', strike: 9.6, maturity: plus(4), underlyingPrice: 10.0, vol: 9, multiplier: 100000, ccy: 'SEK', underlyingClass: 'fx', buyCcy: 'USD', rate: 2, divYield: 4.0 },
    { type: 'fx_forward', name: 'Sell USD / buy SEK', buyCcy: 'SEK', buyAmount: 118.2e6, sellCcy: 'USD', sellAmount: 11.8e6, maturity: plus(3), issuer: 'Nordea' },
    { type: 'fx_forward', name: 'Sell EUR / buy SEK', buyCcy: 'SEK', buyAmount: 78.6e6, sellCcy: 'EUR', sellAmount: 7e6, maturity: plus(3), issuer: 'SEB' },
    { type: 'irs', name: 'SEK 7y payer swap', qty: 60e6, ccy: 'SEK', direction: 'pay', fixedRate: 2.3, marketRate: 2.42, freq: '1', maturity: plus(84), issuer: 'LCH' },
    { type: 'irs', name: 'EUR 5y receiver swap', qty: 4e6, ccy: 'EUR', direction: 'receive', fixedRate: 2.55, marketRate: 2.35, freq: '1', maturity: plus(60), issuer: 'LCH' },
    { type: 'cds', name: 'Volvo 5y CDS (sold protection)', issuer: 'Volvo', qty: 2e6, ccy: 'EUR', protection: 'sell', spread: 100, marketSpread: 85, maturity: plus(60), rating: 'A', sector: 'Industrials', country: 'SE' },
    { type: 'cds', name: 'iTraxx Crossover 5y', issuer: 'iTraxx Europe Crossover', qty: 4e6, ccy: 'EUR', protection: 'buy', spread: 500, marketSpread: 285, maturity: plus(60), rating: 'BB-', sector: 'Index' },
    { type: 'commodity', name: 'Physical Gold ETC', ticker: 'PHAU', isin: 'JE00B1VS3770', issuer: 'WisdomTree', price: 262.0, ccy: 'USD', sector: 'Precious metals', adv: 250000, _value: 25e6 },
    { type: 'alternative', name: 'Nordic Buyout Fund IV', ticker: 'NBF IV', issuer: 'Demo Capital', altType: 'private_equity', qty: 1, price: 30e6, ccy: 'SEK', liquidityDays: 365, country: 'SE', _value: null },
    { type: 'alternative', name: 'Nordic Macro Hedge Fund', ticker: 'NMHF', issuer: 'Demo Alternatives', altType: 'hedge_fund', qty: 1, price: 22e6, ccy: 'SEK', liquidityDays: 30, beta: 0.3, country: 'SE', _value: null },
    { type: 'alternative', name: 'Nordic Logistics Property Fund', ticker: 'NLPF', issuer: 'Demo Real Estate', altType: 'real_estate', qty: 1, price: 18e6, ccy: 'SEK', liquidityDays: 90, country: 'SE', _value: null }
  ];

  const positions = raw.map(r => {
    const p = { id: uid(), ...r };
    if (r._value) {
      if (r.type === 'money_market') {
        const a = bondAnalytics({ valuationDate: valDate, maturity: r.maturity, couponPct: 0, freq: 1, yieldPct: r.yield });
        p.qty = Math.round(r._value / (a.dirty / 100) / 1e5) * 1e5;
      } else if (['govt_bond', 'corp_bond', 'frn'].includes(r.type)) {
        p.qty = Math.round(r._value / (r.price / 100) / toSek(r.ccy) / 1e5) * 1e5;
      } else {
        p.qty = Math.round(r._value / r.price / toSek(r.ccy));
      }
    }
    delete p._value;
    return p;
  });

  // Cost basis: most holdings bought below today's price, a few above; three positions carry a
  // transaction history that reconstructs the holding (so the book and the custodian agree).
  const crng = mulberry32(7);
  const txs = [];
  for (const p of positions) {
    if (!['equity', 'etf', 'fund', 'commodity', 'alternative', 'govt_bond', 'corp_bond', 'frn', 'money_market', 'option'].includes(p.type)) continue;
    const ret = -0.08 + 0.42 * crng(); // −8 % … +34 % since purchase
    if (!(p.price > 0)) continue; // bills on yield and options without a premium stay without cost
    p.costPrice = Math.round(p.price / (1 + ret) * 100) / 100;
    if (['NVDA', 'ERIC B', 'VOLVO 29'].includes(p.ticker)) {
      const unitTxs = p.ticker === 'VOLVO 29'
        ? [[plus(-20), 'buy', p.qty, 99.1, 0], [plus(-7), 'buy', 5e6, 100.6, 0], [plus(-3), 'sell', 5e6, 101.9, 0]]
        : [[plus(-18), 'buy', Math.round(p.qty * 0.8), p.costPrice * 0.92, 450], [plus(-9), 'buy', Math.round(p.qty * 0.45), p.costPrice * 1.05, 380], [plus(-4), 'sell', Math.round(p.qty * 0.8) + Math.round(p.qty * 0.45) - p.qty, p.price * 0.96, 410]];
      unitTxs.forEach(([date, side, qty, price, fees]) => txs.push({ id: uid('tx'), posId: p.id, date, side, qty, price: Math.round(price * 100) / 100, fees, fx: p.ccy === 'USD' ? 10.6 : undefined }));
      delete p.costPrice;
    }
  }

  const pf = newPortfolio({
    name: 'Demo: Nordic Balanced Fund', baseCcy: 'SEK', valDate: '', manager: 'Demo Fund Management AB', fundType: 'UCITS',
    positions, fxEur: FX_EUR, fxSource: 'demo', demo: true
  });
  pf.transactions = txs;
  pf.history = syntheticHistory(positions, valDate);
  pf.benchmark = 'Benchmark 60/40';
  return pf;
}

// Business days back from the valuation date; prices are walked backwards from today's price so
// the last observation equals the holding's price.
function syntheticHistory(positions, valDate, years = 3) {
  const rng = mulberry32(20260928);
  const end = parseISODate(valDate);
  const dates = [];
  for (let d = new Date(end); dates.length < Math.round(years * 252); d = new Date(d - DAY_MS)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) dates.unshift(toISODate(d));
  }
  const n = dates.length, dt = 1 / 252;
  // Factor shocks: equity market (with occasional stress clusters), rates (bp), credit (bp), FX, gold.
  const F = { eq: [], ir: [], cs: [], usd: [], eur: [], nok: [], dkk: [], chf: [], gold: [], em: [], oil: [] };
  let regime = 1;
  for (let t = 0; t < n; t++) {
    // Calm most of the time, with short high-volatility spells (~6 weeks, a few times a decade).
    if (regime === 1 ? rng() < 0.004 : rng() < 0.03) regime = regime > 1 ? 1 : 1.9;
    const zEq = gaussian(rng);
    const eqVol = 0.14 * regime;
    F.eq.push(0.07 * dt + eqVol * Math.sqrt(dt) * zEq);
    F.ir.push(0.85 * Math.sqrt(dt) * 100 * (0.25 * zEq + 0.97 * gaussian(rng)));
    F.cs.push(0.6 * regime * Math.sqrt(dt) * 100 * (-0.6 * zEq + 0.8 * gaussian(rng)));
    const zFx = gaussian(rng);
    F.usd.push(0.09 * Math.sqrt(dt) * (-0.3 * zEq + 0.95 * zFx));
    F.eur.push(0.06 * Math.sqrt(dt) * (-0.3 * zEq + 0.5 * zFx + 0.81 * gaussian(rng)));
    F.nok.push(0.08 * Math.sqrt(dt) * (0.2 * zEq + 0.98 * gaussian(rng)));
    F.dkk.push(F.eur[t] + 0.002 * Math.sqrt(dt) * gaussian(rng));
    F.chf.push(0.07 * Math.sqrt(dt) * (-0.4 * zEq + 0.3 * zFx + 0.86 * gaussian(rng)));
    F.gold.push(0.05 * dt + 0.15 * Math.sqrt(dt) * (0.1 * zEq + 0.99 * gaussian(rng)));
    F.em.push(0.05 * dt + 0.2 * regime * Math.sqrt(dt) * (0.75 * zEq + 0.66 * gaussian(rng)));
    F.oil.push(0.02 * dt + 0.32 * Math.sqrt(dt) * (0.3 * zEq + 0.95 * gaussian(rng)));
  }
  const walkBack = (last, rets) => {
    const out = new Array(n);
    out[n - 1] = last;
    for (let t = n - 1; t > 0; t--) out[t - 1] = out[t] / (1 + rets[t]);
    return out.map(x => Math.round(x * 10000) / 10000);
  };
  const series = {};
  for (const p of positions) {
    const key = p.ticker;
    if (!key || ['cash', 'fx_forward', 'irs', 'cds', 'option'].includes(p.type)) continue;
    const isBond = ['govt_bond', 'corp_bond', 'frn', 'money_market'].includes(p.type);
    let rets;
    if (['equity'].includes(p.type)) {
      const spec = 0.22;
      rets = F.eq.map(e => (p.beta ?? 1) * e + spec * Math.sqrt(dt) * gaussian(rng));
    } else if (p.type === 'etf') rets = F.em;
    else if (p.type === 'fund') rets = F.cs.map((c, t) => 0.05 * dt - (c * 2.5 + F.ir[t] * 1.1) / 1e4);
    else if (p.type === 'commodity') rets = F.gold;
    else if (p.type === 'alternative') {
      // Appraisal-based NAVs move monthly; a hedge fund NAV is monthly too but far less equity-like.
      let acc = 0;
      const b = p.altType === 'hedge_fund' ? 0.25 : 0.5, drift = p.altType === 'hedge_fund' ? 0.00025 : 0.0003, spec = p.altType === 'hedge_fund' ? 0.06 : 0;
      rets = F.eq.map((e, t) => { acc += b * e + drift + spec * Math.sqrt(dt) * gaussian(rng); if (t % 21 === 0) { const r = acc; acc = 0; return r; } return 0; });
    } else if (p.type === 'future') {
      rets = p.underlyingClass === 'rates' ? F.ir.map(x => -x * (p.duration || 6) / 1e4) : p.underlyingClass === 'commodity' ? F.oil : F.eq;
    } else if (isBond) {
      const years = Math.max(0.1, (parseISODate(p.maturity) - parseISODate(valDate)) / DAY_MS / 365.25);
      const dur = p.type === 'frn' ? 0.25 : p.type === 'money_market' ? years : years * 0.9;
      const sdur = p.type === 'govt_bond' || p.type === 'money_market' ? 0 : years * 0.9;
      const carry = ((p.coupon ?? p.yield ?? 2) / 100) * dt;
      rets = F.ir.map((ir, t) => carry - (dur * ir + sdur * F.cs[t] * (p.rating && p.rating.startsWith('BB') ? 1.6 : 0.6)) / 1e4);
    } else continue;
    series[key] = walkBack(p.type === 'money_market' ? 100 : p.price, rets);
  }
  // FX in base-currency terms (SEK per unit): the analytics look these up as CCY+BASE.
  series.USDSEK = walkBack(toSek('USD'), F.usd);
  series.EURSEK = walkBack(toSek('EUR'), F.eur);
  series.NOKSEK = walkBack(toSek('NOK'), F.nok);
  series.DKKSEK = walkBack(toSek('DKK'), F.dkk);
  series.CHFSEK = walkBack(toSek('CHF'), F.chf);
  series.OMXS30 = walkBack(2655, F.eq);
  const bond = F.ir.map((ir, t) => 0.025 * dt - (4.5 * ir) / 1e4);
  series['Benchmark 60/40'] = walkBack(100, F.eq.map((e, t) => 0.6 * (0.6 * e + 0.4 * (e + F.usd[t])) + 0.4 * bond[t]));
  return { dates, series };
}
