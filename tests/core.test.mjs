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

test('JSON and XML custodian files become rows', async () => {
  const { parseText, parseJSONRows, parseXMLRows } = await import('../js/importer.js');
  const json = JSON.stringify({ asOf: '2026-09-28', data: { positions: [
    { isin: 'SE0000115446', security: { name: 'Volvo B', ccy: 'SEK' }, qty: 1000, px: 262.5 },
    { isin: 'SE0000108656', security: { name: 'Ericsson B', ccy: 'SEK' }, qty: 500, px: 79.8, tags: ['a', 'b'] }
  ] } });
  const rows = parseJSONRows(json);
  assert.deepEqual(rows[0], ['isin', 'security.name', 'security.ccy', 'qty', 'px', 'tags']);
  assert.deepEqual(rows[2], ['SE0000108656', 'Ericsson B', 'SEK', 500, 79.8, 'a; b']);
  assert.equal(parseText(json, 'x.json').kind, 'json');

  const xml = `<?xml version="1.0"?><!-- custodian --><Statement date="2026-09-28"><Holdings>
    <Holding id="1" ccy="SEK"><Name>Volvo B</Name><Qty>1 000</Qty><Price>262,50</Price></Holding>
    <Holding id="2" ccy="EUR"><Name>ASML &amp; Co</Name><Qty>10</Qty><Price><![CDATA[702,00]]></Price></Holding>
  </Holdings></Statement>`;
  const x = parseXMLRows(xml);
  assert.deepEqual(x[0], ['id', 'ccy', 'Name', 'Qty', 'Price']);
  assert.deepEqual(x[2], ['2', 'EUR', 'ASML & Co', '10', '702,00']);
  const pt = parseText(xml, 'statement.xml');
  assert.equal(pt.kind, 'xml');
  assert.equal(pt.decimal, ',');
});

test('explicit date formats', () => {
  assert.equal(parseDate('03/04/2027', 'dmy'), '2027-04-03');
  assert.equal(parseDate('03/04/2027', 'mdy'), '2027-03-04');
  assert.equal(parseDate('2027.04.03', 'ymd'), '2027-04-03');
  assert.equal(parseDate('20270403', 'compact'), '2027-04-03');
  assert.equal(parseDate('46480', 'excel'), '2027-04-03');
  assert.equal(parseDate('2027-04-03', 'dmy'), '2027-04-03', 'unambiguous ISO still works when the declared format does not fit');
});

test('custom mapping: fixed values, scaling, type codes and skipped rows', async () => {
  const { rowsToPositions, typeValues, mandatoryFields } = await import('../js/importer.js');
  const rows = [
    ['EQ_ORD', 'Volvo B', '1000', '262.5', ''],
    ['GOVT', 'Sweden 2030', '5000000', '0.019', '2030-11-12'],
    ['CASHBAL', 'Cash', '10', '', ''],
    ['TOTAL', 'Total', '', '', '']
  ];
  const mapping = ['type', 'name', 'qty', 'yield', 'maturity'];
  const out = rowsToPositions(rows, mapping, {
    constants: { ccy: 'SEK', rating: 'AAA' }, transforms: { yield: { scale: 100 } },
    typeMap: { EQ_ORD: 'equity', GOVT: 'govt_bond', CASHBAL: '__skip' }, skipPattern: 'total'
  });
  assert.equal(out.length, 2, 'cash row skipped by type code, total row by pattern');
  assert.equal(out[0].pos.type, 'equity');
  assert.equal(out[0].pos.ccy, 'SEK');
  assert.equal(out[1].pos.type, 'govt_bond');
  close(out[1].pos.yield, 1.9, 1e-12);
  assert.equal(out[1].pos.rating, 'AAA');
  assert.deepEqual(out[1].errors, []);
  assert.ok(out[0].errors.some(e => e.field === 'price' && e.code === 'required'), 'equity still needs a price');
  const tv = typeValues(rows, mapping);
  assert.equal(tv.find(v => v.value === 'GOVT').count, 1);
  const req = mandatoryFields(['equity', 'govt_bond']);
  assert.ok(req.find(r => r.field === 'ccy').types.length === 2);
  assert.ok(req.find(r => r.oneOf && r.oneOf.includes('yield')));
});

test('saved templates are recognised on a later file even with columns reordered', async () => {
  const { buildTemplate, detectTemplate, applyTemplateMapping, validateTemplate, rowsToPositions } = await import('../js/importer.js');
  const header = ['Värdepapper', 'Innehav', 'Senast', 'Valuta', 'Kod'];
  const tpl = buildTemplate({
    name: 'Depåbank X', header, mapping: ['name', 'qty', 'price', 'ccy', 'type'], headerRow: 1, decimal: ',',
    constants: { country: 'SE' }, typeMap: { AK: 'equity' }, transforms: { price: { scale: 1 } }
  });
  assert.deepEqual(Object.keys(tpl.transforms), [], 'identity transforms are not stored');
  const next = [['Rapport 2026-10-01'], ['Kod', 'Valuta', 'Värdepapper', 'Senast', 'Innehav', 'Extra'], ['AK', 'SEK', 'Volvo B', '270,1', '1 000', 'x']];
  const hit = detectTemplate([tpl], [{ name: 'Blad1', rows: next }]);
  assert.ok(hit, 'template detected');
  assert.equal(hit.headerRow, 1);
  const mapping = applyTemplateMapping(hit.template, next[1]);
  assert.deepEqual(mapping, ['type', 'ccy', 'name', 'price', 'qty', '']);
  const [row] = rowsToPositions(next.slice(2), mapping, { decimal: ',', constants: tpl.constants, typeMap: tpl.typeMap });
  assert.equal(row.pos.type, 'equity');
  assert.equal(row.pos.qty, 1000);
  close(row.pos.price, 270.1, 1e-12);
  assert.equal(row.pos.country, 'SE');
  assert.deepEqual(row.errors, []);
  assert.equal(detectTemplate([tpl], [{ name: 'x', rows: [['a', 'b', 'c']] }]), null);
  assert.throws(() => validateTemplate({ name: 'bad', headers: [], mapping: { a: 'not_a_field' } }));
});

