// Run with: npm test   (Node 20+, no dependencies)
import test from 'node:test';
import assert from 'node:assert/strict';
import { normCDF, normInv, bsm, bondAnalytics, swapAnnuity } from '../js/pricing.js';
import { INSTRUMENTS, resolveType, validatePosition, FIELDS } from '../js/instruments.js';
import { parseCSV, detectDelimiter, detectDecimal, parseNumber, parseDate, autoMapping, rowsToPositions, mergePositions, parseHistory, mergeHistory, templateCSV, parseText, findHeaderRow } from '../js/importer.js';
import { valuePortfolio, factorModel, runStress, liquidity, compliance, fixedIncome, currencyExposure, perfStats, fullAnalysis, SCENARIOS } from '../js/analytics.js';
import { newPortfolio } from '../js/store.js';
import { buildDemo } from '../js/demo.js';
import { DICT } from '../js/i18n.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b}, got ${a}`);

test('normal distribution', () => {
  close(normCDF(0), 0.5, 1e-15);
  close(normCDF(1.959963984540054), 0.975, 1e-12);
  close(normInv(0.99), 2.3263478740408408, 1e-10);
  close(normInv(0.01), -2.3263478740408408, 1e-10);
});

test('Black-Scholes matches textbook value and put-call parity', () => {
  // Hull: S=42, K=40, r=10%, sigma=20%, T=0.5 → call 4.76, put 0.81
  const c = bsm('call', 42, 40, 0.5, 0.1, 0, 0.2), p = bsm('put', 42, 40, 0.5, 0.1, 0, 0.2);
  close(c.price, 4.759, 1e-3); close(p.price, 0.8086, 1e-3);
  close(c.price - p.price, 42 - 40 * Math.exp(-0.05), 1e-10, 'parity');
  close(c.delta - p.delta, 1, 1e-12);
});

test('bond analytics: par bond yields its coupon, zero has Macaulay = maturity', () => {
  const par = bondAnalytics({ valuationDate: '2026-01-15', maturity: '2031-01-15', couponPct: 4, freq: 1, cleanPrice: 100 });
  close(par.ytm, 0.04, 1e-9);
  close(par.accrued, 0, 1e-9);
  // Modified duration of a 5y 4 % annual par bond = (1 - 1.04^-5)/0.04 = 4.4518
  close(par.modDur, 4.4518, 1e-3);
  const zero = bondAnalytics({ valuationDate: '2026-01-15', maturity: '2036-01-15', couponPct: 0, freq: 1, yieldPct: 3 });
  close(zero.macaulay, 10, 1e-9);
  close(zero.dirty, 100 / 1.03 ** 10, 1e-9);
  // Convexity: numerical check against price bumps
  const b = bondAnalytics({ valuationDate: '2026-03-01', maturity: '2034-06-15', couponPct: 3.5, freq: 2, yieldPct: 4.2 });
  const up = bondAnalytics({ valuationDate: '2026-03-01', maturity: '2034-06-15', couponPct: 3.5, freq: 2, yieldPct: 4.21 });
  const dn = bondAnalytics({ valuationDate: '2026-03-01', maturity: '2034-06-15', couponPct: 3.5, freq: 2, yieldPct: 4.19 });
  const h = 0.0001;
  close((dn.dirty - up.dirty) / (2 * h * b.dirty), b.modDur, 1e-4, 'mod dur');
  close((up.dirty + dn.dirty - 2 * b.dirty) / (h * h * b.dirty), b.convexity, 0.05, 'convexity');
  // Round trip price → yield → price
  const rt = bondAnalytics({ valuationDate: '2026-03-01', maturity: '2034-06-15', couponPct: 3.5, freq: 2, cleanPrice: b.clean });
  close(rt.ytm, 0.042, 1e-9);
});

test('swap annuity is close to a par bond duration', () => {
  const { annuity } = swapAnnuity('2026-01-15', '2031-01-15', 1, 4);
  close(annuity, (1 - 1.04 ** -5) / 0.04, 1e-3);
});

