// Fetch the ECB's and the Riksbank's public market data and write data/market.json for the site.
//   node scripts/market-data.mjs [out.json] [--check] [--strict]
// --check validates without writing (used by CI on every push). Exits non-zero on any problem with
// the ECB data, so a broken download is never published over the previous day's good file. The
// Swedish curve is optional: a Riksbank problem drops it from the file with a warning, and fails
// the run only with --strict (CI's market data job, which does not block anything).
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SOURCES, curveUrl, buildMarket, validateMarket, validateSek, SE_TENORS, riksbankUrl, swestrUrl } from '../js/marketdata.js';

const args = process.argv.slice(2);
const check = args.includes('--check');
const strict = args.includes('--strict');
const out = args.find(a => !a.startsWith('--')) || 'data/market.json';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    let status = 0;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'nexus-portfolio-lab market data (GitHub Actions)', Accept: 'application/json, text/csv, text/xml, */*' } });
      status = res.status;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i >= tries || status === 404) throw new Error(`${url}: ${e.message}`);
      // Rate limited: wait out the minute rather than hammering.
      await sleep(status === 429 ? 61000 : 2000 * 2 ** (i - 1));
    }
  }
}

// The Riksbank allows only a few calls a minute without an API key, so one at a time with a pause.
async function riksbank() {
  const iso = d => d.toISOString().slice(0, 10);
  const to = iso(new Date()), from = iso(new Date(Date.now() - 100 * 864e5));
  const series = {};
  for (const id of Object.keys(SE_TENORS)) {
    try { series[id] = await get(riksbankUrl(id, from, to)); }
    catch (e) { console.warn(`Riksbank ${id}: ${e.message}`); }
    await sleep(13000);
  }
  let swestr = null;
  try { swestr = await get(swestrUrl(from)); } catch (e) { console.warn(`SWESTR: ${e.message}`); }
  return { series, swestr };
}

const [fxXml, curveCsv, estrCsv, sek] = await Promise.all([get(SOURCES.fx), get(curveUrl()), get(SOURCES.estr), riksbank().catch(e => { console.warn('Riksbank: ' + e.message); return null; })]);
const market = buildMarket({ fxXml, curveCsv, estrCsv, sek });
const errs = validateMarket(market);
const sekErrs = validateSek(market);
if (sekErrs.length) {
  console.warn('Swedish curve left out:\n - ' + sekErrs.join('\n - '));
  delete market.curves.SEK; delete market.swestr;
} else {
  const s = market.curves.SEK;
  console.log(`SEK curve: ${s.dates.length} days to ${s.dates.at(-1)}; latest ${s.tenors.map((t, i) => `${+t.toFixed(2)}y ${s.zero.at(-1)[i].toFixed(3)}`).join(', ')}; SWESTR ${market.swestr.values.at(-1) ?? '–'}`);
}
const c = market.curves.EUR;
console.log(`FX: ${market.fx.dates.length} days to ${market.fx.dates.at(-1)}, ${Object.keys(market.fx.rates).length} currencies`);
console.log(`AAA curve: ${c.dates.length} days to ${c.dates.at(-1)}; latest ${c.tenors.map((t, i) => `${t}y ${c.zero.at(-1)?.[i]?.toFixed(3)}`).join(', ')}`);
console.log(`€STR: ${market.estr.dates.length} days to ${market.estr.dates.at(-1)}, latest ${market.estr.values.at(-1)}`);
if (errs.length) { console.error('Market data failed validation:\n - ' + errs.join('\n - ')); process.exit(1); }
if (strict && sekErrs.length) { console.error('--strict: the Swedish curve did not validate'); process.exit(1); }
if (check) { console.log('OK (check only, nothing written)'); process.exit(0); }
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(market));
console.log(`Wrote ${out}`);