test('cash-flow calendar: coupons, redemptions, FX legs, CDS premiums, option expiry', async () => {
  const { cashflows, toICS } = await import('../js/fund.js');
  const { sum } = await import('../js/util.js');
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-09-28' });
  p.fxEur = { EUR: 1, SEK: 11, USD: 1.1 };
  p.positions = [
    { id: 'b', type: 'corp_bond', name: 'B', issuer: 'X', qty: 1000000, price: 100, coupon: 4, freq: '2', maturity: '2027-06-15', ccy: 'SEK' },
    { id: 'f', type: 'fx_forward', buyCcy: 'SEK', buyAmount: 1000000, sellCcy: 'USD', sellAmount: 100000, maturity: '2026-12-18' },
    { id: 'c', type: 'cds', issuer: 'Y', qty: 10000000, ccy: 'EUR', protection: 'buy', spread: 100, marketSpread: 100, maturity: '2031-12-20' },
    { id: 'o', type: 'option', name: 'Put', qty: 10, optType: 'put', strike: 110, maturity: '2026-10-16', underlyingPrice: 100, vol: 20, multiplier: 100, ccy: 'SEK' },
    { id: 'cash', type: 'cash', name: 'Cash', qty: 50000, ccy: 'SEK' }
  ];
  const cf = cashflows(valuePortfolio(p), { months: 12 });
  const coupons = cf.events.filter(e => e.kind === 'coupon');
  assert.deepEqual(coupons.map(e => e.date), ['2026-12-15', '2027-06-15']);
  close(coupons[0].amount, 20000, 1e-9);
  assert.equal(cf.events.find(e => e.kind === 'redemption').amount, 1000000);
  const legs = cf.events.filter(e => e.kind === 'fx_settle');
  close(sum(legs.map(e => e.amountBase)), 0, 1e-6, 'forward at spot nets to zero');
  const prem = cf.events.filter(e => e.kind === 'cds_premium');
  assert.deepEqual(prem.map(e => e.date), ['2026-12-20', '2027-03-20', '2027-06-20', '2027-09-20']);
  close(prem[0].amount, -25000, 1e-9, 'buyer pays 100bp/4 on 10m');
  const opt = cf.events.find(e => e.kind === 'option_expiry');
  assert.equal(opt.cash, false); close(opt.amount, 10 * 100 * 10, 1e-9);
  const total = sum(cf.buckets.map(b => b.net));
  close(cf.buckets[cf.buckets.length - 1].cashAfter, 50000 + total, 1e-6);
  const ics = toICS(cf.events, { fundName: 'Test' });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR') && ics.includes('DTSTART;VALUE=DATE:20261215'));
});

test('risk indicators: SRRI band from weekly vol, VEV equals vol for normal returns', async () => {
  const { riskIndicators, bandOf, SRRI_BANDS, MRM_BANDS } = await import('../js/fund.js');
  const { mulberry32, gaussian } = await import('../js/util.js');
  assert.equal(bandOf(0.004, SRRI_BANDS), 1); assert.equal(bandOf(0.05, SRRI_BANDS), 4); assert.equal(bandOf(0.3, SRRI_BANDS), 7);
  assert.equal(bandOf(0.11, MRM_BANDS), 3);
  // 5 years of business days, lognormal with 8 % annual vol → SRRI 4 (5–10 %), MRM 3 (5–12 %)
  const rng = mulberry32(7), dates = [], prices = [];
  let px = 100;
  for (let d = new Date(Date.UTC(2021, 8, 27)); dates.length < 1300; d = new Date(d.getTime() + 86400000)) {
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    dates.push(d.toISOString().slice(0, 10)); prices.push(px);
    px *= Math.exp(0.08 / Math.sqrt(256) * gaussian(rng) - 0.5 * 0.0064 / 256);
  }
  const r = riskIndicators({ dates, prices }, { rhpYears: 5 });
  close(r.srriVol, 0.08, 0.01, 'weekly vol ≈ 8 %');
  assert.equal(r.srri, 4);
  close(r.vev, 0.08, 0.008, 'VEV ≈ vol for near-normal returns');
  assert.equal(r.mrm, 3); assert.equal(r.sri, 3);
  assert.ok(r.srriFull && r.sriEnough);
  assert.equal(riskIndicators({ dates, prices }, { rhpYears: 5, crm: 4 }).sri, 5, 'credit risk class 4 lifts SRI to 5');
});