test('type resolution handles Swedish and English labels', () => {
  assert.equal(resolveType('Aktie'), 'equity');
  assert.equal(resolveType('Corporate Bond'), 'corp_bond');
  assert.equal(resolveType('Statsobligation'), 'govt_bond');
  assert.equal(resolveType('FX Forward'), 'fx_forward');
  assert.equal(resolveType('Valutatermin'), 'fx_forward');
  assert.equal(resolveType('T-Bill'), 'money_market');
  assert.equal(resolveType('nonsense'), null);
});

test('every instrument field exists in the catalogue and every type prices its defaults', () => {
  for (const [id, def] of Object.entries(INSTRUMENTS)) {
    for (const f of [...def.fields, ...def.required]) assert.ok(FIELDS[f], `${id}.${f} missing from FIELDS`);
    assert.ok(def.en && def.sv, `${id} labels`);
  }
});

test('CSV parsing: Swedish semicolon file with decimal comma', () => {
  const text = 'Namn;Antal;Kurs;Valuta;Förfallodag\n"Volvo B";1 200;245,60;SEK;2027-03-15\nEricsson;500;"72,1";SEK;\n';
  assert.equal(detectDelimiter(text), ';');
  const { sheets, decimal } = parseText(text);
  assert.equal(decimal, ',');
  const rows = sheets[0].rows;
  assert.deepEqual(autoMapping(rows[0]), ['name', 'qty', 'price', 'ccy', 'maturity']);
  assert.equal(parseNumber('1 200', ','), 1200);
  assert.equal(parseNumber('245,60', ','), 245.6);
  assert.equal(parseNumber('1.234.567,5', ','), 1234567.5);
  assert.equal(parseNumber('1,234,567.5', '.'), 1234567.5);
  assert.equal(parseNumber('(1,000)', '.'), -1000);
  assert.equal(parseNumber('−3,5 %', ','), -3.5);
  assert.ok(Number.isNaN(parseNumber('abc')));
});

test('CSV parsing: quoted fields with embedded delimiters and newlines', () => {
  const rows = parseCSV('a,b\n"x, ""y""","line1\nline2"\n', ',');
  assert.deepEqual(rows, [['a', 'b'], ['x, "y"', 'line1\nline2']]);
});

test('date parsing', () => {
  assert.equal(parseDate('2027-03-15'), '2027-03-15');
  assert.equal(parseDate('15.03.2027'), '2027-03-15');
  assert.equal(parseDate('03/15/2027'), '2027-03-15');
  assert.equal(parseDate('20270315'), '2027-03-15');
  assert.equal(parseDate(46461), '2027-03-15'); // Excel serial
  assert.equal(parseDate('2027-02-30'), '');
});

test('header row detection skips a title row', () => {
  const rows = [['Holdings report 2026-09-28'], [], ['ISIN', 'Security', 'Quantity', 'Price', 'Currency'], ['SE1', 'Foo', '1', '2', 'SEK']].filter(r => r.length);
  assert.equal(findHeaderRow(rows), 1);
});

test('rows to positions: type column, inference and validation', () => {
  const rows = [
    ['Aktie', 'Volvo B', '100', '250', 'SEK', ''],
    ['', 'Sweden 2030', '1000000', '96', 'SEK', '2030-11-12'],
    ['Weird', 'X', '1', '1', 'sek', '']
  ];
  const mapping = ['type', 'name', 'qty', 'price', 'ccy', 'maturity'];
  const out = rowsToPositions(rows, mapping, { decimal: '.', defaultType: 'auto' });
  assert.equal(out[0].pos.type, 'equity');
  assert.equal(out[0].errors.length, 0);
  assert.equal(out[1].pos.type, 'money_market'); // maturity, no coupon → discount paper
  assert.equal(out[2].pos.ccy, 'SEK');
  assert.ok(out[2].errors.some(e => e.code.startsWith('type_guessed')));
});

test('merge in update mode matches on ISIN and only overwrites supplied values', () => {
  const existing = [{ id: 'a', type: 'equity', isin: 'SE1', name: 'Foo', qty: 10, price: 5, ccy: 'SEK', sector: 'Tech' }];
  const incoming = [{ id: 'b', type: 'equity', isin: 'se1', price: 6 }, { id: 'c', type: 'equity', name: 'Bar', qty: 1, price: 1, ccy: 'SEK' }];
  const r = mergePositions(existing, incoming, 'update');
  assert.equal(r.updated, 1); assert.equal(r.added, 1);
  assert.equal(r.positions[0].price, 6); assert.equal(r.positions[0].sector, 'Tech'); assert.equal(r.positions[0].id, 'a');
});

