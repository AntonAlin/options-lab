// Fetch the ECB's public market data and write data/market.json for the site.
//   node scripts/market-data.mjs [out.json] [--check]
// --check validates without writing (used by CI on every push). Exits non-zero on any problem, so a
// broken download is never published over the previous day's good file.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SOURCES, curveUrl, buildMarket, validateMarket } from '../js/marketdata.js';

const args = process.argv.slice(2);
const check = args.includes('--check');
const out = args.find(a => !a.startsWith('--')) || 'data/market.json';

async function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'nexus-portfolio-lab market data (GitHub Actions)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000 * 2 ** (i - 1)));
    }
  }
}

const [fxXml, curveCsv, estrCsv] = await Promise.all([get(SOURCES.fx), get(curveUrl()), get(SOURCES.estr)]);
const market = buildMarket({ fxXml, curveCsv, estrCsv });
const errs = validateMarket(market);
const c = market.curves.EUR;
console.log(`FX: ${market.fx.dates.length} days to ${market.fx.dates.at(-1)}, ${Object.keys(market.fx.rates).length} currencies`);
console.log(`AAA curve: ${c.dates.length} days to ${c.dates.at(-1)}; latest ${c.tenors.map((t, i) => `${t}y ${c.zero.at(-1)?.[i]?.toFixed(3)}`).join(', ')}`);
console.log(`€STR: ${market.estr.dates.length} days to ${market.estr.dates.at(-1)}, latest ${market.estr.values.at(-1)}`);
if (errs.length) { console.error('Market data failed validation:\n - ' + errs.join('\n - ')); process.exit(1); }
if (check) { console.log('OK (check only, nothing written)'); process.exit(0); }
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(market));
console.log(`Wrote ${out}`);