test('indicative NAV per unit, fee accrual and a redemption simulation', async () => {
  const { navPerUnit, simulateFlow } = await import('../js/fund.js');
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-09-28' });
  p.fxEur = { EUR: 1, SEK: 11 };
  p.positions = [
    { id: 'e', type: 'equity', name: 'A', issuer: 'A', qty: 9000, price: 100, ccy: 'SEK', adv: 1e6 },
    { id: 'c', type: 'cash', name: 'Cash', issuer: 'Bank', qty: 100000, ccy: 'SEK' }
  ]; // NAV 1 000 000
  const v = valuePortfolio(p);
  const one = navPerUnit(v, { classes: [{ id: 'a', name: 'A', ccy: 'SEK', units: 10000, feePct: 3.65 }], liabilities: 10000, feeFrom: '2026-09-18' });
  // (1 000 000 − 10 000) = 990 000; fee 3.65 % × 10 days / 365 = 0.1 % → 989 010 / 10 000
  close(one.classes[0].navPerUnit, 98.901, 1e-9);
  const two = navPerUnit(v, { classes: [
    { id: 'sek', name: 'SEK', ccy: 'SEK', units: 5000, lastNav: 100, feePct: 0 },
    { id: 'eur', name: 'EUR', ccy: 'EUR', units: 500, lastNav: 90.909090909, feePct: 0 }
  ] });
  close(two.classes[0].share, 0.5, 1e-6);
  close(two.classes[1].navPerUnit * 11 * 500, 500000, 1e-3, 'EUR class holds half the fund');
  assert.equal(navPerUnit(v, { classes: [{ id: 'a', units: 1, ccy: 'SEK' }, { id: 'b', units: 1, ccy: 'SEK' }] }).reason, 'need_last_nav');
  const red = simulateFlow(p, one, 'a', -150000);
  assert.equal(red.coveredByCash, false);
  assert.equal(red.overdraft, true);
  close(red.unitsDelta, -150000 / 98.901, 1e-9);
  const sub = simulateFlow(p, one, 'a', 200000);
  close(sub.cashAfter, 300000, 1e-9);
});

test('semi-annual bonds are priced semi-annually even when the frequency is stored as text', () => {
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-01-15' });
  p.positions = [{ id: 'b', type: 'corp_bond', name: 'B', issuer: 'X', qty: 100, yield: 4, coupon: 4, freq: '2', maturity: '2031-01-15', ccy: 'SEK' }];
  const r = valuePortfolio(p).valid[0].r;
  close(r.mv, 100, 1e-6, 'a 4 % semi-annual bond at a 4 % semi-annual yield prices at par');
  const a = bondAnalytics({ valuationDate: '2026-01-15', maturity: '2031-01-15', couponPct: 4, freq: 2, yieldPct: 4 });
  close(r.fi.modDur, a.modDur, 1e-12);
});

test('reported delta and notional override the model, with signs from the position', async () => {
  const { derivativesBook } = await import('../js/allocation.js');
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-01-15' });
  const opt = { id: 'o', type: 'option', name: 'Put', qty: -10, optType: 'put', strike: 100, maturity: '2026-07-15', underlyingPrice: 100, vol: 20, multiplier: 100, ccy: 'SEK', underlyingClass: 'equity', rate: 2 };
  p.positions = [
    { ...opt, reportedDelta: 45 },                                           // per cent, unsigned: short put = long delta
    { ...opt, id: 'o2', reportedDeltaExposure: -44000 },                     // amount only, sign from the file ignored
    { ...opt, id: 'o3' },                                                     // model only
    { id: 'f', type: 'future', name: 'Fut', qty: -2, price: 1000, multiplier: 10, ccy: 'SEK', underlyingClass: 'equity', reportedNotional: 21000 }
  ];
  const [a, b, c, f] = valuePortfolio(p).valid.map(x => x.r);
  close(a.net, -10 * 100 * 100 * -0.45, 1e-9, 'short put with |delta| 0.45 is +45 000 of equity');
  assert.equal(a.deriv.used, true);
  assert.equal(a.deriv.mismatch, false, 'ATM put delta ~0.45 matches');
  close(b.net, 44000, 1e-9);
  assert.equal(b.deriv.mismatch, false);
  assert.equal(c.deriv.used, false);
  close(c.net, c.deriv.modelDeltaExp, 1e-9);
  close(f.net, -21000, 1e-9);
  assert.equal(f.deriv.mismatch, false, '5 % notional gap is within tolerance');
  assert.ok(!f.warnings.includes('reported_mismatch'));
  // A wildly different reported delta gets flagged, and switching the setting off reverts to the model.
  p.positions[0].reportedDelta = 0.9;
  const flagged = valuePortfolio(p).valid[0].r;
  assert.equal(flagged.deriv.mismatch, true);
  assert.ok(flagged.warnings.includes('reported_mismatch'));
  p.risk.useReported = false;
  const off = valuePortfolio(p);
  close(off.valid[0].r.net, off.valid[0].r.deriv.modelDeltaExp, 1e-9);
  close(off.valid[3].r.net, -20000, 1e-9);
  const db = derivativesBook(valuePortfolio({ ...p, risk: { ...p.risk, useReported: true } }));
  assert.equal(db.count, 4);
  assert.equal(db.withReported, 3);
  assert.equal(db.mismatches, 1);
});