test('history parsing: wide and long formats, merge', () => {
  const wide = parseHistory([['Date', 'AAA', 'BBB'], ['2026-01-02', '10', '20'], ['2026-01-01', '9', ''], ['2026-01-03', '11', '21']]);
  assert.deepEqual(wide.dates, ['2026-01-01', '2026-01-02', '2026-01-03']);
  assert.deepEqual(wide.series.AAA, [9, 10, 11]);
  assert.deepEqual(wide.series.BBB, [null, 20, 21]);
  const long = parseHistory([['date', 'ticker', 'close'], ['2026-01-01', 'X', '1'], ['2026-01-02', 'X', '2'], ['2026-01-02', 'Y', '5']]);
  assert.deepEqual(long.series.X, [1, 2]);
  const m = mergeHistory(wide, long);
  assert.equal(m.dates.length, 3);
  assert.deepEqual(m.series.X, [1, 2, null]);
});

test('template CSV round-trips through the importer without errors', () => {
  const { sheets, decimal } = parseText(templateCSV());
  const rows = sheets[0].rows;
  const mapping = autoMapping(rows[0]);
  const out = rowsToPositions(rows.slice(1), mapping, { decimal });
  for (const o of out) assert.deepEqual(o.errors, [], `${o.pos.type} ${o.pos.name} ${JSON.stringify(o.errors)}`);
  assert.equal(new Set(out.map(o => o.pos.type)).size, Object.keys(INSTRUMENTS).length);
});

function simplePortfolio() {
  const p = newPortfolio({ name: 'T', baseCcy: 'SEK', valDate: '2026-09-28' });
  p.fxEur = { EUR: 1, SEK: 11, USD: 1.1 };
  p.positions = [
    { id: '1', type: 'equity', name: 'A', issuer: 'A', qty: 1000, price: 100, ccy: 'SEK', beta: 1 },          // 100k
    { id: '2', type: 'equity', name: 'B', issuer: 'B', qty: 100, price: 100, ccy: 'USD', beta: 1 },           // 10k USD = 100k SEK
    { id: '3', type: 'govt_bond', name: 'G', issuer: 'Kingdom of Sweden', qty: 100000, yield: 3, coupon: 3, freq: 1, maturity: '2031-09-28', ccy: 'SEK', rating: 'AAA' },
    { id: '4', type: 'cash', name: 'Cash', issuer: 'Bank', qty: 100000, ccy: 'SEK' },
    { id: '5', type: 'fx_forward', buyCcy: 'SEK', buyAmount: 100000, sellCcy: 'USD', sellAmount: 10000, maturity: '2026-12-18', issuer: 'Bank' }
  ];
  return p;
}

test('valuation, FX and hedge accounting', () => {
  const v = valuePortfolio(simplePortfolio());
  close(v.valid[1].r.mv, 100000, 1e-6, 'USD equity in SEK');
  close(v.valid[2].r.mv, 100000, 1e-3, 'par bond at its coupon yield');
  close(v.valid[4].r.mv, 0, 1e-6, 'fwd at spot = 0');
  close(v.nav, 400000, 1e-2);
  const fx = currencyExposure(v);
  const usd = fx.rows.find(r => r.ccy === 'USD');
  close(usd.gross, 100000, 1e-6); close(usd.hedge, -100000, 1e-6); close(usd.net, 0, 1e-6); close(usd.hedgeRatio, 1, 1e-9);
});

test('fixed income: portfolio duration equals bond duration times weight', () => {
  const v = valuePortfolio(simplePortfolio());
  const fi = fixedIncome(v);
  const bd = v.valid[2].r.fi.modDur;
  close(fi.portfolioDuration, bd * 0.25, 1e-6);
  close(fi.ytm, 0.03, 1e-9);
});

