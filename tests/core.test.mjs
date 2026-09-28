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