test('asset allocation: look-through of mixed funds, derivative overlay and mandate ranges', async () => {
  const { allocationAnalysis, allocationTree } = await import('../js/allocation.js');
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-01-15' });
  p.positions = [
    { id: 'e', type: 'equity', name: 'A', issuer: 'A', qty: 1000, price: 400, ccy: 'SEK', sector: 'Tech' },   // 400 000
    { id: 'm', type: 'fund', name: 'Mix', qty: 1000, price: 400, ccy: 'SEK', subClass: 'mixed', equityShare: 25 }, // 100k eq + 300k FI
    { id: 'c', type: 'cash', name: 'Cash', issuer: 'Bank', qty: 200000, ccy: 'SEK' },
    { id: 'f', type: 'future', name: 'Index fut', qty: -1, price: 1000, multiplier: 100, ccy: 'SEK', underlyingClass: 'equity' } // −100 000
  ]; // NAV 1 000 000
  p.allocTargets = { equity: { target: 45, min: 30, max: 60 }, fixed_income: { min: 35 } };
  const v = valuePortfolio(p);
  const aa = allocationAnalysis(v, p);
  const eq = aa.classes.find(c => c.key === 'equity'), fi = aa.classes.find(c => c.key === 'fixed_income');
  close(eq.mvW, 0.5, 1e-12);
  close(eq.overlayW, -0.1, 1e-12);
  close(eq.econW, 0.4, 1e-12);
  close(eq.shortW, -0.1, 1e-12);
  close(eq.active, -0.05, 1e-12);
  assert.equal(eq.status, 'ok');
  close(fi.econW, 0.3, 1e-12);
  assert.equal(fi.status, 'breach');
  assert.equal(aa.breaches, 1);
  close(aa.econW, 0.9, 1e-12);
  close(aa.grossW, 1.1, 1e-12);
  const tree = allocationTree(v, { measure: 'economic', dim: 'auto', base: 'SEK' });
  const root = tree.filter(n => n.parent === '');
  close(root.reduce((s, n) => s + n.signed, 0), 900000, 1e-6, 'tree adds up to economic exposure');
  assert.ok(tree.find(n => n.kind === 'holding' && n.key === 'Index fut').short);
  assert.equal(new Set(tree.map(n => n.id)).size, tree.length, 'ids are unique even for split funds');
});

test('import recognises reported notional and delta columns', () => {
  const rows = parseCSV('Name;Type;Contracts;Strike;Delta;Notional value;Delta-adjusted exposure\nX;option;10;100;0,45;100000;45000', ';');
  const m = autoMapping(rows[0]);
  assert.equal(m[4], 'reportedDelta');
  assert.equal(m[5], 'reportedNotional');
  assert.equal(m[6], 'reportedDeltaExposure');
});

test('linked file: position rows round-trip through the importer, file kinds by extension', async () => {
  const { positionRows } = await import('../js/importer.js');
  const { kindOfName, buildContent } = await import('../js/filelink.js');
  const p = buildDemo('2026-09-28');
  const rows = positionRows(p);
  assert.equal(rows.length, p.positions.length + 1);
  assert.equal(rows[0][0], 'type');
  const mapping = autoMapping(rows[0]);
  const back = rowsToPositions(rows.slice(1), mapping, { decimal: '.' });
  assert.equal(back.length, p.positions.length);
  assert.ok(back.every(x => !x.errors.length), JSON.stringify(back.filter(x => x.errors.length).map(x => [x.pos.name, x.errors])));
  const v0 = valuePortfolio(p), v1 = valuePortfolio({ ...p, positions: back.map(x => x.pos) });
  close(v1.nav, v0.nav, 1, 'NAV survives the CSV round trip');
  assert.equal(v1.errorsCount, 0);
  assert.deepEqual(['a.json', 'B.CSV', 'c.xlsx', 'd.xls', 'e.txt', ''].map(kindOfName), ['json', 'csv', 'xlsx', 'xlsx', null, null]);
  assert.equal(buildContent('csv', { p: null }), null, 'nothing to mirror without a portfolio');
});

test('methodology page documents every module and both languages', async () => {
  const { METHODOLOGY } = await import('../js/methodology.js');
  const { readdirSync } = await import('node:fs');
  const modules = new Set(readdirSync(new URL('../js/', import.meta.url).pathname).filter(f => f.endsWith('.js')));
  for (const s of METHODOLOGY) {
    assert.ok(s.title.en && s.title.sv && s.items.length, s.id);
    for (const m of s.module.split('·')) assert.ok(modules.has(m.trim().split(' ')[0]), `${s.id} names an unknown module: ${m}`);
    for (const it of s.items) assert.ok(it.en && it.sv && it.formula && it.notes && 'en' in it.notes && 'sv' in it.notes, `${s.id}: ${it.en}`);
  }
  assert.ok(METHODOLOGY.some(s => s.id === 'risk') && METHODOLOGY.some(s => s.id === 'fund'));
});

