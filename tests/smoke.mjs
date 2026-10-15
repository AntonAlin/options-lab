// Browser smoke test: serve the site, connect the demo holdings file (through a stand-in for the
// browser's file picker, kept in memory), open every page and fail on any script error or a
// NaN/undefined on screen. Also checks that changes made in the app are written into the file as
// rows, that an API source is read and written, that deleted portfolios keep their control log in
// the archive, and that the published ECB data file is picked up. Run: node tests/smoke.mjs  (needs Playwright; CI installs it, see .github/workflows/ci.yml)
// Set SITE_DIR to test an assembled site instead of the repository.
// CHROMIUM_PATH points at an already installed Chromium when there is one.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildMarket } from '../js/marketdata.js';
import { demoCSV } from '../js/demofile.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
// SITE_DIR tests an assembled site (scripts/assemble-site.sh) — exactly what gets published.
const root = process.env.SITE_DIR ? join(process.cwd(), process.env.SITE_DIR) + '/' : repo;
const fixture = f => readFileSync(join(repo, 'tests/fixtures', f), 'utf8');
// The ECB fixture stands in for the published file, so the automatic update is exercised too.
const rb = JSON.parse(fixture('riksbank.json'));
const market = JSON.stringify(buildMarket({ fxXml: fixture('ecb-hist-90d.xml'), curveCsv: fixture('ecb-yc.csv'), estrCsv: fixture('ecb-estr.csv'), sek: { series: rb.series, swestr: rb.swestr } }));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

