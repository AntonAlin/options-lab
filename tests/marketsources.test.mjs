import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ms from '../js/marketsources.js';
import * as md from '../js/marketdata.js';
import { planFor, applyPlan, checkMarketUrl } from '../js/marketsync.js';
import { newPortfolio } from '../js/store.js';
import { valuePortfolio } from '../js/analytics.js';

const read = f => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);
const ecb = () => ({ fxXml: read('ecb-hist-90d.xml'), curveCsv: read('ecb-yc.csv'), estrCsv: read('ecb-estr.csv'), now: '2026-09-28T16:30:00Z' });

// A fake network: the fixture whose key appears in the URL, else a 404. Records what was asked.
function fakeCtx(map, extra = {}) {
  const asked = [];
  return {
    asked, today: new Date('2026-09-28T16:00:00Z'), env: {}, sleep: async () => {}, warn: () => {},
    get: async (url, opts = {}) => {
      asked.push({ url, ...opts });
      const hit = Object.entries(map).find(([k]) => url.includes(k));
      if (!hit) throw new Error(`${opts.label || url}: HTTP 404`);
      return read(hit[1]);
    },
    ...extra
  };
}

test('market sources: tenors, dates, numbers and compounding', () => {
  assert.equal(ms.parseTenor('3 Mo'), 0.25); assert.equal(ms.parseTenor('1.5 Month'), 0.125); assert.equal(ms.parseTenor('10 Yr'), 10);
  assert.equal(ms.parseTenor('12M'), 1); assert.equal(ms.parseTenor('2W'), 14 / 365); assert.equal(ms.parseTenor('ON'), 1 / 365);
  assert.equal(ms.parseTenor('3 years'), 3); assert.equal(ms.parseTenor('Date'), null); assert.equal(ms.parseTenor(''), null);
  assert.equal(ms.toIsoDate('09/28/2026', 'mdy'), '2026-09-28'); assert.equal(ms.toIsoDate('28/09/2026', 'dmy'), '2026-09-28');
  assert.equal(ms.toIsoDate('28.09.2026'), '2026-09-28'); assert.equal(ms.toIsoDate('01 Sep 2026'), '2026-09-01');
  assert.equal(ms.toIsoDate('2026-9-1'), '2026-09-01'); assert.equal(ms.toIsoDate('13/13/2026', 'mdy'), ''); assert.equal(ms.toIsoDate('soon'), '');
  assert.equal(ms.toNumber('2,35'), 2.35); assert.equal(ms.toNumber('2.35%'), 2.35); assert.ok(Number.isNaN(ms.toNumber('.'))); assert.ok(Number.isNaN(ms.toNumber('')));
  close(ms.toContinuous(4, 'annual'), Math.log(1.04) * 100, 1e-12);
  close(ms.toContinuous(4, 'semiannual'), 2 * Math.log(1.02) * 100, 1e-12);
  close(ms.toContinuous(4, 'simple', 0.5), Math.log(1.02) / 0.5 * 100, 1e-12);
  assert.equal(ms.toContinuous(4), 4);
  assert.throws(() => ms.toContinuous(4, 'weekly'));
});

test('market sources: wide, long and one-series-per-download layouts', () => {
  // Wide (US Treasury): month-first slash dates, every tenor column found from its header.
  const wide = ms.observations(ms.readRecords(read('ust-2026.csv')), { dateFormat: 'mdy' });
  assert.ok(wide.some(o => o.date === '2026-09-28' && o.tenor === 30 && o.value === 4.4));
  assert.equal(new Set(wide.map(o => o.tenor)).size, 14);
  // Long (Norges Bank): ; separated, code and label columns side by side; the code column is used.
  const long = ms.observations(ms.readRecords(read('norgesbank.csv')), { tenorField: 'TENOR', valueField: 'OBS_VALUE', dateField: 'TIME_PERIOD' });
  assert.deepEqual([...new Set(long.map(o => o.tenor))].sort((a, b) => a - b), [0.25, 0.5, 1, 3, 5, 10]);
  // Filter: only the government bonds.
  const gbon = ms.observations(ms.readRecords(read('norgesbank.csv')), { filter: { INSTRUMENT_TYPE: 'GBON' } });
  assert.deepEqual([...new Set(gbon.map(o => o.tenor))].sort((a, b) => a - b), [3, 5, 10]);
  // JSON at a path, one tenor given from outside; "." (missing) is skipped.
  const fred = ms.observations(ms.readRecords(read('fred-10Y.json'), { path: 'observations' }), { tenor: 10 });
  assert.deepEqual(fred.map(o => o.date), ['2026-09-24', '2026-09-28']);
  // Decimals given as fractions.
  assert.equal(ms.observations([{ date: '2026-09-28', '1Y': 0.025 }], { unit: 'decimal' })[0].value, 2.5);
  // Column order decided from the whole column: a day above 12 in the first place means day first.
  assert.equal(ms.observations([{ Date: '03/04/2026', '1Y': 1 }, { Date: '25/04/2026', '1Y': 1 }])[0].date, '2026-04-03');
  assert.deepEqual(ms.readRecords('not json', { format: 'json' }), []);
  assert.deepEqual(ms.observations([]), []);
});