test('cost basis: average-cost book with fees, short through zero, FX effect and period realised', async () => {
  const { lotBook, pnlAnalysis, parseTransactions, unitOf } = await import('../js/pnl.js');
  // 100 @ 10 (+10 fee) → avg 10.10; 100 @ 12 → avg 11.05; sell 150 @ 13 (−15 fee) → realised 150×1.95 − 15
  const b = lotBook([
    { date: '2026-01-05', side: 'buy', qty: 100, price: 10, fees: 10 },
    { date: '2026-02-05', side: 'buy', qty: 100, price: 12, fees: 0 },
    { date: '2026-03-05', side: 'sell', qty: 150, price: 13, fees: 15 }
  ], 1);
  close(b.avg, 11.05, 1e-12); close(b.qty, 50, 1e-12); close(b.realised, 150 * 1.95 - 15, 1e-9); close(b.costLocal, 50 * 11.05, 1e-9);
  // Selling through zero: 50 long, sell 80 @ 14 → realise 50 × (14 − 11.05), then short 30 @ 14; buy 30 @ 12 covers: realise 30 × 2
  const c = lotBook([...[
    { date: '2026-01-05', side: 'buy', qty: 100, price: 10, fees: 10 }, { date: '2026-02-05', side: 'buy', qty: 100, price: 12, fees: 0 },
    { date: '2026-03-05', side: 'sell', qty: 150, price: 13, fees: 15 }],
    { date: '2026-04-01', side: 'sell', qty: 80, price: 14, fees: 0 }, { date: '2026-05-01', side: 'buy', qty: 30, price: 12, fees: 0 }
  ], 1);
  close(c.qty, 0, 1e-12); close(c.realised, 150 * 1.95 - 15 + 50 * (14 - 11.05) + 30 * 2, 1e-9);
  assert.equal(c.rows[3].qtyAfter, -30); close(c.rows[3].avgAfter, 14, 1e-12);
  // FX: bought at 10 SEK/USD, now 11 → the FX effect is the whole gain when the price is unchanged
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-06-30' });
  p.fxEur = { EUR: 1, SEK: 11, USD: 1 }; // 1 USD = 11 SEK today
  p.positions = [{ id: 'u', type: 'equity', name: 'US Co', qty: 100, price: 50, ccy: 'USD' }, { id: 'g', type: 'govt_bond', name: 'Bond', qty: 1000000, price: 98, ccy: 'SEK', coupon: 0, maturity: '2028-06-30', costPrice: 95 }, { id: 'k', type: 'cash', name: 'Cash', qty: 1000, ccy: 'SEK' }];
  p.transactions = [{ id: 't1', posId: 'u', date: '2025-12-01', side: 'buy', qty: 100, price: 50, fees: 0, fx: 10 }];
  const a = pnlAnalysis(valuePortfolio(p), p, { from: '2026-01-01' });
  const us = a.rows.find(r => r.pos.id === 'u'), bond = a.rows.find(r => r.pos.id === 'g');
  close(us.costBase, 100 * 50 * 10, 1e-9); close(us.unrealised, 100 * 50 * 1, 1e-9); close(us.fxEffect, 5000, 1e-9);
  assert.equal(unitOf(p.positions[1]), 0.01);
  close(bond.costBase, 1000000 * 0.95, 1e-6); close(bond.unrealised, 1000000 * 0.03, 1e-6); // clean 98 vs cost 95 (dirty = clean, zero coupon)
  assert.equal(a.covered.length, 2); assert.equal(a.eligible, 2); assert.equal(a.tot.realisedPeriod, 0);
  // File import: Swedish headers, decimal comma, side words, matching on ticker/name
  p.positions[0].ticker = 'USCO';
  const r = parseTransactions([['Datum', 'Typ', 'Värdepapper', 'Antal', 'Kurs', 'Courtage'], ['2026-03-01', 'Köp', 'USCO', '10', '52,5', '9'], ['2026-03-02', 'Sälj', 'Okänd AB', '5', '50', '0'], ['01/04/2026', 'Sälj', 'US Co', '5', '55', '0']], p.positions);
  assert.equal(r.txs.length, 2); assert.equal(r.txs[0].side, 'buy'); close(r.txs[0].price, 52.5, 1e-12); assert.equal(r.txs[1].date, '2026-04-01');
  assert.deepEqual(r.unmatched.map(u => u.reason), ['no_position']);
});

test('risk by asset class adds up to the portfolio volatility, and the performance map has a point per covered position', async () => {
  const { positionPerformance } = await import('../js/analytics.js');
  const { sum } = await import('../js/util.js');
  const p = buildDemo('2026-09-28');
  const a = fullAnalysis(p);
  const P = a.risk.param;
  close(sum(P.byAssetClass.map(c => c.total)), P.sigmaAnnual, 1e-6 * P.sigmaAnnual);
  close(sum(P.byAssetClass.map(c => c.securities + c.derivatives)), P.sigmaAnnual, 1e-6 * P.sigmaAnnual);
  const eq = P.byAssetClass.find(c => c.key === 'equity');
  assert.ok(eq.derivatives < 0, 'the short index future and the put reduce equity risk');
  assert.ok(P.byAssetClass.find(c => c.key === 'currency'), 'currency is its own bucket');
  const H = a.risk.hist;
  close(sum(H.byAssetClass.map(c => c.total)), H.sigmaAnnual, 1e-6 * H.sigmaAnnual);
  const pts = positionPerformance(a.risk.hp, a.v, 252);
  assert.equal(pts.length, a.risk.hp.covered.filter(c => c.key !== 'FX').length);
  assert.ok(pts.every(q => Number.isFinite(q.ret) && Number.isFinite(q.vol) && Number.isFinite(q.contribPct)));
});