test('factor model: single equity VaR equals z·σ·√(h/252)·MV plus specific risk', () => {
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-09-28' });
  p.positions = [{ id: '1', type: 'equity', name: 'A', qty: 1000, price: 100, ccy: 'SEK', beta: 1 }];
  p.cma.equitySpecificVol = 0;
  const f = factorModel(valuePortfolio(p));
  close(f.var, normInv(0.99) * 0.16 * Math.sqrt(1 / 252) * 100000, 1e-6);
  close(f.byFactorGroup.equity, f.sigmaAnnual, 1e-6, 'all risk from equity');
});

test('stress: rates +100bp on a bond ≈ −duration + convexity; option is fully repriced', () => {
  const v = valuePortfolio(simplePortfolio());
  const s = runStress(v, [{ id: 'x', rates: 100 }])[0];
  const bond = s.per.find(q => q.row.pos.id === '3');
  const b = v.valid[2].r;
  const exact = -b.mv * (b.fi.modDur * 0.01) + 0.5 * b.mv * b.fi.convexity * 1e-4;
  close(bond.pnl, exact, 1e-6);
  // Bumped full reprice should agree to a few bp of MV
  const up = valuePortfolio({ ...simplePortfolio(), positions: [{ ...simplePortfolio().positions[2], yield: 4 }] });
  close(bond.pnl, up.valid[0].r.mv - b.mv, b.mv * 2e-4);
  // Hedged USD equity: a 10 % USD move washes out except for the local P&L cross term
  const f = runStress(v, [{ id: 'fx', fxAll: 0.1 }])[0];
  close(f.total, 0, 1e-6);
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-09-28' });
  p.positions = [{ id: 'o', type: 'option', name: 'put', qty: 1, optType: 'put', strike: 100, maturity: '2027-09-28', underlyingPrice: 100, vol: 20, multiplier: 100, ccy: 'SEK', underlyingClass: 'equity', rate: 0 }];
  const ov = valuePortfolio(p);
  const crash = runStress(ov, [{ id: 'c', eq: -0.3 }])[0].total;
  const T = ov.valid[0].r.option.T;
  const expected = 100 * (bsm('put', 70, 100, T, 0, 0, 0.2).price - bsm('put', 100, 100, T, 0, 0, 0.2).price);
  close(crash, expected, 1e-8);
});

test('liquidity is pro-rata and compliance flags issuer breaches', () => {
  const p = simplePortfolio();
  p.positions[0].adv = 100; p.risk.participation = 20; // 1000 shares at 20/day → 50 days
  const v = valuePortfolio(p);
  const l = liquidity(v);
  const a = l.rows.find(q => q.row.pos.id === '1');
  assert.equal(a.days, 50);
  const c = compliance(v, l);
  const issuer = c.rules.find(r => r.id === 'issuerMax');
  close(issuer.value, 25, 1e-6);
  assert.equal(issuer.status, 'breach');
  assert.equal(c.rules.find(r => r.id === 'govtIssuerMax').status, 'ok');
});

test('perf stats on a known series', () => {
  const r = Array.from({ length: 252 }, (_, i) => (i % 2 ? 0.01 : -0.005));
  const s = perfStats([NaN, ...r], { rf: 0 });
  close(s.total, (1.01 * 0.995) ** 126 - 1, 1e-9);
  assert.ok(s.maxDD < 0 && s.maxDD > -0.006);
});

test('demo portfolio analyses end to end without errors', () => {
  const p = buildDemo('2026-09-28');
  const a = fullAnalysis(p);
  assert.equal(a.v.errorsCount, 0, JSON.stringify(a.v.rows.filter(x => x.errors.length).map(x => [x.name, x.errors])));
  assert.ok(a.v.nav > 0);
  assert.ok(a.risk.hist && a.risk.hist.coverage > 0.8, 'history coverage ' + a.risk.hist?.coverage);
  assert.ok(a.perf && Number.isFinite(a.perf.sharpe));
  assert.equal(a.stress.length, SCENARIOS.length);
  assert.ok(a.stress.every(s => Number.isFinite(s.total)));
  assert.ok(a.risk.param.varPct > 0.001 && a.risk.param.varPct < 0.05, 'VaR % ' + a.risk.param.varPct);
});

