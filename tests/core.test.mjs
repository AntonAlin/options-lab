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
import { mulberry32, gaussian, isNum } from '../js/util.js';

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
    assert.ok(def.en, `${id} label`);
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
  // An unrecognised type is not guessed: the row is kept, unvalued, with a blocking error.
  assert.equal(out[2].pos.type, 'unknown');
  assert.ok(out[2].errors.some(e => e.code === 'unknown_type:Weird'));
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

test('methodology page documents every module', async () => {
  const { METHODOLOGY } = await import('../js/methodology.js');
  const { readdirSync } = await import('node:fs');
  const modules = new Set(readdirSync(new URL('../js/', import.meta.url).pathname).filter(f => f.endsWith('.js')));
  for (const s of METHODOLOGY) {
    assert.ok(s.title.en && s.items.length, s.id);
    for (const m of s.module.split('·')) assert.ok(modules.has(m.trim().split(' ')[0]), `${s.id} names an unknown module: ${m}`);
    for (const it of s.items) assert.ok(it.en && it.formula && it.notes && 'en' in it.notes, `${s.id}: ${it.en}`);
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

test('risk by asset class adds up to the portfolio volatility', async () => {
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

test('user guide: every block has text, links go to real pages', async () => {
  const { GUIDE } = await import('../js/guide.js');
  const routes = ['dashboard', 'holdings', 'import', 'history', 'exposure', 'risk', 'fixed-income', 'performance', 'stress', 'liquidity', 'compliance', 'report', 'settings', 'cashflow', 'nav', 'allocation', 'derivatives', 'methodology', 'pnl', 'guide', 'changes', 'whatif', 'attribution', 'global-exposure', 'liquidity-tools'];
  const both = (o, where) => assert.ok(o && String(o.en || '').trim(), 'missing text in ' + where);
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
    { id: 'x', type: 'alternative', name: 'PE fund', qty: 1, price: 300, ccy: 'SEK', altType: 'private_equity', liquidityDays: 180 }];
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

test('derivatives: market value by kind — margined future, option premium or reported value, OTC flags', async () => {
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-09-28' });
  const val = pos => valuePortfolio({ ...p, positions: [{ id: 'x', ...pos }] }).rows[0];
  // Future: small unsettled margin counts; a "market value" that is really the notional does not.
  const fut = { type: 'future', name: 'OMXS30', qty: -10, price: 2500, multiplier: 100, ccy: 'SEK', underlyingClass: 'equity' };
  close(val({ ...fut, mtm: 12000 }).r.mv, 12000, 1e-9);
  const bad = val({ ...fut, mtm: -2500000 });
  close(bad.r.mv, 0, 1e-9); close(bad.r.net, -2500000, 1e-6);
  assert.ok(bad.warnings.includes('mtm_is_notional'));
  // Option: the file's market value beats the premium, which beats the model; written = negative.
  const opt = { type: 'option', name: 'Call', qty: -5, optType: 'call', strike: 100, maturity: '2027-03-19', underlyingPrice: 100, vol: 20, multiplier: 100, ccy: 'SEK' };
  close(val({ ...opt, price: 8 }).r.mv, -5 * 100 * 8, 1e-9);
  close(val({ ...opt, price: 8, mtm: -4100 }).r.mv, -4100, 1e-9);
  assert.ok(val(opt).warnings.includes('model_value'));
  // OTC: spot-valued forward and model-valued swap say so; with MTM they do not.
  const fwd = { type: 'fx_forward', buyCcy: 'SEK', buyAmount: 11000000, sellCcy: 'EUR', sellAmount: 1000000, maturity: '2027-09-28' };
  assert.ok(val(fwd).warnings.includes('fwd_spot_value'));
  assert.ok(!val({ ...fwd, mtm: -150000, ccy: 'SEK' }).warnings.includes('fwd_spot_value'));
  const irs = { type: 'irs', name: 'IRS', qty: 10000000, ccy: 'SEK', direction: 'pay', fixedRate: 2.5, marketRate: 2.3, maturity: '2031-09-28' };
  assert.ok(val(irs).warnings.includes('model_value'));
  // An option with a counterparty is OTC and counts toward the counterparty limit.
  const withOtc = { ...p, positions: [{ id: 'o', ...opt, qty: 5, price: 8, issuer: 'Bank X' }, { id: 'c', type: 'cash', name: 'Cash', qty: 36000, ccy: 'SEK' }] };
  const comp = compliance(valuePortfolio(withOtc));
  close(comp.rules.find(r => r.id === 'otcCounterparty').value, 4000 / 40000 * 100, 1e-9);
});

test('ECB reference rate files: CSV (daily and history) and XML', async () => {
  const { parseEcbRates } = await import('../js/fxfile.js');
  const csv = 'Date, USD, JPY, BGN, CZK, DKK, GBP, SEK, \n26 September 2026, 1.1234, 165.12, 1.9558, 24.5, 7.4601, 0.8512, 11.052, \n';
  const a = parseEcbRates(csv);
  assert.equal(a.date, '2026-09-26'); close(a.rates.SEK, 11.052, 1e-12); assert.equal(a.rates.EUR, 1);
  const hist = 'Date,USD,JPY,BGN,CZK,DKK,SEK,N/A\n2026-09-26,1.1234,165.12,1.9558,24.5,7.4601,11.052,N/A\n2026-09-25,1.12,165,1.9558,24.4,7.46,11.0,N/A\n';
  assert.equal(parseEcbRates(hist).date, '2026-09-26');
  const xml = `<?xml version="1.0"?><gesmes:Envelope><Cube><Cube time='2026-09-26'><Cube currency='USD' rate='1.1234'/><Cube currency='JPY' rate='165.12'/><Cube currency='SEK' rate='11.052'/><Cube currency='NOK' rate='11.7'/><Cube currency='GBP' rate='0.8512'/></Cube></Cube></gesmes:Envelope>`;
  const x = parseEcbRates(xml);
  assert.equal(x.date, '2026-09-26'); close(x.rates.NOK, 11.7, 1e-12);
  assert.throws(() => parseEcbRates('Name,Price\nA,1'));
});

test('dated files: a maturity column is never taken as the snapshot date; bulk upload finds date and portfolio', async () => {
  const { detectLayout, datedLayout } = await import('../js/sourcefile.js');
  const bonds = parseText('Name,ISIN,Quantity,Price,Currency,Maturity\nSGB 1060,SE0004517290,1000000,101,SEK,2028-05-12\nSGB 1061,SE0004869071,1000000,99,SEK,2029-11-12\n', 'b.csv').sheets[0].rows;
  assert.equal(detectLayout(bonds).error, 'no_date');
  assert.equal(datedLayout(bonds, 0).dateCol, -1);
  const dated = parseText('Name,Datum,Fond,Antal,Kurs,Valuta,Förfallodag\nSGB,2026-08-31,A,1,101,SEK,2028-05-12\nSGB,2026-09-30,A,1,101,SEK,2028-05-12\n', 'd.csv').sheets[0].rows;
  const L = datedLayout(dated, 0);
  assert.equal(L.dateCol, 1); assert.equal(L.pfCol, 2);
  assert.equal(detectLayout(dated).dateCol, 1, 'a column headed Datum counts even when it is not first');
});

test('insights: a coupon paid between two dates is income of the bond, not a flow', async () => {
  const { period } = await import('../js/insights.js');
  const p = newPortfolio({ baseCcy: 'SEK' });
  const bond = { id: 'b', type: 'govt_bond', name: 'SGB', issuer: 'Swedish Government', qty: 1000000, yield: 2.5, coupon: 3, freq: '1', maturity: '2030-03-15', ccy: 'SEK' };
  const cash = q => ({ id: 'c', type: 'cash', name: 'Cash', qty: q, ccy: 'SEK' });
  // The 3 % coupon (30 000) is paid on 15 March, between the two dates, and lands in cash.
  const q = period(p, { date: '2026-02-27', positions: [bond, cash(100000)] }, { date: '2026-03-31', positions: [bond, cash(130000)] });
  close(q.flows, 0, 1, 'coupon is not a subscription');
  assert.ok(q.ret > 0 && q.ret < 0.01, 'about a month of carry: ' + q.ret);
});

test('compliance: a CDS on an index is not one issuer (UCITS art. 51(3)); a single-name CDS is', async () => {
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-09-28' });
  const cash = { id: 'c', type: 'cash', name: 'Cash', qty: 100000000, ccy: 'SEK', issuer: 'Bank A' };
  const cds = (issuer, n) => ({ id: issuer, type: 'cds', name: issuer + ' 5Y', issuer, qty: n, ccy: 'SEK', protection: 'sell', spread: 100, marketSpread: 80, maturity: '2030-12-20', mtm: 0 });
  const idx = compliance(valuePortfolio({ ...p, positions: [cash, cds('iTraxx Europe Main', 20000000)] }));
  close(idx.rules.find(r => r.id === 'issuerMax').value, 0, 1e-9);
  const single = compliance(valuePortfolio({ ...p, positions: [cash, cds('Kering SA', 20000000)] }));
  close(single.rules.find(r => r.id === 'issuerMax').value, 20, 1e-9);
});

test('instrument coverage: European institutional instruments import and value correctly', () => {
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-09-28' });
  const run = (header, row) => {
    const [res] = rowsToPositions([row], autoMapping(header), { decimal: '.' });
    const x = valuePortfolio({ ...p, positions: [{ id: 'x', ...res.pos }] }).rows[0];
    return { type: res.pos.type, r: x.r, errors: res.errors, warnings: x.warnings };
  };
  const H = ['Name', 'Type', 'Quantity', 'Price', 'Currency'];
  // Warrants are one share per unit, not 100.
  const w = run(H, ['ABB call warrant', 'Warrant', 1000, 5, 'SEK']);
  assert.equal(w.type, 'option'); close(w.r.mv, 5000, 1e-9); assert.deepEqual(w.errors, []);
  // Certificates: leverage from the name, sign from BULL/BEAR.
  const bull = run(H, ['BULL OMX X5 AVA', 'Certifikat', 1000, 120, 'SEK']);
  assert.equal(bull.type, 'certificate'); close(bull.r.mv, 120000, 1e-9); close(bull.r.eqDelta, 600000, 1e-6);
  close(run(H, ['BEAR DAX X3 NORDNET', 'Bear certificate', 1000, 50, 'SEK']).r.eqDelta, -150000, 1e-6);
  assert.equal(run(H, ['SEB CP', 'Företagscertifikat', 1000000, 99.5, 'SEK']).type, 'money_market');
  // CFD / TRS: value is the MTM, exposure the notional.
  const cfd = run([...H, 'Market value'], ['CFD Volvo B', 'CFD', 1000, 270, 'SEK', 12000]);
  assert.equal(cfd.type, 'equity_swap'); close(cfd.r.mv, 12000, 1e-9); close(cfd.r.exposure, 270000, 1e-6);
  // Pence: GBp is not GBP.
  close(run(H, ['BP', 'Equity', 10000, 450, 'GBp']).r.mv, 10000 * 4.5 * 11.2 / 0.85, 1);
  // Inflation-linked: index ratio applied.
  const il = run([...H, 'Maturity', 'Coupon', 'Issuer', 'Index ratio'], ['SGB IL', 'Realränteobligation', 10000000, 101, 'SEK', '2032-06-01', 0.125, 'Kingdom of Sweden', 1.32]);
  assert.equal(il.type, 'inflation_linked'); assert.ok(Math.abs(il.r.mv / (10000000 * 1.01 * 1.32) - 1) < 0.002);
  // AT1 perpetual priced to call, not guessed as equity.
  const at1 = run([...H, 'Coupon', 'Issuer', 'Call date'], ['Swedbank AT1', 'AT1', 1000000, 98, 'SEK', 7.5, 'Swedbank AB', '2030-03-17']);
  assert.equal(at1.type, 'corp_bond'); assert.equal(at1.r.fi.workout, 'call'); assert.ok(at1.r.mv > 980000 && at1.r.mv < 1030000);
  // Money market fund, term deposit, repo: no equity risk.
  const mmf = run(H, ['SEB Likviditetsfond', 'Money market fund', 1000, 110, 'SEK']);
  assert.equal(mmf.r.eqDelta, 0); assert.equal(mmf.r.liqDays, 1);
  assert.equal(run([...H, 'Maturity'], ['Term deposit', 'Term deposit', 5000000, '', 'SEK', '2026-12-28']).r.liqDays, 91);
  assert.equal(run(H, ['Reverse repo', 'Reverse repo', 5000000, '', 'SEK']).type, 'repo');
  // Leveraged / inverse ETF, VIX future, STIR future.
  close(run([...H, 'Leverage'], ['Bear OMX', 'Inverse ETF', 1000, 100, 'SEK', -1]).r.eqDelta, -100000, 1e-9);
  const vix = run([...H, 'Multiplier'], ['VIX Oct', 'VIX future', 10, 18, 'USD', 1000]);
  assert.equal(vix.r.eqDelta, 0); close(vix.r.vega, 10 * 1000 * 10, 1e-9);
  const stir = run([...H, 'Multiplier'], ['3M Euribor', 'Euribor future', -100, 97.9, 'EUR', 2500]);
  close(stir.r.ir01.EUR, 2500 * 11.2, 1e-6, 'DV01 = contracts × multiplier × 0.01');
  // Dirty price gives the same value as the matching clean price.
  const clean = run([...H, 'Maturity', 'Coupon', 'Issuer'], ['T', 'Corporate bond', 1000000, 101, 'SEK', '2031-10-07', 3, 'Telia']);
  const dirty = run(['Name', 'Type', 'Quantity', 'Dirty price', 'Currency', 'Maturity', 'Coupon', 'Issuer'], ['T', 'Corporate bond', 1000000, 101 + 3 * 356 / 365, 'SEK', '2031-10-07', 3, 'Telia']);
  close(dirty.r.mv, clean.r.mv, 1);
  // American put is worth at least its intrinsic value.
  const am = run(['Name', 'Type', 'Quantity', 'Currency', 'Strike', 'Maturity', 'Underlying price', 'Volatility', 'Option type', 'Multiplier'], ['ABB put', 'Stock option', 10, 'SEK', 700, '2027-09-17', 500, 25, 'put', 100]);
  assert.ok(am.r.mv >= 200000, 'American put ≥ intrinsic: ' + am.r.mv);
  // Swaptions are modelled; a counterparty MTM still wins for the value. Variance swaps have no model and go in at counterparty value.
  const swpt = run(['Name', 'Type', 'Quantity', 'Currency', 'Market value', 'Strike', 'Maturity', 'Tenor', 'Market rate', 'Volatility'], ['EUR 5y10y payer', 'Swaption', 20000000, 'EUR', 310000, 2.75, '2031-09-28', 10, 2.6, 85]);
  assert.equal(swpt.type, 'swaption'); close(swpt.r.mv, 310000 * 11.2, 1e-6); assert.ok(swpt.r.ir01.EUR > 0, 'payer gains when rates rise');
  const vsw = run(['Name', 'Type', 'Quantity', 'Currency', 'Market value'], ['Var swap', 'Variance swap', 100000, 'EUR', 5000]);
  assert.equal(vsw.type, 'otc'); close(vsw.r.mv, 5000 * 11.2, 1e-6); assert.ok(vsw.r.vega > 0);
  assert.equal(run(['Name', 'Type', 'Quantity', 'Currency', 'Market value'], ['Asian', 'Asian option', 1000000, 'EUR', 5000]).type, 'otc');
  // An unknown type is not valued at all.
  const unk = run(H, ['Mystery', 'Snowflake swap', 1000, 100, 'SEK']);
  assert.equal(unk.type, 'unknown'); assert.equal(unk.r, null);
});

test('pricing: rate options and inflation swaps obey parity and limits', async () => {
  const m = await import('../js/pricing.js');
  // Put-call parity for Bachelier and Black-76.
  const bc = m.bachelier('call', 0.025, 0.02, 2, 0.009), bp = m.bachelier('put', 0.025, 0.02, 2, 0.009);
  close(bc.price - bp.price, 0.005, 1e-12);
  const lc = m.black76('call', 0.03, 0.025, 1.5, 0.3), lp = m.black76('put', 0.03, 0.025, 1.5, 0.3);
  close(lc.price - lp.price, 0.005, 1e-12);
  // Payer − receiver swaption = annuity × (F − K); same for cap − floor per period.
  const pay = m.swaption({ payer: true, F: 0.027, K: 0.025, T: 5, tenor: 10, freq: 1, vol: 0.008 });
  const rec = m.swaption({ payer: false, F: 0.027, K: 0.025, T: 5, tenor: 10, freq: 1, vol: 0.008 });
  close(pay.pv - rec.pv, pay.annuity * 0.002, 1e-12);
  assert.ok(pay.dPVdF > 0 && rec.dPVdF < 0);
  const cap = m.capFloor({ cap: true, F: 0.03, K: 0.03, tenor: 5, freq: 4, vol: 0.009 });
  const flr = m.capFloor({ cap: false, F: 0.03, K: 0.03, tenor: 5, freq: 4, vol: 0.009 });
  close(cap.pv, flr.pv, 1e-12, 'at-the-money cap = floor');
  // Inflation swap at the market breakeven is worth nothing.
  close(m.zcInflationSwap({ T: 10, fixed: 0.022, breakeven: 0.022, rate: 0.025 }).pv, 0, 1e-15);
});

test('pricing: barrier in + out = vanilla; digitals; amortising bonds', async () => {
  const m = await import('../js/pricing.js');
  const [S, T, r, q, v] = [100, 0.75, 0.03, 0.01, 0.25];
  for (const type of ['call', 'put']) for (const [K, H, dir] of [[100, 90, 'down'], [80, 90, 'down'], [100, 115, 'up'], [120, 115, 'up']]) {
    const vanilla = m.bsm(type, S, K, T, r, q, v).price;
    const sum = m.barrierOption(type, dir + '-and-in', S, K, H, T, r, q, v) + m.barrierOption(type, dir + '-and-out', S, K, H, T, r, q, v);
    close(sum, vanilla, 1e-9, `${type} ${dir} K=${K} H=${H}`);
  }
  close(m.barrierOption('call', 'down-and-out', S, 100, 1, T, r, q, v), m.bsm('call', S, 100, T, r, q, v).price, 1e-6, 'far barrier = vanilla');
  assert.equal(m.barrierOption('call', 'down-and-out', 85, 100, 90, T, r, q, v), 0, 'knocked out');
  close(m.digitalOption('call', S, 105, T, r, q, v) + m.digitalOption('put', S, 105, T, r, q, v), Math.exp(-r * T), 1e-12);
  // Amortising: prepayments shorten the life and the duration; price ↔ yield round-trips.
  const slow = m.amortisingAnalytics({ valuationDate: '2026-09-28', maturity: '2046-09-28', couponPct: 4, freq: 12, cpr: 0, yieldPct: 4 });
  const fast = m.amortisingAnalytics({ valuationDate: '2026-09-28', maturity: '2046-09-28', couponPct: 4, freq: 12, cpr: 15, yieldPct: 4 });
  assert.ok(fast.wal < slow.wal && fast.modDur < slow.modDur && slow.wal < 20);
  close(m.amortisingAnalytics({ valuationDate: '2026-09-28', maturity: '2046-09-28', couponPct: 4, freq: 12, cpr: 15, cleanPrice: fast.clean }).ytm, 0.04, 1e-9);
});

test('collateral: repo and securities lending count after haircut toward the counterparty limit', () => {
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-09-28' });
  const cash = { id: 'c', type: 'cash', name: 'Cash', qty: 100000000, ccy: 'SEK', issuer: 'Bank A' };
  const repo = { id: 'r', type: 'repo', name: 'Reverse repo', qty: 10000000, ccy: 'SEK', issuer: 'Dealer X', collateralValue: 10000000, haircut: 2 };
  const sl = { id: 's', type: 'sec_lending', name: 'Loan', qty: 8000000, ccy: 'SEK', issuer: 'Borrower Y', collateralValue: 7000000, haircut: 0 };
  const v = valuePortfolio({ ...p, positions: [cash, repo, sl] });
  const rr = v.valid.find(x => x.pos.id === 'r').r, sr = v.valid.find(x => x.pos.id === 's').r;
  close(rr.cptyExposure, 200000, 1e-6, 'lent 10m − 10m × 98 %'); assert.ok(rr.warnings.includes('under_collateralised'));
  close(sr.mv, 0, 1e-9, 'lent securities stay in the holdings'); close(sr.cptyExposure, 1000000, 1e-6);
  const rule = compliance(v).rules.find(r => r.id === 'otcCounterparty');
  close(rule.value, 1000000 / v.nav * 100, 1e-6, 'largest counterparty is the borrower');
  const bare = valuePortfolio({ ...p, positions: [cash, { ...repo, collateralValue: undefined }] }).valid.find(x => x.pos.id === 'r').r;
  close(bare.cptyExposure, 10000000, 1e-6); assert.ok(bare.warnings.includes('collateral_missing'));
});

test('certificates: knock-out exposure and stop-loss, capital protected delta, autocall at market price', () => {
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-09-28' });
  const val = pos => valuePortfolio({ ...p, positions: [{ id: 'x', ccy: 'SEK', qty: 1000, price: 50, name: 'Cert', type: 'certificate', ...pos }] }).rows[0];
  const mini = val({ certType: 'knock_out', optType: 'call', underlyingPrice: 300, strike: 250, barrier: 260, multiplier: 1 });
  close(mini.r.eqDelta, 1000 * 300, 1e-6, 'full underlying per certificate'); close(mini.r.mv, 50000, 1e-9);
  const hit = val({ certType: 'knock_out', optType: 'call', underlyingPrice: 255, strike: 250, barrier: 260, multiplier: 1 });
  close(hit.r.eqDelta, 0, 1e-9); assert.ok(hit.r.warnings.includes('knocked_out'));
  const short = val({ certType: 'knock_out', optType: 'put', underlyingPrice: 300, strike: 350, barrier: 340 });
  close(short.r.eqDelta, -300000, 1e-6);
  // An autocall has no model: market value, and the issuer's delta typed as leverage.
  const ac = val({ price: 98, leverage: 0.45 });
  close(ac.r.mv, 1000 * 98, 1e-9); close(ac.r.eqDelta, 1000 * 98 * 0.45, 1e-6); assert.ok(!ac.r.model);
  const cp = val({ certType: 'protected', price: 100, underlyingPrice: 100, strike: 100, vol: 20, maturity: '2031-09-28', leverage: 0.8 });
  assert.ok(cp.r.eqDelta > 0 && cp.r.eqDelta < 1000 * 100 * 0.8);
  assert.ok(cp.r.model.price > 100 * Math.exp(-0.025 * 5));
});

test('ABS amortise with CPR: shorter WAL and duration than the same bond held to maturity', () => {
  const p = newPortfolio({ baseCcy: 'EUR', valDate: '2026-09-28' });
  const H = ['Name', 'Type', 'Quantity', 'Price', 'Currency', 'Maturity', 'Coupon', 'Issuer', 'CPR', 'Pool factor'];
  const [res] = rowsToPositions([['Green Lion RMBS', 'RMBS', 10000000, 100, 'EUR', '2056-09-28', 3.5, 'ING', 8, 0.6]], autoMapping(H), { decimal: '.' });
  assert.equal(res.pos.structure, 'amortising');
  const x = valuePortfolio({ ...p, positions: [{ id: 'a', ...res.pos }] }).rows[0];
  close(x.r.mv / 6000000, 1, 0.02, 'outstanding = nominal × pool factor');
  assert.equal(x.r.fi.workout, 'wal'); assert.ok(x.r.fi.wal > 3 && x.r.fi.wal < 12, 'WAL ' + x.r.fi.wal);
  const bullet = valuePortfolio({ ...p, positions: [{ id: 'b', type: 'corp_bond', name: 'Bullet', qty: 6000000, price: 100, ccy: 'EUR', maturity: '2056-09-28', coupon: 3.5, issuer: 'ING' }] }).rows[0];
  assert.ok(x.r.fi.modDur < bullet.r.fi.modDur / 2);
  const noCpr = valuePortfolio({ ...p, positions: [{ id: 'a', ...res.pos, cpr: undefined }] }).rows[0];
  assert.ok(noCpr.r.warnings.includes('cpr_missing'));
});

test('inflation: linkers and inflation swaps load a breakeven factor that the model and stress use', () => {
  const p = newPortfolio({ baseCcy: 'EUR', valDate: '2026-09-28' });
  const il = { id: 'il', type: 'inflation_linked', name: 'OATei', qty: 10000000, price: 100, ccy: 'EUR', maturity: '2036-07-25', coupon: 0.1, issuer: 'France', indexRatio: 1.2 };
  const zc = { id: 'zc', type: 'inflation_swap', name: 'ZC', qty: 10000000, ccy: 'EUR', direction: 'pay', fixedRate: 2.2, breakeven: 2.2, maturity: '2036-09-28' };
  const v = valuePortfolio({ ...p, positions: [il, zc] });
  const [a, b] = ['il', 'zc'].map(id => v.valid.find(x => x.pos.id === id).r);
  assert.ok(a.inf01.EUR > 0, 'linker gains when breakeven widens'); assert.ok(b.inf01.EUR < 0, 'paying inflation loses');
  close(b.mv, 0, 1, 'at-market swap is worth zero');
  const fm = factorModel(v);
  assert.ok(fm.factors.some(f => f.id === 'INF:EUR' && f.group === 'inflation'));
  const up = runStress(valuePortfolio({ ...p, positions: [il] }), [{ id: 't', eq: 0, rates: 0, cs: 0, fxAll: 0, cmd: 0, vol: 0, infl: 50 }])[0];
  close(up.total, a.inf01.EUR * 50, Math.abs(a.inf01.EUR), 'stress = inf01 × bp');
});

test('rate options and barriers: cap/floor sign, knocked-out barrier', () => {
  const p = newPortfolio({ baseCcy: 'EUR', valDate: '2026-09-28' });
  const val = pos => valuePortfolio({ ...p, positions: [{ id: 'x', ccy: 'EUR', name: 'X', ...pos }] }).rows[0].r;
  const cap = val({ type: 'cap_floor', capFloor: 'cap', qty: 50000000, strike: 3, maturity: '2031-09-28', marketRate: 2.5, vol: 90 });
  const floor = val({ type: 'cap_floor', capFloor: 'floor', qty: 50000000, strike: 2, maturity: '2031-09-28', marketRate: 2.5, vol: 90 });
  assert.ok(cap.mv > 0 && cap.ir01.EUR > 0, 'long cap gains when rates rise'); assert.ok(floor.ir01.EUR < 0);
  assert.ok(cap.model.vega > 0, 'rate vega reported on the position'); assert.equal(cap.vega, 0, 'not on the equity vol factor');
  const doc = val({ type: 'exotic_option', exoticKind: 'barrier', optType: 'call', barrierType: 'down-and-out', barrier: 80, strike: 100, qty: 100, underlyingPrice: 78, vol: 25, maturity: '2027-09-28' });
  assert.ok(doc.warnings.includes('knocked_out')); close(doc.mv, 0, 1e-9);
  const live = val({ type: 'exotic_option', exoticKind: 'barrier', optType: 'call', barrierType: 'down-and-out', barrier: 80, strike: 100, qty: 100, underlyingPrice: 100, vol: 25, maturity: '2027-09-28' });
  assert.ok(live.mv > 0 && live.eqDelta > 0);
});

test('modelled OTC types still take a counterparty-MTM-only row, flagged, instead of rejecting it', () => {
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-09-28' });
  const run = (header, row) => {
    const [res] = rowsToPositions([row], autoMapping(header), { decimal: '.' });
    return { res, x: valuePortfolio({ ...p, positions: [{ id: 'x', ...res.pos }] }).rows[0] };
  };
  const sw = run(['Name', 'Type', 'Quantity', 'Currency', 'Market value', 'Delta', 'Duration'], ['EUR 5y10y payer', 'Swaption', 20000000, 'EUR', 310000, -0.42, 8.6]);
  assert.equal(sw.res.pos.type, 'swaption'); assert.deepEqual(validatePosition(sw.res.pos), []);
  close(sw.x.r.mv, 310000 * 11.2, 1e-6); assert.ok(sw.x.r.warnings.includes('model_inputs_missing'));
  const vs = run(['Name', 'Type', 'Quantity', 'Currency', 'Market value'], ['SX5E var swap', 'Variance swap', 100000, 'EUR', -50000]);
  close(vs.x.r.vega, 100000 * 11.2, 1e-6);
  const inf = run(['Name', 'Type', 'Quantity', 'Currency', 'Market value', 'Duration', 'Direction'], ['HICPx 10y', 'Inflation swap', 10000000, 'EUR', 20000, 9.5, 'pay']);
  assert.ok(inf.x.r.inf01.EUR < 0, 'paying inflation loses when breakeven rises'); assert.deepEqual(inf.x.r.ir01, {});
  // Without an MTM the pricing inputs are required.
  assert.ok(validatePosition({ type: 'swaption', qty: 1e6, ccy: 'EUR', payerReceiver: 'payer' }).some(e => e.field === 'strike'));
});

const sum = a => a.reduce((x, y) => x + y, 0);

test('market data: ECB files parse and validate; curve discounts EUR positions; fx by valuation date', async () => {
  const fs = await import('node:fs');
  const md = await import('../js/marketdata.js');
  const read = f => fs.readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
  const m = md.buildMarket({ fxXml: read('ecb-hist-90d.xml'), curveCsv: read('ecb-yc.csv'), estrCsv: read('ecb-estr.csv'), now: '2026-09-28T16:30:00Z' });
  assert.deepEqual(md.validateMarket(m), []);
  assert.equal(m.fx.dates.length, 25); assert.equal(m.fx.dates.at(-1), '2026-09-28'); assert.equal(Object.keys(m.fx.rates).length, 30);
  assert.equal(m.curves.EUR.dates.length, 5); assert.equal(m.curves.EUR.zero[0].length, 11);
  // Titles with commas inside quotes do not shift the columns.
  close(m.curves.EUR.zero.at(-1)[0], 1.9 + 0.35 * Math.log1p(0.25), 1e-6);
  // Rates for a valuation date: the latest on or before it; none for a date before the data.
  assert.equal(md.fxOn(m, '2026-09-27').date, '2026-09-25');
  assert.equal(md.fxOn(m, '2025-01-01'), null);
  assert.equal(md.fxOn(m, '2027-01-01'), null, 'a stale file is not used for a date far after it');
  // Curve: €STR as the overnight point, linear inside, flat outside.
  const c = md.curveOn(m, '2026-09-28');
  close(c.z[0], 0.01915, 1e-12); close(md.zeroAt(c, 50), c.z.at(-1), 1e-12);
  close(md.zeroAt(c, 4), (c.z[c.t.indexOf(3)] + c.z[c.t.indexOf(5)]) / 2, 1e-12);
  // Broken data is caught before publishing.
  assert.ok(md.validateMarket({ ...m, fx: { ...m.fx, rates: { ...m.fx.rates, USD: m.fx.rates.USD.map(() => 45) } } }).length);
  assert.ok(md.validateMarket({ ...m, curves: { EUR: { ...m.curves.EUR, dates: [], zero: [] } } }).length);
  // Pricing: an option without its own rate uses the curve; an IRS annuity discounts on it.
  const p = newPortfolio({ baseCcy: 'EUR', valDate: '2026-09-28' });
  const opt = { id: 'o', type: 'option', name: 'SX5E call', qty: 10, ccy: 'EUR', optType: 'call', strike: 5000, maturity: '2027-09-28', underlyingPrice: 5000, vol: 20, multiplier: 10 };
  const flat = valuePortfolio({ ...p, positions: [opt] }).rows[0].r.mv;
  const withCurve = valuePortfolio({ ...p, curves: { EUR: c }, positions: [opt] }).rows[0].r.mv;
  assert.notEqual(flat, withCurve);
  const own = valuePortfolio({ ...p, curves: { EUR: c }, positions: [{ ...opt, rate: 2.5 }] }).rows[0].r.mv;
  close(own, flat, 1e-9, 'a rate on the position still wins');
  const irs = { id: 's', type: 'irs', name: 'IRS', qty: 1e7, ccy: 'EUR', direction: 'receive', fixedRate: 3, marketRate: 2.5, maturity: '2036-09-28' };
  const a0 = valuePortfolio({ ...p, positions: [irs] }).rows[0].r.mv, a1 = valuePortfolio({ ...p, curves: { EUR: c }, positions: [irs] }).rows[0].r.mv;
  assert.ok(Math.abs(a1 / a0 - 1) < 0.05 && a1 !== a0, 'curve annuity close to, not equal to, the flat one');
  // Bonds: spread over the AAA curve.
  const bond = { id: 'b', type: 'corp_bond', name: 'Corp', qty: 1e6, price: 100, ccy: 'EUR', coupon: 4, freq: '1', maturity: '2031-09-28', issuer: 'X' };
  const fiRow = valuePortfolio({ ...p, curves: { EUR: c }, positions: [bond] }).rows[0].r.fi;
  close(fiRow.curveSpreadBp, (0.04 - (Math.exp(md.zeroAt(c, 5)) - 1)) * 1e4, 1);
  assert.equal(valuePortfolio({ ...p, positions: [bond] }).rows[0].r.fi.curveSpreadBp, null);
});

test('market data sync: only portfolios on placeholder or published ECB rates are updated', async () => {
  const fs = await import('node:fs');
  const md = await import('../js/marketdata.js');
  const { planFor, applyPlan } = await import('../js/marketsync.js');
  const read = f => fs.readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
  const m = md.buildMarket({ fxXml: read('ecb-hist-90d.xml'), curveCsv: read('ecb-yc.csv'), estrCsv: read('ecb-estr.csv'), now: '2026-09-28T16:30:00Z' });
  const fresh = newPortfolio({ valDate: '2026-09-28' });
  const plan = planFor(fresh, m);
  assert.equal(plan.fx.date, '2026-09-28'); assert.equal(plan.curve.date, '2026-09-28');
  applyPlan(fresh, plan);
  assert.equal(fresh.fxSource, 'ecb-auto'); assert.equal(planFor(fresh, m), null, 'nothing more to do');
  assert.equal(planFor({ ...newPortfolio({ valDate: '2026-09-28' }), fxSource: 'manual', curves: fresh.curves }, m), null, 'hand-entered rates are left alone');
  assert.equal(planFor({ ...newPortfolio({ valDate: '2026-09-28' }), fxSource: 'ecb', curves: fresh.curves }, m), null, 'rates from your own ECB file too');
  assert.ok(planFor({ ...fresh, curveMode: 'off' }, m).dropCurve);
  assert.equal(planFor({ ...newPortfolio({ valDate: '2024-01-31' }) }, m), null, 'outside the published window: untouched');
  assert.equal(planFor({ ...newPortfolio({ valDate: '2026-09-28' }), demo: true }, m), null);
});

test('market data: a past snapshot is valued with that date\'s ECB rates when the portfolio follows them', async () => {
  const fs = await import('node:fs');
  const md = await import('../js/marketdata.js');
  const { atSnapshot, setDateRates } = await import('../js/insights.js');
  const { ratesOn } = await import('../js/marketsync.js');
  const read = f => fs.readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
  const m = md.buildMarket({ fxXml: read('ecb-hist-90d.xml'), curveCsv: read('ecb-yc.csv'), estrCsv: read('ecb-estr.csv'), now: '2026-09-28T16:30:00Z' });
  const p = { ...newPortfolio({ valDate: '2026-09-28' }), fxSource: 'ecb-auto' };
  const snap = { date: m.fx.dates[3], positions: [] };
  setDateRates((pp, d) => ratesOn(pp, d, m));
  try {
    assert.equal(atSnapshot(p, snap).fxDate, snap.date);
    close(atSnapshot(p, snap).fxEur.USD, m.fx.rates.USD[3], 1e-12);
    assert.equal(atSnapshot({ ...p, fxSource: 'manual' }, snap).fxEur, p.fxEur, 'manual rates stay');
  } finally { setDateRates(null); }
});

test('stored positions of removed types are migrated, not lost', async () => {
  const { upgradePortfolio } = await import('../js/store.js');
  const p = upgradePortfolio({ positions: [
    { type: 'variance_swap', name: 'Var', qty: 100000, ccy: 'EUR', direction: 'pay', strike: 21, vol: 19, mtm: 1200 },
    { type: 'certificate', name: 'Express', qty: 10, price: 98, ccy: 'SEK', certType: 'autocall', autocallLevel: 100, protectionLevel: 60 }
  ], snapshots: [{ date: '2026-09-01', positions: [{ type: 'variance_swap', name: 'Var', qty: 5, ccy: 'EUR' }] }] });
  const [vs, ac] = p.positions;
  assert.equal(vs.type, 'otc'); assert.equal(vs.underlyingClass, 'volatility'); assert.equal(vs.vega, -100000); assert.equal(vs.mtm, 1200);
  assert.ok(!('strike' in vs));
  assert.deepEqual(validatePosition(vs), []);
  assert.ok(!('certType' in ac) && !('autocallLevel' in ac));
  assert.deepEqual(validatePosition(ac), []);
  assert.equal(p.snapshots[0].positions[0].type, 'otc');
});

test('import model: suggests columns and type codes it has never seen, never a mapped field or an unrelated column', async () => {
  const { readFileSync } = await import('node:fs');
  const S = await import('../js/suggest.js');
  const model = JSON.parse(readFileSync(new URL('../js/models/import-model.json', import.meta.url), 'utf8'));
  const set = JSON.parse(readFileSync(new URL('./fixtures/import-suggest-testset.json', import.meta.url), 'utf8'));
  // Held-out, hand-written headers: floors a little under what training reports, so drift shows.
  const top = (m, feats) => S.scores(m, feats)[0];
  const colHits = set.columns.filter(c => top(model.columns, S.featuresOf(c.header, c.values)).label === c.field).length;
  assert.ok(colHits / set.columns.length >= 0.8, `columns top-1 ${colHits}/${set.columns.length}`);
  const sug = set.columns.map(c => ({ c, b: top(model.columns, S.featuresOf(c.header, c.values)) })).filter(x => x.b.p >= S.MIN_CONFIDENCE && x.b.label !== '__none');
  assert.ok(sug.filter(x => x.b.label === x.c.field).length / sug.length >= 0.9, 'suggestions shown are mostly right');
  const typeHits = set.types.filter(x => top(model.types, S.featuresOf(x.code)).label === x.type).length;
  assert.ok(typeHits / set.types.length >= 0.9, `types top-1 ${typeHits}/${set.types.length}`);
  // Mapping rules: an already mapped field is not suggested again; unrelated columns get nothing.
  const header = ['Security Description', 'Sec Name', 'Mkt Px', 'Row No'];
  const body = [['VOLVO AB-B SHS', 'Volvo B', '252.4', '1'], ['APPLE INC', 'Apple', '231.1', '2'], ['SAAB AB-B', 'Saab B', '480', '3']];
  const out = S.suggestColumns(model.columns, header, body, ['name', '', '', '']);
  assert.ok(!out.some(x => x.field === 'name'), 'name is already mapped');
  assert.ok(out.some(x => x.col === 2 && x.field === 'price'));
  assert.ok(!out.some(x => x.col === 3), 'a row counter is not a field');
  assert.equal(S.suggestType(model.types, 'Grand Total'), null);
  assert.equal(S.suggestType(model.types, 'Index Fut').type, 'future');
  assert.equal(S.looseNumber('1 234,50'), 1234.5); assert.equal(S.looseNumber('1,234.50'), 1234.5); assert.equal(S.looseNumber('(300)'), -300);
});

test('factor model: equity by region and credit by rating', () => {
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-09-28' });
  const eq = (id, country) => ({ id, type: 'equity', name: id, qty: 1000, price: 100, ccy: 'SEK', country, beta: 1 });
  const P = cma => factorModel(valuePortfolio({ ...p, cma: { ...p.cma, equitySpecificVol: 0, ...cma }, positions: [eq('a', 'SE'), eq('b', 'US')] }));
  const one = P({ corrEqRegion: 1 }), two = P({ corrEqRegion: 0.5 });
  assert.deepEqual(one.factors.filter(f => f.group === 'equity').map(f => f.id), ['EQ:nordics', 'EQ:north_america']);
  close(one.sigmaAnnual, 200000 * 0.16, 1e-6, 'fully correlated regions = one factor');
  close(two.sigmaAnnual, 0.16 * Math.sqrt(2 * 100000 ** 2 * 1.5), 1e-6, 'ρ = 0.5 between regions');
  // Same bond, IG vs HY vs unrated: HY carries the HY spread vol; unrated counts as HY and is reported.
  const bond = rating => ({ id: 'x' + rating, type: 'corp_bond', name: 'Bond', issuer: 'X', qty: 1000000, price: 100, ccy: 'SEK', coupon: 4, freq: '1', maturity: '2031-09-28', ...(rating ? { rating } : {}) });
  const vol = rating => factorModel(valuePortfolio({ ...p, positions: [bond(rating)] }));
  const ig = vol('A'), hy = vol('BB'), nr = vol('');
  assert.ok(hy.standalone.credit > ig.standalone.credit * 2, 'HY spread vol');
  close(nr.standalone.credit, hy.standalone.credit, 1e-9);
  assert.equal(nr.unratedAsHy, 1); assert.equal(ig.unratedAsHy, 0);
});

test('risk statistics: EWMA, Ledoit-Wolf, eigen-decomposition and the statistical risk drivers', async () => {
  const R = await import('../js/riskstats.js');
  close(R.ewmaVariance(Array.from({ length: 300 }, (_, i) => (i % 2 ? 2 : -2))), 4, 1e-12);
  // After a calm year a volatile month dominates the EWMA, not the plain variance.
  const calmThenWild = [...Array.from({ length: 250 }, (_, i) => (i % 2 ? 1 : -1)), ...Array.from({ length: 20 }, (_, i) => (i % 2 ? 5 : -5))];
  assert.ok(Math.sqrt(R.ewmaVariance(calmThenWild)) > 3);
  const A = [[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 2]];
  const e = R.eigenSym(A);
  close(e.reduce((s, x) => s + x.value, 0), 9, 1e-12, 'trace');
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(e.reduce((s, x) => s + x.value * x.vector[i] * x.vector[j], 0), A[i][j], 1e-12);
  const rng = mulberry32(3), g = () => gaussian(rng);
  assert.ok(R.ledoitWolf(Array.from({ length: 40 }, () => Array.from({ length: 20 }, g))).shrink > 0.8, 'noise is shrunk hard');
  assert.ok(R.ledoitWolf(Array.from({ length: 2000 }, () => { const f = g(); return Array.from({ length: 5 }, () => f + 0.3 * g()); })).shrink < 0.05, 'real structure is kept');
  const a = fullAnalysis(buildDemo('2026-09-28'));
  const D = a.risk.drivers;
  assert.ok(D && D.n >= 5);
  close(D.components.reduce((s, c) => s + c.share, 0), 1, 1e-9, 'shares add up');
  assert.ok(D.effective >= 1 && D.effective <= D.n && D.n80 >= 1 && D.n80 <= D.n);
  const E = a.risk.ewma;
  assert.ok(E && E.var > 0 && E.halfLife > 10 && E.halfLife < 12);
  const sumContrib = E.byPosition.reduce((s, b) => s + b.contrib, 0);
  assert.ok(Math.abs(sumContrib / E.sigmaAnnual - 1) < 0.05, 'EWMA contributions add up to the EWMA vol (up to the seed window)');
  const p = buildDemo('2026-09-28'); p.risk.method = 'ewma';
  assert.equal(fullAnalysis(p).risk.headline.method, 'ewma');
});

test('data checks: unit errors, scaled quantities, jumps, stale and missing prices; a clean file has none', async () => {
  const { checkHoldings } = await import('../js/datachecks.js');
  const p = buildDemo('2026-09-28');
  const prev = p.positions;
  const same = checkHoldings(prev, JSON.parse(JSON.stringify(prev)), { p, prevDate: '2026-09-25', nextDate: '2026-09-28', complete: true });
  assert.equal(same.flags.length, 0);
  const next = JSON.parse(JSON.stringify(prev));
  next.forEach((x, i) => { if (isNum(x.price)) x.price *= 1 + (i % 5 - 2) * 0.002; });
  const eq = next.filter(x => x.type === 'equity');
  eq[0].price *= 100; eq[1].price *= 1.4; eq[2].qty *= 1000; eq[3].ccy = 'EUR';
  next.find(x => x.type === 'corp_bond').price = undefined;
  const r = checkHoldings(prev, next, { p, prevDate: '2026-09-25', nextDate: '2026-09-28' });
  const kinds = Object.fromEntries(r.flags.map(f => [f.name + '|' + f.kind, f.severity]));
  assert.equal(kinds[eq[0].name + '|unit'], 'error');
  assert.equal(kinds[eq[1].name + '|jump'], 'warn');
  assert.equal(kinds[eq[2].name + '|qty_scale'], 'warn');
  assert.equal(kinds[eq[3].name + '|ccy'], 'error');
  assert.ok(r.flags.some(f => f.kind === 'price_missing'));
  assert.equal(r.flags.length, 5, r.flags.map(f => f.kind + ' ' + f.name).join('; '));
  // No history: the cross-section of the file decides. One stock up 40 % while ten move ±1 %.
  const stocks = Array.from({ length: 11 }, (_, i) => ({ type: 'equity', name: 'S' + i, qty: 100, price: 100, ccy: 'SEK' }));
  const moved = stocks.map((x, i) => ({ ...x, price: i === 0 ? 140 : 100 * (1 + ((i % 3) - 1) * 0.01) }));
  const q = newPortfolio({ baseCcy: 'SEK' });
  const cs = checkHoldings(stocks, moved, { p: q, prevDate: '2026-09-25', nextDate: '2026-09-28' });
  assert.deepEqual(cs.flags.map(f => f.name + ' ' + f.kind + ' ' + f.detail.basis), ['S0 jump file']);
  // Stale: unchanged for a week while the others moved.
  const week = stocks.map((x, i) => ({ ...x, price: i === 5 ? 100 : 100 * (1 + (i % 2 ? 0.01 : -0.01)) }));
  assert.deepEqual(checkHoldings(stocks, week, { p: q, prevDate: '2026-09-18', nextDate: '2026-09-28' }).flags.map(f => f.name + ' ' + f.kind), ['S5 stale']);
  // A complete file without a 5 %+ holding.
  const big = checkHoldings(prev, next.filter(x => x.name !== eq[5].name), { p, prevDate: '2026-09-25', nextDate: '2026-09-28', complete: true });
  const w = valuePortfolio(p).valid.find(x => x.pos.name === eq[5].name).weight;
  assert.equal(big.flags.some(f => f.kind === 'dropped' && f.name === eq[5].name), w >= 0.05);
});

test('fund rules: conditions, measures and statuses; they flow into compliance and its breach history', async () => {
  const R = await import('../js/rules.js');
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-09-28' });
  const eq = (name, country, sector, mv) => ({ id: name, type: 'equity', name, issuer: name, qty: mv / 100, price: 100, ccy: 'SEK', country, sector });
  const bond = (name, rating, mv) => ({ id: name, type: 'corp_bond', name, issuer: name, qty: mv, price: 100, ccy: 'SEK', coupon: 3, freq: '1', maturity: '2030-09-28', rating });
  p.positions = [eq('A', 'SE', 'Industrials', 400), eq('B', 'US', 'Tech', 200), eq('C', 'SE', 'Industrials', 100), bond('D', 'BBB', 200), bond('E', 'BB+', 100)];
  const v = valuePortfolio(p);
  const val = rule => R.measureRule(v, R.newRule(rule)).value;
  close(val({ measure: 'weight', conds: [{ dim: 'region', op: 'in', values: ['nordics'] }] }), 50, 1e-9);
  close(val({ measure: 'weight', conds: [{ dim: 'region', op: 'notin', values: ['nordics'] }, { dim: 'assetClass', op: 'in', values: ['equity'] }] }), 20, 1e-9);
  close(val({ measure: 'maxGroup', groupBy: 'sector', conds: [{ dim: 'assetClass', op: 'in', values: ['equity'] }] }), 50, 1e-9);
  close(val({ measure: 'maxPosition' }), 40, 1e-9);
  assert.equal(val({ measure: 'count', conds: [{ dim: 'rating', op: 'below', values: ['BBB-'] }, { dim: 'assetClass', op: 'in', values: ['fixed_income'] }] }), 1);
  assert.equal(val({ measure: 'count', conds: [{ dim: 'rating', op: 'in', values: ['HY'] }] }), 1);
  assert.equal(val({ measure: 'count', conds: [{ dim: 'name', op: 'contains', values: ['b'] }] }), 1);
  assert.ok(val({ measure: 'duration' }) > 1, 'bond duration shows');
  assert.equal(R.ruleStatus(10.5, 10, 'max'), 'breach'); assert.equal(R.ruleStatus(9.5, 10, 'max'), 'warn'); assert.equal(R.ruleStatus(5, 10, 'max'), 'ok');
  assert.equal(R.ruleStatus(89, 90, 'min'), 'breach'); assert.equal(R.ruleStatus(0, 0, 'max'), 'ok'); assert.equal(R.ruleStatus(1, 0, 'max'), 'breach');
  // In compliance, with the user's name and unit; switched-off rules are skipped.
  p.rules = [R.newRule({ name: 'Nordic at least 60 %', measure: 'weight', dir: 'min', limit: 60, conds: [{ dim: 'region', op: 'in', values: ['nordics'] }] }), R.newRule({ name: 'Off', on: false, measure: 'count', limit: 0 })];
  const comp = compliance(valuePortfolio(p));
  const fr = comp.rules.filter(r => r.custom);
  assert.equal(fr.length, 1); assert.equal(fr[0].label, 'Nordic at least 60 %'); assert.equal(fr[0].status, 'breach'); assert.equal(fr[0].unit, '%');
  const { breachHistory } = await import('../js/insights.js');
  const snaps = [{ date: '2026-09-25', positions: p.positions }, { date: '2026-09-28', positions: p.positions }];
  const h = breachHistory(p, snaps);
  assert.ok(h.episodes.some(e => e.id === fr[0].id), 'a fund rule has a breach history');
});

test('global exposure: VaR approach replaces commitment, relative VaR against a reference series, backtest and Kupiec', async () => {
  const G = await import('../js/globalexposure.js');
  // Kupiec against known values: 2 of 250 at 1 % fits, 10 of 250 does not.
  close(G.kupiec(10, 250, 0.01).lr, 12.955, 1e-3);
  assert.ok(G.kupiec(2, 250, 0.01).pValue > 0.5 && G.kupiec(10, 250, 0.01).pValue < 0.001);
  assert.deepEqual([0, 4, 5, 9, 10].map(G.zoneOf), ['green', 'green', 'yellow', 'yellow', 'red']);
  const p = buildDemo('2026-09-28');
  const base = compliance(valuePortfolio(p));
  assert.ok(base.rules.some(r => r.id === 'commitment') && !base.rules.some(r => r.id.startsWith('var')));
  p.globalExposure = { method: 'absoluteVar' };
  const v = valuePortfolio(p);
  const comp = compliance(v);
  assert.ok(!comp.rules.some(r => r.id === 'commitment'), 'commitment limit does not apply under the VaR approach');
  const abs = comp.rules.find(r => r.id === 'varAbs');
  const fv = G.fundVar(v);
  assert.equal(fv.model, 'historical'); assert.ok(fv.obs >= 250);
  close(abs.value, fv.pct, 1e-12); close(fv.pct, fv.pct1d * Math.sqrt(20), 1e-9, '√20 scaling');
  // Relative: the reference series is a price series in the history.
  const key = p.benchmark || Object.keys(p.history.series)[0];
  p.globalExposure = { method: 'relativeVar', reference: key };
  const rel = compliance(valuePortfolio(p)).rules.find(r => r.id === 'varRel');
  const ref = G.referenceVar(valuePortfolio(p));
  close(rel.value, fv.pct / ref.pct, 1e-9); assert.equal(rel.unit, '×');
  // Backtest on the demo history: 250 test days, exceptions counted against the rolling VaR.
  const bt = G.backtest(v);
  assert.equal(bt.n, 250);
  assert.equal(bt.exceptions, bt.rows.filter(r => r.pnl < -r.var).length);
  assert.ok(bt.rows.every(r => r.var > 0));
  // A past valuation date never sees later prices.
  const past = valuePortfolio({ ...p, valDate: p.history.dates[p.history.dates.length - 60] });
  assert.equal(G.backcast(past).dates.at(-1), p.history.dates[p.history.dates.length - 60]);
});

test('liquidity tools: selection rule, swing factor and dilution, gates', async () => {
  const L = await import('../js/lmt.js');
  assert.equal(L.lmtCheck({ ...L.LMT_DEFAULTS, selected: ['swing'] }).ok, false);
  assert.equal(L.lmtCheck({ ...L.LMT_DEFAULTS, selected: ['swing', 'suspension'] }).ok, false, 'suspension does not count');
  assert.equal(L.lmtCheck({ ...L.LMT_DEFAULTS, selected: ['swing', 'gates'] }).ok, true);
  assert.equal(L.lmtCheck({ ...L.LMT_DEFAULTS, selected: ['swing'], mmf: true }).ok, true, 'one is enough for a money market fund');
  assert.equal(L.lmtCheck({ ...L.LMT_DEFAULTS, selected: ['swing', 'adl'] }).antiDilutionOverlap, true);
  // Two equal holdings at 10 bp and 30 bp and 50 % cash → 10 bp average cost per unit traded.
  const p = newPortfolio({ baseCcy: 'SEK', valDate: '2026-09-28' });
  p.positions = [
    { id: 'a', type: 'equity', name: 'A', qty: 250, price: 100, ccy: 'SEK' },
    { id: 'b', type: 'corp_bond', name: 'B', issuer: 'B', qty: 25000, price: 100, ccy: 'SEK', coupon: 3, freq: '1', maturity: '2030-09-28' },
    { id: 'c', type: 'cash', name: 'Cash', qty: 50000, ccy: 'SEK' }
  ];
  const v = valuePortfolio(p);
  const cfg = { ...L.lmtSettings(p), costs: { equity: 10, corp_bond: 30 }, impact: false, flows: [10], materialityBp: 5 };
  const s = L.swingAnalysis(v, cfg);
  const aw = v.valid.find(x => x.pos.id === 'a').r.mv, bw = v.valid.find(x => x.pos.id === 'b').r.mv, tot = aw + bw + 50000;
  const f = (aw * 10 + bw * 30) / tot;
  close(s.table[0].factor, f, 1e-9); close(s.table[0].factorStressed, 3 * f, 1e-9);
  close(s.table[0].dilution, 0.1 * f / 0.9, 1e-9);
  close(s.threshold, Math.ceil(1000 * 5 / (5 + f)) / 10, 0.1 + 1e-9, 'threshold where f·x/(1−x) = 5 bp');
  const g = L.gateAnalysis(v, { ...cfg, gatePct: 10 });
  const r30 = g.normal.find(r => r.request === 30);
  assert.equal(r30.days, 3); close(r30.firstDay, 10, 1e-9); close(r30.deferred, 20, 1e-9);
  assert.equal(g.normal.find(r => r.request === 5).gated, false);
});