test('connected source file: dates in the first column split snapshots and portfolios', async () => {
  const { cellDate, detectLayout, analyseRows, carryIds, snapshotPositions, snapshotHistory } = await import('../js/sourcefile.js');
  assert.equal(cellDate('2026-09-29'), '2026-09-29');
  assert.equal(cellDate('29.09.2026'), '2026-09-29');
  assert.equal(cellDate('20260929'), '2026-09-29');
  assert.equal(cellDate(46294), '2026-09-29');
  assert.equal(cellDate('Total'), '');
  assert.equal(cellDate('1234'), '');
  assert.equal(cellDate(12.5), '');

  const csv = [
    'Exported by custodian',
    'Date;Portfolio;Name;ISIN;Type;Quantity;Price;Currency',
    '2026-09-28;Fund A;Volvo B;SE0000115446;Equity;1000;250,5;SEK',
    '2026-09-28;Fund A;Cash;;Cash;50000;1;SEK',
    '2026-09-28;Fund B;Apple;US0378331005;Equity;10;230;USD',
    '2026-09-29;Fund A;Volvo B;SE0000115446;Equity;1200;255;SEK',
    '2026-09-29;Fund A;Cash;;Cash;0;1;SEK',
    '2026-09-29;Fund B;Apple;US0378331005;Equity;12;232;USD',
    'Total;;;;;;;'
  ].join('\n');
  const { sheets, decimal } = parseText(csv, 'x.csv');
  const rows = sheets[0].rows;
  const layout = detectLayout(rows);
  assert.equal(layout.headerRow, 1);
  assert.equal(layout.dateCol, 0);
  assert.equal(layout.pfCol, 1);

  const r = analyseRows(rows, { decimal });
  assert.ok(!r.error, r.error);
  assert.deepEqual(r.groups.map(g => g.key), ['Fund A', 'Fund B']);
  assert.deepEqual(r.groups[0].dates.map(d => d.date), ['2026-09-28', '2026-09-29']);
  assert.equal(r.skipped, 1, 'the total line is not a snapshot');
  assert.equal(r.mapping[0], '', 'date column is not a position field');
  assert.equal(r.mapping[1], '', 'portfolio column is not a position field');

  const latestA = snapshotPositions(r.groups[0].dates[1].rows, r.mapping, r.opts);
  assert.equal(latestA.length, 2);
  const volvo = latestA.find(x => x.isin === 'SE0000115446');
  assert.equal(volvo.qty, 1200);
  assert.equal(volvo.price, 255);

  const hist = snapshotHistory(r.groups[0], r.mapping, r.opts);
  assert.deepEqual(hist.dates, ['2026-09-28', '2026-09-29']);
  assert.deepEqual(hist.series.SE0000115446, [250.5, 255]);

  const prev = snapshotPositions(r.groups[0].dates[0].rows, r.mapping, r.opts);
  const next = carryIds(prev, latestA);
  assert.equal(next.find(x => x.isin === 'SE0000115446').id, prev.find(x => x.isin === 'SE0000115446').id, 'ids survive a refresh');
});

test('connected source file: no portfolio column means one portfolio; no date column is an error', async () => {
  const { analyseRows } = await import('../js/sourcefile.js');
  const one = parseText('Datum,Namn,Antal,Kurs,Valuta\n2026-09-29,Ericsson B,100,80,SEK\n2026-09-29,Nokia,50,4,EUR\n', 'y.csv');
  const r = analyseRows(one.sheets[0].rows, { decimal: one.decimal });
  assert.ok(!r.error, r.error);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].key, '');
  assert.equal(r.groups[0].dates[0].rows.length, 2);
  const none = parseText('Name,Quantity,Price\nVolvo,1,2\n', 'z.csv');
  assert.equal(analyseRows(none.sheets[0].rows, { decimal: '.' }).error, 'no_date');
});