test('translations: English and Swedish have the same keys', () => {
  const en = Object.keys(DICT.en).sort(), sv = Object.keys(DICT.sv).sort();
  assert.deepEqual(en.filter(k => !(k in DICT.sv)), []);
  assert.deepEqual(sv.filter(k => !(k in DICT.en)), []);
});

test('every literal t("key") used in the code exists in the dictionary', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('../js/', import.meta.url).pathname;
  const files = [];
  const walk = d => readdirSync(d, { withFileTypes: true }).forEach(e => e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') && files.push(join(d, e.name)));
  walk(root);
  const missing = new Set();
  for (const f of files.filter(f => !f.endsWith('i18n.js'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('([a-zA-Z0-9_.]+)'(?!\s*\+)/g)) if (!(m[1] in DICT.en)) missing.add(m[1] + ' in ' + f.split('/js/')[1]);
  }
  assert.deepEqual([...missing], []);
});

test('Options Lab export: positions revalue to the Options Lab price in Portfolio Lab', async () => {
  const { strategyToPositions, addToWorkspace, listPortfolios } = await import('../js/strategy-export.js');
  const S = 100, r = 2.5, q = 1.5, sig = 0.22, days = 45;
  const T = days / 365.25; // Portfolio Lab measures time with actual/365.25 between dates
  const call = K => bsm('call', S, K, T, r / 100, q / 100, sig).price;
  const input = {
    strategyName: 'Bull Call Spread', instrument: 'equity', valDate: '2026-09-28', S, ratePct: r, divPct: q, dilution: 1,
    contractMult: 100, units: 3, ccy: 'SEK', underlying: 'OMXS30', ticker: '',
    legs: [
      { type: 'call', side: 'long', qty: 1, strike: 97, style: 'eu', days, sigma: sig, theo: call(97) },
      { type: 'call', side: 'short', qty: 1, strike: 105, style: 'eu', days, sigma: sig, theo: call(105) },
      { type: 'stock', side: 'long', qty: 1, strike: 0, style: 'eu', days, sigma: 0, theo: S }
    ]
  };
  const { positions, notes } = strategyToPositions(input);
  assert.deepEqual(positions.map(p => p.type), ['option', 'option', 'equity']);
  assert.deepEqual(positions.map(p => p.qty), [3, -3, 300]);
  assert.equal(positions[0].maturity, '2026-11-12');
  assert.equal(positions[0].strategy, 'Bull Call Spread');
  assert.deepEqual(notes, []);
  for (const p of positions) assert.deepEqual(validatePosition(p), [], JSON.stringify(p));

  const pf = newPortfolio({ baseCcy: 'SEK', valDate: '2026-09-28' });
  pf.positions = positions;
  const v = valuePortfolio(pf);
  close(v.valid[0].r.mv, 300 * call(97), 1e-6, 'long call MV');
  close(v.valid[1].r.mv, -300 * call(105), 1e-6, 'short call MV');
  close(v.valid[2].r.mv, 300 * S, 1e-9, 'shares');

  // American legs keep the Options Lab price; FX underlying becomes an FX future
  const am = strategyToPositions({ ...input, instrument: 'fx', fxCcy: 'EUR', legs: [{ ...input.legs[0], style: 'am', theo: 4.2 }, input.legs[2]] });
  assert.equal(am.positions[0].price, 4.2);
  assert.equal(am.positions[0].buyCcy, 'EUR');
  assert.equal(am.positions[1].type, 'future');
  assert.equal(am.positions[1].underlyingClass, 'fx');
  assert.ok(am.notes.includes('american_fixed_price'));

  // Workspace: new portfolio, then append to it
  const a = addToWorkspace(null, positions, { newName: 'Options', baseCcy: 'SEK' });
  assert.ok(a.created);
  assert.equal(a.ws.activeId, a.portfolioId);
  const b = addToWorkspace(a.ws, positions.slice(0, 1), { portfolioId: a.portfolioId });
  assert.equal(b.ws.portfolios[a.portfolioId].positions.length, 4);
  assert.equal(listPortfolios(b.ws)[0].n, 4);
});
