// Browser smoke test: serve the site, load the demo, open every page and fail on
// any script error or a NaN/undefined on screen. Also checks that the published ECB data file is
// picked up. Run: node tests/smoke.mjs  (needs Playwright; CI installs it, see .github/workflows/ci.yml)
// Set SITE_DIR to test an assembled site instead of the repository.
// CHROMIUM_PATH points at an already installed Chromium when there is one.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildMarket } from '../js/marketdata.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
// SITE_DIR tests an assembled site (scripts/assemble-site.sh) — exactly what gets published.
const root = process.env.SITE_DIR ? join(process.cwd(), process.env.SITE_DIR) + '/' : repo;
const fixture = f => readFileSync(join(repo, 'tests/fixtures', f), 'utf8');
// The ECB fixture stands in for the published file, so the automatic update is exercised too.
const rb = JSON.parse(fixture('riksbank.json'));
const market = JSON.stringify(buildMarket({ fxXml: fixture('ecb-hist-90d.xml'), curveCsv: fixture('ecb-yc.csv'), estrCsv: fixture('ecb-estr.csv'), sek: { series: rb.series, swestr: rb.swestr } }));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/data/market.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(market); return; }
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const routes = readFileSync(join(repo, 'js/app.js'), 'utf8').match(/const VIEWS = \{([^}]*)\}/)[1]
  .split(',').map(e => e.split(':')[0].trim().replace(/'/g, '')).filter(Boolean);
const failures = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', e => failures.push('page error: ' + e.message));
  // External libraries (fonts, CDNs) may be unreachable on a CI runner; that is not a site error.
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) failures.push('console: ' + m.text()); });
  await page.goto(base + 'index.html');
  await page.click('[data-act="demo"]');
  await page.waitForTimeout(1500);
  for (const r of routes) {
    await page.goto(base + 'index.html#/' + r);
    await page.waitForTimeout(400);
    const bad = await page.evaluate(() => { const t = document.getElementById('main')?.innerText || ''; const m = t.match(/.{0,40}\b(NaN|undefined)\b.{0,40}/); return m ? m[0] : ''; });
    if (bad) failures.push(`#/${r}: "${bad}"`);
  }
  // Published ECB data: a new portfolio on placeholder rates takes the rates and the curve.
  const synced = await page.evaluate(async () => {
    const store = await import('./js/store.js');
    const ms = await import('./js/marketsync.js');
    await ms.load();
    store.addPortfolio(store.newPortfolio({ name: 'Smoke', baseCcy: 'SEK', valDate: '2026-09-28' }));
    ms.syncAll();
    const p = store.active();
    return { fxSource: p.fxSource, fxDate: p.fxDate, curve: p.curves?.EUR?.date, sek: p.curves?.SEK?.date };
  });
  if (synced.fxSource !== 'ecb-auto' || synced.fxDate !== '2026-09-28' || synced.curve !== '2026-09-28' || synced.sek !== '2026-09-28') failures.push('market data not applied: ' + JSON.stringify(synced));
  console.log(`Visited ${routes.length} pages; market data ${JSON.stringify(synced)}`);

  // Storage: a workspace saved in localStorage by an older version moves to IndexedDB, and what is
  // saved there survives a reload, one portfolio at a time.
  // A fresh browser context (empty storage); the first page is a blank one on the site's origin, so
  // the app does not start before the old-style workspace is in place.
  const ctx = await browser.newContext();
  const fresh = await ctx.newPage();
  await fresh.goto(base + 'blank-for-storage-test');
  await fresh.evaluate(async () => {
    const store = await import('./js/store.js');
    const p = store.newPortfolio({ name: 'Legacy', baseCcy: 'SEK' });
    localStorage.setItem('nexus_portfolio_lab_v1', JSON.stringify({ version: 1, settings: { theme: 'auto' }, activeId: p.id, portfolios: { [p.id]: p }, templates: [] }));
  });
  await fresh.close();
  const s1 = await ctx.newPage();
  s1.on('pageerror', e => failures.push('storage page error: ' + e.message));
  await s1.goto(base + 'index.html');
  await s1.waitForTimeout(500);
  const migrated = await s1.evaluate(async () => {
    const store = await import('./js/store.js');
    const r = { backend: store.backend(), name: store.active()?.name, leftInLocalStorage: localStorage.getItem('nexus_portfolio_lab_v1') !== null };
    store.addPortfolio(store.newPortfolio({ name: 'Second' }));
    await store.flushed();
    return r;
  });
  await s1.reload(); await s1.waitForTimeout(500);
  const reloaded = await s1.evaluate(async () => {
    const store = await import('./js/store.js');
    const names = store.listPortfolios().map(p => p.name);
    store.deletePortfolio(store.listPortfolios().find(p => p.name === 'Legacy').id);
    await store.flushed();
    return names;
  });
  await s1.reload(); await s1.waitForTimeout(500);
  const afterDelete = await s1.evaluate(async () => (await import('./js/store.js')).listPortfolios().map(p => p.name));
  const storageOk = migrated.backend === 'IndexedDB' && migrated.name === 'Legacy' && !migrated.leftInLocalStorage
    && reloaded.join() === 'Legacy,Second' && afterDelete.join() === 'Second';
  if (!storageOk) failures.push('storage: ' + JSON.stringify({ migrated, reloaded, afterDelete }));
  await ctx.close();
  console.log(`Storage: ${JSON.stringify({ migrated, reloaded, afterDelete })}`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length) { console.error('Smoke test failed:\n - ' + failures.join('\n - ')); process.exit(1); }
console.log('Smoke test passed');