test('market sources: curve from observations keeps complete days on the newest tenors', () => {
  const obs = ms.observations(ms.readRecords(read('ust-2026.csv')), { dateFormat: 'mdy' });
  const c = ms.curveFromObs(obs, { compounding: 'semiannual' });
  assert.equal(c.tenors.length, 14); assert.equal(c.tenors[0], 1 / 12); assert.equal(c.tenors.at(-1), 30);
  assert.ok(!c.dates.includes('2026-09-23'), 'a day with a gap is not complete');
  assert.equal(c.dates.at(-1), '2026-09-28');
  close(c.zero.at(-1).at(-1), 2 * Math.log(1 + 4.4 / 200) * 100, 1e-12);
  assert.equal(ms.curveFromObs([]), null);
});

test('market sources: built-in US Treasury and Norges Bank providers build valid parts', async () => {
  const ctx = fakeCtx({ 'daily-treasury-rates.csv/2025': 'ust-2025.csv', 'daily-treasury-rates.csv/2026': 'ust-2026.csv', 'sofr/last': 'nyfed-sofr.json', 'GOVT_GENERIC_RATES': 'norgesbank.csv' });
  const us = ms.BUILTIN.ustreasury.build(await ms.BUILTIN.ustreasury.fetch(ctx));
  assert.equal(us.ccy, 'USD'); assert.equal(us.id, 'ustreasury');
  assert.deepEqual(md.validatePart(us, '2026-09-28T16:30:00Z'), []);
  assert.ok(us.curve.dates.includes('2026-09-28') && !us.curve.dates.includes('2025-12-31'), 'last year\'s file lacks the newer 1.5-month tenor');
  assert.equal(us.overnight.values.at(-1), 4.05);
  assert.ok(ctx.asked.some(a => a.url.includes('/2025/')) && ctx.asked.some(a => a.url.includes('/2026/')), 'both yearly files');
  const no = ms.BUILTIN.norgesbank.build(await ms.BUILTIN.norgesbank.fetch(ctx));
  assert.equal(no.ccy, 'NOK'); assert.deepEqual(no.curve.tenors, [0.25, 0.5, 1, 3, 5, 10]);
  assert.deepEqual(md.validatePart(no, '2026-09-28T16:30:00Z'), []);
  close(no.curve.zero.at(-1).at(-1), Math.log(1.0395) * 100, 1e-12);
  assert.ok(ctx.asked.find(a => a.url.includes('GOVT')).url.includes('startPeriod=2026-06-20'), '{from} is 100 days back');
  // One yearly file missing (early January): the other one is enough.
  const jan = fakeCtx({ 'daily-treasury-rates.csv/2026': 'ust-2026.csv' });
  assert.ok(ms.BUILTIN.ustreasury.build(await ms.BUILTIN.ustreasury.fetch(jan)).curve.dates.length);
  // Nothing at all: the provider fails, it does not build an empty part.
  await assert.rejects(ms.BUILTIN.ustreasury.fetch(fakeCtx({})));
  // Stale or broken data does not validate.
  assert.ok(md.validatePart(us, '2026-10-20T16:00:00Z').length, 'stale');
  assert.ok(md.validatePart({ ...us, curve: { ...us.curve, zero: us.curve.zero.map(r => r.map(() => 40)) } }, '2026-09-28').length);
  assert.ok(md.validatePart({ ...us, overnight: { dates: ['2026-09-28'], values: [99] } }, '2026-09-28').length);
});