test('user guide: every block exists in English and Swedish, links go to real pages', async () => {
  const { GUIDE } = await import('../js/guide.js');
  const routes = ['dashboard', 'holdings', 'import', 'history', 'exposure', 'risk', 'fixed-income', 'performance', 'stress', 'liquidity', 'compliance', 'report', 'settings', 'cashflow', 'risk-class', 'nav', 'allocation', 'derivatives', 'methodology', 'pnl', 'guide', 'changes', 'whatif', 'attribution'];
  const both = (o, where) => assert.ok(o && String(o.en || '').trim() && String(o.sv || '').trim(), 'missing translation in ' + where);
  assert.equal(GUIDE[0].id, 'privacy', 'data privacy comes first');
  assert.equal(new Set(GUIDE.map(s => s.id)).size, GUIDE.length);
  for (const s of GUIDE) {
    both(s.title, s.id);
    for (const b of s.blocks) {
      for (const k of ['h', 'p', 'note']) if (b[k]) both(b[k], s.id);
      for (const k of ['steps', 'list']) if (b[k]) b[k].forEach(x => both(x, s.id));
      if (b.link) { assert.ok(routes.includes(b.link), b.link); both(b.label, s.id); }
      if (b.href) { assert.match(b.href, /^https:\/\//); both(b.label, s.id); }
    }
  }
});

test('methodology module links point at files that exist in js/', async () => {
  const { METHODOLOGY } = await import('../js/methodology.js');
  const { existsSync } = await import('node:fs');
  for (const s of METHODOLOGY) for (const m of s.module.match(/[\w-]+\.js/g)) {
    assert.ok(existsSync(new URL('../js/' + m, import.meta.url)), `${s.id}: js/${m} does not exist`);
  }
});

test('insights: holdings-based period return, price vs trading effect, flows and turnover', async () => {
  const { period, realised } = await import('../js/insights.js');
  const p = newPortfolio({ baseCcy: 'SEK' });
  p.history = { dates: ['2026-01-01', '2026-01-02'], series: { SEB0001: [20, 22] } };
  const a = { date: '2026-01-01', positions: [
    { id: 'a', type: 'equity', name: 'A', isin: 'SEA0001', qty: 100, price: 10, ccy: 'SEK' },
    { id: 'b', type: 'equity', name: 'B', isin: 'SEB0001', qty: 50, price: 20, ccy: 'SEK' },
    { id: 'c', type: 'cash', name: 'Cash', qty: 1000, ccy: 'SEK' }] };
  // B sold at 22, C bought for 50 out of cash: self-financed, so no flows.
  const b = { date: '2026-01-02', positions: [
    { id: 'a2', type: 'equity', name: 'A', isin: 'SEA0001', qty: 100, price: 11, ccy: 'SEK' },
    { id: 'n', type: 'equity', name: 'C', isin: 'SEC0001', qty: 10, price: 5, ccy: 'SEK' },
    { id: 'c2', type: 'cash', name: 'Cash', qty: 2050, ccy: 'SEK' }] };
  const q = period(p, a, b);
  close(q.v0.nav, 3000, 1e-9); close(q.v1.nav, 3200, 1e-9); close(q.vB.nav, 3200, 1e-9);
  close(q.ret, 3200 / 3000 - 1, 1e-12);
  close(q.flows, 0, 1e-9, 'self-financed trades are not flows');
  close(q.rows.reduce((s, o) => s + o.contrib, 0), q.ret, 1e-12, 'contributions add up');
  assert.equal(q.rows.find(o => o.name === 'B').status, 'sold');
  assert.equal(q.rows.find(o => o.name === 'C').status, 'new');
  close(q.turnover, 50 / 3100, 1e-12);
  assert.equal(q.unpriced.length, 0, 'B was priced from the history');
  // A subscription of 500 shows up as a flow, not as return.
  const b2 = { ...b, positions: b.positions.map(x => x.type === 'cash' ? { ...x, qty: 2550 } : x) };
  const q2 = period(p, a, b2);
  close(q2.ret, q.ret, 1e-12); close(q2.flows, 500, 1e-9);
  const r = realised(p, [a, b2]);
  close(r.total, q.ret, 1e-12); close(r.flows, 500, 1e-9);
});

test('insights: breach history tells passive (market) from active (trade) breaches', async () => {
  const { breachHistory } = await import('../js/insights.js');
  const p = newPortfolio({ baseCcy: 'SEK' });
  const pos = (id, px, q) => ({ id, type: 'equity', name: id, isin: 'SE' + id, qty: q, price: px, ccy: 'SEK' });
  const cash = q => ({ id: 'cash', type: 'cash', name: 'Cash', qty: q, ccy: 'SEK' });
  const s = [
    { date: '2026-01-01', positions: [pos('X', 95, 1), pos('Y', 50, 1), cash(855)] },   // X 9.5 %
    { date: '2026-01-02', positions: [pos('X', 120, 1), pos('Y', 50, 1), cash(855)] },  // price only → X 11.6 %: passive
    { date: '2026-01-05', positions: [pos('X', 90, 1), pos('Y', 50, 1), cash(860)] },   // back under
    { date: '2026-01-06', positions: [pos('X', 90, 1), pos('Y', 50, 3), cash(760)] }    // bought Y → 15 %: active
  ];
  const h = breachHistory(p, s);
  const ep = h.episodes.filter(e => e.id === 'issuerMax').sort((a, b) => a.start.localeCompare(b.start));
  assert.equal(ep.length, 2);
  assert.deepEqual(ep.map(e => [e.start, e.cause, e.ongoing]), [['2026-01-02', 'passive', false], ['2026-01-06', 'active', true]]);
});

test('insights: what-if hits the target weight and books the cash', async () => {
  const { whatIf } = await import('../js/insights.js');
  const p = newPortfolio({ baseCcy: 'SEK' });
  p.positions = [{ id: 'e', type: 'equity', name: 'E', isin: 'SEE', qty: 100, price: 10, ccy: 'SEK' }, { id: 'c', type: 'cash', name: 'Cash', qty: 9000, ccy: 'SEK' }];
  const w = whatIf(p, [{ id: 'e', mode: 'weight', value: 0.25 }]);
  close(w.after.nav, w.before.nav, 1e-6, 'a cash-funded trade leaves NAV unchanged');
  const e = w.after.v.valid.find(x => x.pos.id === 'e');
  close(e.weight, 0.25, 1e-9);
  close(w.cashNeeded, 1500, 1e-9);
  assert.ok(w.after.varPct > w.before.varPct, 'more equity, more risk');
  const n = whatIf(p, [{ pos: { type: 'equity', name: 'New', qty: 10, price: 100, ccy: 'SEK' } }]);
  close(n.cashNeeded, 1000, 1e-9);
  assert.equal(n.after.n, 3);
});

test('insights: Brinson-Fachler matches the textbook example and reconciles', async () => {
  const { brinson } = await import('../js/insights.js');
  const b = brinson([{ segment: 'Equity', weight: 0.6, ret: 0.10 }, { segment: 'Bonds', weight: 0.4, ret: 0.04 }],
                    [{ segment: 'equity', weight: 50, ret: 0.08 }, { segment: 'Bonds', weight: 50, ret: 0.05 }]);
  close(b.Rp, 0.076, 1e-12); close(b.Rb, 0.065, 1e-12);
  close(b.allocation, 0.003, 1e-12); close(b.selection, 0.005, 1e-12); close(b.interaction, 0.003, 1e-12);
  close(b.allocation + b.selection + b.interaction, b.active, 1e-12);
  const eq = b.rows.find(r => r.segment === 'Equity');
  close(eq.allocation, 0.0015, 1e-12); close(eq.selection, 0.01, 1e-12); close(eq.interaction, 0.002, 1e-12);
  // A segment only one side holds still reconciles.
  const c = brinson([{ segment: 'A', weight: 1, ret: 0.05 }], [{ segment: 'A', weight: 0.7, ret: 0.03 }, { segment: 'B', weight: 0.3, ret: -0.02 }]);
  close(c.allocation + c.selection + c.interaction, c.active, 1e-12);
});

test('insights: liquidity stress test coverage, waterfall and vertical slice', async () => {
  const { liquidityStress } = await import('../js/insights.js');
  const p = newPortfolio({ baseCcy: 'SEK' });
  p.positions = [
    { id: 'c', type: 'cash', name: 'Cash', qty: 100, ccy: 'SEK' },
    { id: 'e', type: 'equity', name: 'E', isin: 'SEE', qty: 60, price: 10, ccy: 'SEK' },
    { id: 'x', type: 'alternative', name: 'PE fund', qty: 1, price: 300, ccy: 'SEK', altType: 'private_equity' }];
  const r = liquidityStress(p, { redemptions: [0.1, 0.3, 0.8], horizon: 7, stressed: false });
  close(r.nav, 1000, 1e-9);
  close(r.maxRedemption, (100 + 600 + 300 * 7 / 180) / 1000, 1e-9);
  const [s10, s30, s80] = r.scenarios;
  assert.ok(s10.pass && s30.pass && !s80.pass);
  close(s30.coverage, r.liquid / 300, 1e-12);
  // Waterfall sells cash first, then equity: the PE fund's share rises to 300 / 700.
  close(s30.waterfall.nav, 700, 1e-6);
  close(s30.waterfall.cash, 0, 1e-9);
  close(s30.vertical.nav, 700, 1e-6);
  close(s30.vertical.cash, 0.1, 1e-9, 'vertical slice keeps the mix');
  assert.ok(s80.shortfall > 0);
});

test('insights: benchmark table parsing (Swedish headers, decimal comma, % returns)', async () => {
  const { parseBenchmark } = await import('../js/insights.js');
  const { normKey } = await import('../js/instruments.js');
  const { sheets, decimal } = parseText('Sektor;Vikt;Avkastning\nIndustri;35,5;2,1\nFinans;64,5;-0,8\nSumma;100;0,5\n', 'b.csv');
  const r = parseBenchmark(sheets[0].rows, { decimal, parseNumber, normKey });
  assert.equal(r.rows.length, 2);
  assert.ok(r.percent);
  close(r.rows[0].weight, 35.5, 1e-12); close(r.rows[0].ret, 0.021, 1e-12); close(r.rows[1].ret, -0.008, 1e-12);
});

test('insights: a short future that gains is return, not a subscription', async () => {
  const { period } = await import('../js/insights.js');
  const p = newPortfolio({ baseCcy: 'SEK' });
  const fut = px => ({ id: 'f', type: 'future', name: 'OMXS30 Dec', ticker: 'OMXS301', qty: -10, price: px, multiplier: 100, ccy: 'SEK', underlyingClass: 'equity' });
  const eq = px => ({ id: 'e', type: 'equity', name: 'E', isin: 'SEE', qty: 1000, price: px, ccy: 'SEK' });
  const a = { date: '2026-01-01', positions: [eq(100), fut(2500), { id: 'c', type: 'cash', name: 'Cash', qty: 50000, ccy: 'SEK' }] };
  // Index −4 %: equity loses 4 000, the short future gains 10 × 100 × 100 = 100 000, settled into cash.
  const b = { date: '2026-01-02', positions: [eq(96), fut(2400), { id: 'c', type: 'cash', name: 'Cash', qty: 150000, ccy: 'SEK' }] };
  const q = period(p, a, b);
  close(q.variationMargin, 100000, 1e-6);
  close(q.flows, 0, 1e-6, 'futures P&L is not a flow');
  close(q.ret, (-4000 + 100000) / 150000, 1e-12);
  close(q.rows.reduce((s, o) => s + o.contrib, 0), q.ret, 1e-12);
  close(q.rows.find(o => o.type === 'future').priceEffect, 100000, 1e-6);
});

test('insights: a position closed and reported with quantity 0 is priced from that row; turnover spans the window', async () => {
  const { period, realised } = await import('../js/insights.js');
  const p = newPortfolio({ baseCcy: 'SEK' });
  const s = (d, q, px, cash, extra = []) => ({ date: d, positions: [{ id: 'k', type: 'equity', name: 'K', isin: 'FRK', qty: q, price: px, ccy: 'SEK' }, { id: 'c', type: 'cash', name: 'Cash', qty: cash, ccy: 'SEK' }, ...extra] });
  // Short 100 at 190, covered at 170: +2 000 is return, not a flow.
  const q = period(p, s('2026-06-01', -100, 190, 50000), s('2026-06-30', 0, 170, 50000 - 17000));
  close(q.ret, 2000 / (50000 - 19000), 1e-12);
  close(q.flows, 0, 1e-9);
  assert.equal(q.rows.find(o => o.name === 'K').status, 'sold');
  assert.equal(q.unpriced.length, 0);
  // One month only buying, the next only selling: turnover is not zero.
  const e = (q2, px) => ({ id: 'e', type: 'equity', name: 'E', isin: 'SEE', qty: q2, price: px, ccy: 'SEK' });
  const r = realised(p, [s('2026-01-01', 0, 1, 10000, [e(100, 10)]), s('2026-02-01', 0, 1, 9000, [e(200, 10)]), s('2026-03-01', 0, 1, 10000, [e(100, 10)])]);
  close(r.turnover, 1000 / 11000, 1e-12);
});