// A stand-in for an organisation's holdings API: GET the document, PUT it back (If-Match on the ETag).
const api = { doc: JSON.stringify({ meta: { system: 'smoke' }, holdings: [
  { date: '2026-09-30', fund: 'API Fund', name: 'Volvo B', isin: 'SE0000115446', type: 'Equity', quantity: 1000, price: 262, currency: 'SEK' },
  { date: '2026-09-30', fund: 'API Fund', name: 'Cash', type: 'Cash', quantity: 50000, currency: 'SEK' }
] }), version: 1, puts: 0, refused: 0 };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/api/holdings') {
    if (req.headers.authorization !== 'Bearer smoke') { res.writeHead(401); res.end(); return; }
    if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json', etag: `"v${api.version}"` }); res.end(api.doc); return; }
    if (req.method === 'PUT') {
      if (req.headers['if-match'] !== `"v${api.version}"`) { api.refused++; res.writeHead(412); res.end(); return; }
      let body = ''; for await (const c of req) body += c;
      api.doc = body; api.version++; api.puts++;
      res.writeHead(204); res.end(); return;
    }
  }
  // An empty page on the site's origin for the storage test (some Chromium builds refuse to stay on a 404).
  if (path === '/blank-for-storage-test') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
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
  // The File System Access API without a disk: one file in memory, readable and writable, that the
  // test can look at (window.__file.text). Playwright cannot drive the real picker.
  await page.addInitScript(csv => {
    const f = window.__file = { name: 'nexus-holdings-demo.csv', text: csv, lastModified: Date.now(), writes: 0 };
    const handle = {
      kind: 'file', name: f.name,
      getFile: async () => new File([f.text], f.name, { type: 'text/csv', lastModified: f.lastModified }),
      createWritable: async () => { let next = ''; return { write: async b => { next = typeof b === 'string' ? b : await b.text(); }, close: async () => { f.text = next; f.lastModified = Date.now(); f.writes++; } }; },
      queryPermission: async () => 'granted', requestPermission: async () => 'granted', isSameEntry: async () => false
    };
    window.showOpenFilePicker = async () => [handle];
  }, demoCSV('2026-09-30'));
  await page.goto(base + 'index.html#/holdings');
  await page.waitForTimeout(800);
  // No source connected: every portfolio page is the setup page, and there is no built-in demo.
  const gate = await page.evaluate(() => ({ setup: !!document.querySelector('[data-src="connect-file"]'), demo: !!document.querySelector('[data-act="demo"]') }));
  if (!gate.setup || gate.demo) failures.push('setup gate: ' + JSON.stringify(gate));
  await page.click('[data-src="connect-file"]');
  await page.waitForTimeout(2500);
  const funds = await page.evaluate(async () => (await import('./js/store.js')).listPortfolios().map(p => p.name + ':' + p.positions.length));
  if (funds.join() !== 'Demo: Nordic Balanced Fund:55,Demo: Nordic Equity Fund:13') failures.push('connected portfolios: ' + funds.join());
  await page.evaluate(async () => { const store = await import('./js/store.js'); store.setActive(store.listPortfolios().find(p => p.name === 'Demo: Nordic Balanced Fund').id); });
  await page.waitForTimeout(500);
  for (const r of routes) {
    await page.goto(base + 'index.html#/' + r);
    await page.waitForTimeout(400);
    const bad = await page.evaluate(() => { const t = document.getElementById('main')?.innerText || ''; const m = t.match(/.{0,40}\b(NaN|undefined)\b.{0,40}/); return m ? m[0] : ''; });
    if (bad) failures.push(`#/${r}: "${bad}"`);
  }
  // Control log on the demo: a limit tightened into a breach is logged; sign in by name, sign off,
  // and open a case on the breach.
  await page.evaluate(async () => { const store = await import('./js/store.js'); store.update(p => { p.limits.issuerMax.value = 1; }, 'limit'); });
  await page.goto(base + 'index.html#/control-log');
  await page.waitForTimeout(400);
  await page.fill('#clName', 'Smoke Tester');
  await page.dispatchEvent('#clName', 'change');
  await page.waitForTimeout(300);
  await page.click('[data-act="signoff"]');
  await page.waitForTimeout(300);
  const hasTodo = await page.$('[data-open]');
  if (!hasTodo) failures.push('control log: the breach has no "Open case" button');
  else {
    await hasTodo.click();
    await page.fill('#caseForm textarea[name="text"]', 'Smoke test case');
    await page.click('button[form="caseForm"]');
    await page.waitForTimeout(300);
  }
  const clog = await page.evaluate(async () => { const store = await import('./js/store.js'); const al = await import('./js/auditlog.js'); const l = store.active().controlLog; return { kinds: l.map(e => e.kind), by: l.at(-1)?.by, ok: al.verify(l).ok }; });
  if (clog.kinds.join() !== 'source.connect,limit,signoff,case.open' || !clog.ok) failures.push('control log: ' + JSON.stringify(clog));
  if (process.env.SMOKE_SHOTS) await page.screenshot({ path: process.env.SMOKE_SHOTS + '/control-log.png', fullPage: true });
  console.log(`Control log: ${JSON.stringify(clog)}`);

  // Write-back: a new holding becomes a row in the file, an edit changes its cells, a deletion
  // removes the row, and each write is in the control log.
  const rowsOf = async isin => page.evaluate(i => window.__file.text.split('\r\n').filter(l => l.includes(i)), isin);
  await page.evaluate(async () => {
    const store = await import('./js/store.js');
    store.update(p => { p.positions.push({ id: 'smoke1', type: 'equity', name: 'Smoke AB', isin: 'SE9999999991', qty: 1000, price: 50, ccy: 'SEK', beta: 1 }); }, 'add');
  });
  await page.waitForTimeout(2000);
  const added = await rowsOf('SE9999999991');
  if (added.length !== 1 || !added[0].startsWith('2026-09-30,Demo: Nordic Balanced Fund,Equity,Smoke AB')) failures.push('write-back add: ' + JSON.stringify(added));
  await page.evaluate(async () => { const store = await import('./js/store.js'); store.update(p => { p.positions.find(x => x.isin === 'SE9999999991').qty = 2500; }, 'edit'); });
  await page.waitForTimeout(2000);
  const changed = await rowsOf('SE9999999991');
  if (changed.length !== 1 || !changed[0].includes(',2500,')) failures.push('write-back change: ' + JSON.stringify(changed));
  await page.evaluate(async () => { const store = await import('./js/store.js'); store.update(p => { p.positions = p.positions.filter(x => x.isin !== 'SE9999999991'); }, 'delete'); });
  await page.waitForTimeout(2000);
  const wrote = await page.evaluate(async () => { const store = await import('./js/store.js'); return { left: window.__file.text.includes('SE9999999991'), writes: window.__file.writes, logged: store.active().controlLog.filter(e => e.kind === 'source.write').length, n: store.active().positions.length }; });
  if (wrote.left || wrote.writes < 3 || wrote.logged < 3 || wrote.n !== 55) failures.push('write-back delete: ' + JSON.stringify(wrote));
  console.log(`Write-back: ${JSON.stringify(wrote)}`);
  // Deleting a portfolio takes its rows out of the file and keeps its control log in the archive.
  await page.evaluate(async () => { const store = await import('./js/store.js'); const src = await import('./js/sources.js'); src.removePortfolio(store.listPortfolios().find(p => p.name === 'Demo: Nordic Equity Fund').id); });
  await page.waitForTimeout(2000);
  const dropped = await page.evaluate(async () => { const store = await import('./js/store.js'); return { inFile: window.__file.text.includes('Nordic Equity Fund'), funds: store.listPortfolios().map(p => p.name), archive: store.archive().map(a => a.name + ':' + a.controlLog.at(-1).kind) }; });
  if (dropped.inFile || dropped.funds.join() !== 'Demo: Nordic Balanced Fund' || dropped.archive.join() !== 'Demo: Nordic Equity Fund:portfolio.removed') failures.push('portfolio delete: ' + JSON.stringify(dropped));
  await page.goto(base + 'index.html#/control-log');
  await page.waitForTimeout(600);
  if (!(await page.$('[data-arch="csv:0"]'))) failures.push('control log: the archived log has no export');

  // A second source: an HTTP API, read with a bearer token and written back with PUT + If-Match.
  const viaApi = await page.evaluate(async url => {
    const src = await import('./js/sources.js'); const store = await import('./js/store.js');
    const r = await src.connectApi({ url, name: 'Smoke API', headers: [['Authorization', 'Bearer smoke']], writeMethod: 'PUT' });
    const p = store.listPortfolios().find(x => x.name === 'API Fund');
    store.setActive(p.id);
    store.update(pp => { pp.positions.find(x => x.isin === 'SE0000115446').qty = 1100; }, 'edit');
    await new Promise(res => setTimeout(res, 1500));
    return { r, n: p.positions.length, sources: src.list().map(s => s.name + ':' + s.status.state) };
  }, base + 'api/holdings');
  const apiDoc = JSON.parse(api.doc);
  if (viaApi.r.portfolios !== 1 || viaApi.n !== 2 || api.puts !== 1 || apiDoc.holdings[0].quantity !== 1100 || apiDoc.meta?.system !== 'smoke') failures.push('API source: ' + JSON.stringify({ viaApi, puts: api.puts, refused: api.refused, doc: apiDoc }));
  console.log(`API source: ${JSON.stringify({ ...viaApi, puts: api.puts })}`);
  for (const r of ['import', 'settings', 'holdings']) { await page.goto(base + 'index.html#/' + r); await page.waitForTimeout(400); const bad = await page.evaluate(() => { const t = document.getElementById('main')?.innerText || ''; const m = t.match(/.{0,40}\b(NaN|undefined)\b.{0,40}/); return m ? m[0] : ''; }); if (bad) failures.push(`#/${r} with two sources: "${bad}"`); }

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

  // Removing every source takes its portfolios out (logs archived) and brings the setup page back.
  const removed = await page.evaluate(async () => { const store = await import('./js/store.js'); const src = await import('./js/sources.js'); let n = 0; for (const s of src.list()) n += await src.removeSource(s.id); return { n, archive: store.archive().length, ready: src.ready() }; });
  await page.goto(base + 'index.html#/holdings');
  await page.waitForTimeout(500);
  if (removed.n !== 2 || removed.archive !== 3 || removed.ready || !(await page.$('[data-src="connect-file"]'))) failures.push('remove sources: ' + JSON.stringify(removed));

  // A layout the reader does not recognise opens the mapper; mapping it once connects it.
  await page.evaluate(() => { window.__file.text = 'Book;Sec;Units;Px;Pricing day;Curr\nAlpha;Volvo B;1000;262,5;30.09.2026;SEK\n'; window.__file.lastModified = Date.now(); });
  await page.click('[data-src="connect-file"]');
  await page.waitForTimeout(1500);
  if (!(await page.$('#dateColSel'))) failures.push('mapper: did not open for an unrecognised layout');
  else {
    await page.selectOption('#dateColSel', '4'); await page.waitForTimeout(300);
    await page.selectOption('#pfColSel', '0'); await page.waitForTimeout(300);
    for (const [c, f] of [[1, 'name'], [2, 'qty'], [3, 'price'], [5, 'ccy']]) { await page.selectOption(`[data-map="${c}"]`, f); await page.waitForTimeout(200); }
    await page.selectOption('#typeSel2', 'equity'); await page.waitForTimeout(200);
    await page.click('[data-act="tplsave"]'); await page.waitForTimeout(300);
    await page.click('button[form="tplForm"]'); await page.waitForTimeout(2000);
    const mapped = await page.evaluate(async () => (await import('./js/store.js')).listPortfolios().map(p => p.name + ':' + p.positions.length));
    if (!mapped.includes('Alpha:1')) failures.push('mapper: ' + JSON.stringify(mapped));
    console.log(`Mapper: ${JSON.stringify(mapped)}`);
  }

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
