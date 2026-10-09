// Fetch the ECB's public market data and the curves of the configured providers, and write
// data/market.json for the site.
//   node scripts/market-data.mjs [out.json] [--check] [--strict] [--config=market-sources.json] [--sources=riksbank,ustreasury]
// --check validates without writing (used by CI on every push). Exits non-zero on any problem with
// the ECB data, so a broken download is never published over the previous day's good file. Every
// other provider is optional: a provider that fails, or whose curve does not validate, is left out
// of the file with a warning, and fails the run only with --strict when it is listed as strict in
// the config (CI's market data job, which does not block anything).
//
// Providers that need a key read it from the environment (a GitHub Actions secret); see
// docs/MARKET-DATA-SOURCES.md. The same script runs on any server with Node 20+, so an organisation
// can publish its own market.json from its own sources and point the app at it (Settings).
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SOURCES, curveUrl, buildMarket, validateMarket, validatePart } from '../js/marketdata.js';
import { resolveProviders, DEFAULT_CONFIG } from '../js/marketsources.js';

const args = process.argv.slice(2);
const opt = k => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const check = args.includes('--check');
const strict = args.includes('--strict');
const out = args.find(a => !a.startsWith('--')) || 'data/market.json';
const configPath = opt('config') || 'market-sources.json';
const only = opt('sources')?.split(',').map(s => s.trim()).filter(Boolean) || null;

const sleep = ms => new Promise(r => setTimeout(r, ms));
// `label` is what goes in the log: the URL template, so an API key in the expanded URL never does.
async function get(url, { headers = {}, label = url, tries = 4 } = {}) {
  for (let i = 1; ; i++) {
    let status = 0;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'nexus-portfolio-lab market data (GitHub Actions)', Accept: 'application/json, text/csv, text/xml, */*', ...headers } });
      status = res.status;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i >= tries || [401, 403, 404].includes(status)) throw new Error(`${label}: ${e.message}`);
      // Rate limited: wait out the minute rather than hammering.
      await sleep(status === 429 ? 61000 : 2000 * 2 ** (i - 1));
    }
  }
}

let config = DEFAULT_CONFIG;
try { config = JSON.parse(await readFile(configPath, 'utf8')); console.log(`Providers from ${configPath}`); }
catch (e) { if (e.code !== 'ENOENT' || opt('config')) { console.error(`${configPath}: ${e.message}`); process.exit(1); } }
const { providers, errors: configErrs } = resolveProviders(config, { only });
for (const e of configErrs) console.warn('Config: ' + e);

const ctx = { get, sleep, today: new Date(), env: process.env, warn: msg => console.warn(msg) };
// One provider: download, build, validate. Returns { provider, part } or { provider, problem }.
async function run(p) {
  const missing = p.needs.filter(k => !process.env[k]);
  if (missing.length) return { provider: p, problem: `needs ${missing.join(', ')} in the environment` };
  try {
    const part = p.build(await p.fetch({ ...ctx, warn: msg => console.warn(`${p.id}: ${msg}`) }));
    if (!part) return { provider: p, problem: 'no usable data' };
    const errs = validatePart(part, new Date().toISOString());
    return errs.length ? { provider: p, problem: errs.join('; ') } : { provider: p, part };
  } catch (e) { return { provider: p, problem: e.message }; }
}

const [fxXml, curveCsv, estrCsv, results] = await Promise.all([get(SOURCES.fx), get(curveUrl()), get(SOURCES.estr), Promise.all(providers.map(run))]);
const market = buildMarket({ fxXml, curveCsv, estrCsv, parts: results.filter(r => r.part).map(r => r.part) });
const errs = validateMarket(market);

const c = market.curves.EUR;
console.log(`FX: ${market.fx.dates.length} days to ${market.fx.dates.at(-1)}, ${Object.keys(market.fx.rates).length} currencies`);
console.log(`EUR (ecb): ${c.dates.length} days to ${c.dates.at(-1)}; latest ${c.tenors.map((t, i) => `${t}y ${c.zero.at(-1)?.[i]?.toFixed(3)}`).join(', ')}; €STR ${market.estr.values.at(-1) ?? '–'}`);
for (const r of results) {
  if (r.part) {
    const s = r.part.curve, on = r.part.overnight?.values?.at(-1);
    console.log(`${r.part.ccy} (${r.provider.id}): ${s.dates.length} days to ${s.dates.at(-1)}; latest ${s.tenors.map((t, i) => `${+t.toFixed(2)}y ${s.zero.at(-1)[i].toFixed(3)}`).join(', ')}${on != null ? `; overnight ${on}` : ''}`);
  } else {
    console.warn(`${r.provider.ccy} (${r.provider.id}) left out: ${r.problem}`);
    // In GitHub Actions: an annotation on the run, so a provider that keeps failing is seen.
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Market data::${r.provider.ccy} curve (${r.provider.id}) left out: ${r.problem.replace(/[\r\n]+/g, ' ')}`);
  }
}
if (errs.length) { console.error('Market data failed validation:\n - ' + errs.join('\n - ')); process.exit(1); }
const strictFailed = results.filter(r => !r.part && r.provider.strict);
if (strict && (strictFailed.length || configErrs.length)) {
  console.error('--strict: ' + [...strictFailed.map(r => `${r.provider.id} did not validate`), ...configErrs].join('; '));
  process.exit(1);
}
if (check) { console.log('OK (check only, nothing written)'); process.exit(0); }
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(market));
console.log(`Wrote ${out}`);