test('market sources: a custom provider with a key from the environment, one download per tenor', async () => {
  const cfg = {
    providers: [], custom: [{
      id: 'fred-cad', ccy: 'CAD', name: 'FRED', attribution: 'Canadian rates: FRED.',
      curve: { series: Object.fromEntries(['3M', '1Y', '5Y', '10Y'].map(t => [t, `https://api.example.org/series?id=${t}&api_key=\${FRED_API_KEY}&file_type=json`])), format: 'json', path: 'observations', compounding: 'annual', pauseMs: 10 }
    }]
  };
  const { providers, errors } = ms.resolveProviders(cfg);
  assert.deepEqual(errors, []);
  const [p] = providers;
  assert.equal(p.id, 'custom:fred-cad'); assert.deepEqual(p.needs, ['FRED_API_KEY']);
  let slept = 0;
  const ctx = fakeCtx({ 'id=3M': 'fred-3M.json', 'id=1Y': 'fred-1Y.json', 'id=5Y': 'fred-5Y.json', 'id=10Y': 'fred-10Y.json' }, { env: { FRED_API_KEY: 's3cr et' }, sleep: async ms => { slept += ms; } });
  const part = p.build(await p.fetch(ctx));
  assert.deepEqual(part.curve.tenors, [0.25, 1, 5, 10]); assert.deepEqual(part.curve.dates, ['2026-09-24', '2026-09-28'], 'the day with missing values is not complete');
  assert.deepEqual(md.validatePart(part, '2026-09-28T16:30:00Z'), []);
  assert.equal(slept, 30, 'a pause between downloads');
  // The key is in the URL that is fetched, never in what is logged; the published source is the template.
  assert.ok(ctx.asked.every(a => a.url.includes('api_key=s3cr%20et') && a.label.includes('${FRED_API_KEY}')));
  assert.ok(!part.source.includes('s3cr'));
  // Into the file: the CAD curve with its source, next to EUR; it discounts CAD positions.
  const m = md.buildMarket({ ...ecb(), parts: [part] });
  assert.deepEqual(md.validateMarket(m), []);
  assert.equal(m.curves.CAD.source, 'custom:fred-cad'); assert.ok(m.attribution.includes('FRED'));
  assert.deepEqual(m.providers, ['ecb', 'custom:fred-cad']);
  const pf = newPortfolio({ baseCcy: 'SEK', valDate: '2026-09-28' });
  applyPlan(pf, planFor(pf, m));
  assert.equal(pf.curves.CAD.source, 'custom:fred-cad');
  const opt = { id: 'o', type: 'option', name: 'CAD call', qty: 10, ccy: 'CAD', optType: 'call', strike: 100, maturity: '2027-09-28', underlyingPrice: 100, vol: 20, multiplier: 100 };
  assert.notEqual(valuePortfolio({ ...pf, positions: [opt] }).rows[0].r.mv, valuePortfolio({ ...pf, curves: undefined, positions: [opt] }).rows[0].r.mv);
  // The provider gone from the file: its curve is dropped from the portfolio.
  assert.deepEqual(planFor(pf, md.buildMarket(ecb())).drop, ['CAD']);
});

test('market sources: configuration is checked and one currency has one provider', () => {
  const d = ms.resolveProviders();
  assert.deepEqual(d.providers.map(p => p.id), ['riksbank', 'ustreasury', 'norgesbank']);
  assert.deepEqual(d.providers.map(p => p.strict), [true, false, false]);
  const bad = ms.resolveProviders({ providers: ['riksbank', 'bloomberg'], custom: [
    { id: 'Bad Id', ccy: 'usd', curve: { url: 'http://insecure.example/x.csv' } },
    { id: 'eur', ccy: 'EUR', curve: { url: 'https://x.example/e.csv' } },
    { id: 'sek2', ccy: 'SEK', curve: { url: 'https://x.example/s.csv', compounding: 'weird' } },
    { id: 'sek3', ccy: 'SEK', curve: { url: 'https://x.example/s.csv' } },
    { id: 'nocurve', ccy: 'DKK' }
  ] });
  assert.deepEqual(bad.providers.map(p => p.id), ['riksbank'], 'only the good ones, first per currency');
  const e = bad.errors.join('\n');
  for (const s of ['unknown provider "bloomberg"', 'lower-case', 'three-letter', 'https://', 'EUR comes from the ECB', 'unknown compounding', 'SEK already comes from riksbank', 'curve is missing']) assert.ok(e.includes(s), s);
  assert.deepEqual(ms.resolveProviders(undefined, { only: ['ustreasury'] }).providers.map(p => p.id), ['ustreasury']);
  // The config shipped with the repository is valid.
  const shipped = JSON.parse(read('../../market-sources.json'));
  assert.deepEqual(ms.resolveProviders(shipped).errors, []);
});

test('market data file: parts never replace EUR or an earlier provider; old files still read', () => {
  const fake = { id: 'custom:x', ccy: 'EUR', curve: { tenors: [1, 10], dates: ['2026-09-28'], zero: [[9, 9]] } };
  const m = md.buildMarket({ ...ecb(), parts: [fake, { ...fake, ccy: 'usd' }, { ...fake, ccy: 'GBP', curve: { ...fake.curve, dates: [] } }] });
  assert.equal(m.curves.EUR.source, 'ecb'); assert.equal(m.curves.GBP, undefined); assert.equal(m.curves.usd, undefined);
  // Riksbank through the old `sek` argument and as a part give the same file.
  const rb = JSON.parse(read('riksbank.json'));
  const sek = { series: Object.fromEntries(Object.entries(rb.series).map(([k, v]) => [k, JSON.stringify(v)])), swestr: JSON.stringify(rb.swestr) };
  const viaPart = md.buildMarket({ ...ecb(), parts: [ms.BUILTIN.riksbank.build(sek)] });
  assert.deepEqual(viaPart, md.buildMarket({ ...ecb(), sek }));
  assert.deepEqual(md.validateSek(viaPart), []);
  // Overnight points: SOFR for USD from m.overnight, SWESTR from its own key.
  const us = { id: 'ustreasury', ccy: 'USD', curve: { tenors: [0.25, 10], dates: ['2026-09-28'], zero: [[4, 4.2]] }, overnight: { dates: ['2026-09-28'], values: [4.05] } };
  const both = md.buildMarket({ ...ecb(), sek, parts: [us] });
  close(md.curveOn(both, '2026-09-28', 'USD').z[0], 0.0405, 1e-12);
  assert.equal(md.curveOn(both, '2026-09-28', 'USD').t[0], 1 / 365);
  close(md.curveOn(both, '2026-09-28', 'SEK').z[0], 0.01755, 1e-12);
  // A file from before curves carried their source: EUR and SEK are still recognised as published.
  const old = JSON.parse(JSON.stringify(both)); delete old.curves.EUR.source; delete old.curves.SEK.source;
  const pf = newPortfolio({ valDate: '2026-09-28' });
  applyPlan(pf, planFor(pf, old));
  assert.equal(pf.curves.EUR.source, 'ecb'); assert.equal(pf.curves.SEK.source, 'riksbank'); assert.equal(pf.curves.USD.source, 'ustreasury');
  assert.ok(md.isPublishedSource('custom:anything') && !md.isPublishedSource('manual') && !md.isPublishedSource(undefined));
});

test('market data url: only https, a path on the site, or http on this computer', () => {
  assert.equal(checkMarketUrl(''), '');
  assert.equal(checkMarketUrl(' data/market.json '), 'data/market.json');
  assert.equal(checkMarketUrl('https://rates.intra.example/market.json'), 'https://rates.intra.example/market.json');
  assert.equal(checkMarketUrl('http://localhost:8080/market.json'), 'http://localhost:8080/market.json');
  for (const bad of ['http://rates.example/m.json', 'javascript:alert(1)', '//evil.example/m.json', 'file:///etc/passwd', 'data:application/json,{}', 'a b']) assert.equal(checkMarketUrl(bad), null, bad);
});
