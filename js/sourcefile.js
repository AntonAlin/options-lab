// A connected source file: a CSV or Excel file on the user's disk that the app reads (never writes)
// and keeps reading when it changes. The first column holds a date, so one file can carry many
// snapshots — a daily holdings dump appended to over time — and, with a portfolio column, many
// portfolios. Each portfolio in the file becomes a portfolio here; it shows the latest date unless
// the user pins another one, and the prices across dates feed its price history.
//
// Reading uses the File System Access API (Chrome and Edge on desktop). The handle is kept in
// IndexedDB; after a browser restart one click re-grants read access.
import * as store from './store.js';
import { readFile, autoMapping, rowsToPositions, detectTemplate, applyTemplateMapping, parseDate, parseNumber, mergeHistory, guessField } from './importer.js';
import { normKey } from './instruments.js';
import { posKey as key } from './insights.js';
import { loadScript, uid, isNum } from './util.js';

// ---- pure helpers (also used by the tests) -----------------------------------------------------------

// Only cells that are unmistakably dates count: a Date, an Excel serial in a sane range, or text
// shaped like 2026-09-29 / 29.09.2026 / 20260929. "Total" or a bare 1234 must not pass.
export function cellDate(v) {
  if (v instanceof Date) return parseDate(v);
  if (typeof v === 'number') return v > 20000 && v < 80000 ? parseDate(v) : '';
  const s = String(v ?? '').trim();
  if (!/^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}([ T].*)?|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{8})$/.test(s)) return '';
  return parseDate(s.replace(/[ T].*$/, ''));
}

const PF_ALIASES = new Set(['portfolio', 'portfolioname', 'portfolioid', 'portfoliocode', 'portfölj', 'portfolj', 'portföljnamn', 'portfoljnamn', 'portföljid',
  'fund', 'fundname', 'fundid', 'fundcode', 'fond', 'fondnamn', 'fondid', 'account', 'accountname', 'accountid', 'accountnumber', 'konto', 'kontonamn', 'kontonummer',
  'depå', 'depa', 'depot', 'depånummer', 'mandate', 'mandat', 'mandatename', 'client', 'kund', 'clientname', 'kundnamn']);
export const isPortfolioHeader = h => PF_ALIASES.has(normKey(h));

// Headers that name the date a row applies to. A column whose header is a position field (Maturity,
// Förfallodag, …) is never the snapshot date, however date-like its cells are.
const DATE_HEADERS = new Set(['date', 'datum', 'dag', 'day', 'asof', 'asofdate', 'asat', 'valuationdate', 'valdate', 'värderingsdag', 'värderingsdatum',
  'varderingsdag', 'reportdate', 'reportingdate', 'rapportdatum', 'positiondate', 'positionsdatum', 'holdingsdate', 'navdate', 'navdatum', 'businessdate', 'affärsdag', 'tradedate']);
const isDateHeader = h => DATE_HEADERS.has(normKey(h));
const dateRatio = (rows, c) => { const cells = rows.map(r => r[c]).filter(x => String(x ?? '').trim() !== ''); return cells.length ? cells.filter(x => cellDate(x)).length / cells.length : 0; };
const headerText = h => (h instanceof Date ? h.toISOString().slice(0, 10) : String(h ?? '').trim());

// Where the header row, the date column and (optionally) the portfolio column are. The date is the
// first column by convention; another column counts only if its header says it is the date.
export function detectLayout(rows) {
  const width = Math.max(0, ...rows.slice(0, 50).map(r => r.length));
  const sample = rows.slice(0, 200);
  const headerFor = c => rows.findIndex(r => cellDate(r[c])) - 1;
  const ok = c => {
    if (dateRatio(sample, c) < 0.5) return false;
    const hr = headerFor(c);
    if (hr < 0) return false;
    const h = headerText(rows[hr][c]);
    return c === 0 ? !guessField(h) || isDateHeader(h) : isDateHeader(h);
  };
  let dateCol = ok(0) ? 0 : -1;
  for (let c = 1; c < width && dateCol < 0; c++) if (ok(c)) dateCol = c;
  if (dateCol < 0) return { error: dateRatio(sample, 0) >= 0.5 && headerFor(0) < 0 ? 'no_header' : 'no_date' };
  const headerRow = headerFor(dateCol);
  const header = rows[headerRow].map(headerText);
  const pfCol = header.findIndex((h, c) => c !== dateCol && isPortfolioHeader(h));
  return { headerRow, header, dateCol, pfCol };
}

// Same, for a file whose header row is already known (bulk upload): { dateCol, pfCol }, -1 if absent.
export function datedLayout(rows, headerRow) {
  const header = (rows[headerRow] || []).map(headerText);
  const body = rows.slice(headerRow + 1, headerRow + 201);
  let dateCol = header.findIndex((h, c) => isDateHeader(h) && dateRatio(body, c) >= 0.5);
  if (dateCol < 0 && dateRatio(body, 0) >= 0.5 && !guessField(header[0])) dateCol = 0;
  const pfCol = header.findIndex((h, c) => c !== dateCol && isPortfolioHeader(h));
  return { headerRow, header, dateCol, pfCol };
}

// Split the rows below the header into portfolios and dates:
//   [{ key, dates: [{ date, rows }] }] with dates ascending. key is '' when the file has no portfolio column.
export function splitSnapshots(rows, layout) {
  const groups = new Map();
  let skipped = 0;
  for (const r of rows.slice(layout.headerRow + 1)) {
    const date = cellDate(r[layout.dateCol]);
    if (!date) { skipped++; continue; } // totals, footers, blank dates
    const key = layout.pfCol >= 0 ? String(r[layout.pfCol] ?? '').trim() : '';
    if (!groups.has(key)) groups.set(key, new Map());
    const byDate = groups.get(key);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(r);
  }
  const out = [...groups.entries()].map(([key, m]) => ({ key, dates: [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, rs]) => ({ date, rows: rs })) }));
  out.sort((a, b) => a.key.localeCompare(b.key));
  return { groups: out, skipped };
}

// Column → field mapping for the file: a saved import template that matches the headers wins
// (so the bulk-upload page is where an odd layout gets taught once), otherwise the auto-mapping.
// The date and portfolio columns never map to a position field.
export function sourceMapping(layout, templates = []) {
  const hit = detectTemplate(templates, [{ rows: [layout.header] }]);
  const tpl = hit ? hit.template : null;
  const mapping = tpl ? applyTemplateMapping(tpl, layout.header) : autoMapping(layout.header);
  mapping[layout.dateCol] = '';
  if (layout.pfCol >= 0) mapping[layout.pfCol] = '';
  const opts = tpl
    ? { decimal: tpl.decimal, dateFormat: tpl.dateFormat, transforms: tpl.transforms || {}, constants: tpl.constants || {}, typeMap: tpl.typeMap || {}, skipPattern: tpl.skipPattern || '', defaultType: tpl.defaultType || 'auto' }
    : {};
  return { mapping, opts, template: tpl ? tpl.name : '' };
}

// Every row is kept, invalid ones included: a live feed must not drop a holding silently. The
// holdings page flags rows with errors.
export function snapshotPositions(rows, mapping, opts) {
  return rowsToPositions(rows, mapping, opts).map(r => r.pos);
}

const posKey = x => { const k = key(x); return k.startsWith('x:') ? '' : k; };

// Keep position ids stable across refreshes so selections and transaction links survive.
export function carryIds(prev, next) {
  const ids = new Map();
  (prev || []).forEach(x => { const k = posKey(x); if (k && !ids.has(k)) ids.set(k, x.id); });
  const used = new Set();
  return next.map(x => {
    const id = ids.get(posKey(x));
    if (id && !used.has(id)) { used.add(id); return { ...x, id }; }
    return x.id ? x : { ...x, id: uid() };
  });
}

// Price per instrument per date across the snapshots, keyed the way the analytics look series up
// (ISIN, then ticker, then name). Needs two dates or more to be of any use.
export function snapshotHistory(group, mapping, opts) {
  if (group.dates.length < 2) return null;
  const series = {};
  const dates = group.dates.map(d => d.date);
  group.dates.forEach((d, i) => {
    for (const pos of snapshotPositions(d.rows, mapping, opts)) {
      const k = pos.isin || pos.ticker || pos.name;
      if (!k || !isNum(pos.price)) continue;
      (series[k] ||= dates.map(() => null))[i] = pos.price;
    }
  });
  return Object.keys(series).length ? { dates, series } : null;
}

// Parse a whole file into { layout, mapping, opts, template, groups, skipped } or { error }.
export function analyseRows(rows, { decimal = '.', templates = [] } = {}) {
  const layout = detectLayout(rows);
  if (layout.error) return layout;
  const { mapping, opts, template } = sourceMapping(layout, templates);
  if (mapping.filter(Boolean).length < 2) return { error: 'no_fields' };
  const { groups, skipped } = splitSnapshots(rows, layout);
  if (!groups.length) return { error: 'no_rows' };
  return { layout, mapping, opts: { decimal, ...opts }, template, groups, skipped };
}

// ---- state -------------------------------------------------------------------------------------------------
const DB = 'nexus-sourcefile', OS = 'meta', KEY = 'main';
const POLL_MS = 4000;
const TYPES = [{ description: 'CSV or Excel', accept: { 'text/csv': ['.csv', '.txt', '.tsv'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.xlsm'], 'application/vnd.ms-excel': ['.xls'] } }];

const status = { state: 'none', name: '', lastRead: null, lastModified: 0, error: '', portfolios: 0, dates: 0, template: '', skipped: 0 };
const listeners = new Set();
export const supported = () => typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
export const getStatus = () => status;
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function set(patch) { Object.assign(status, patch); listeners.forEach(fn => { try { fn(status); } catch (e) { console.error(e); } }); }

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(OS);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet() {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => { const r = db.transaction(OS).objectStore(OS).get(KEY); r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error); });
  } catch (e) { return null; }
}
// Remembering the handle is a convenience (no reconnect after a reload); failing to store it, e.g.
// in a private window, must not break the connection itself.
async function idbSet(val) {
  try {
    const db = await idb();
    await new Promise((resolve, reject) => { const tx = db.transaction(OS, 'readwrite'); tx.objectStore(OS).put(val, KEY); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  } catch (e) { console.warn('Connected file could not be remembered', e); }
}
async function idbDel() {
  try { const db = await idb(); await new Promise((resolve, reject) => { const tx = db.transaction(OS, 'readwrite'); tx.objectStore(OS).delete(KEY); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); } catch (e) { /* nothing to forget */ }
}

let rec = null;      // { id, handle, name, lastModified }
let parsed = null;   // last analyseRows() result, so switching dates needs no re-read
let timer = null;

// The portfolios fed by the connected file.
export const sourced = () => (rec ? store.listPortfolios().filter(p => p.source && p.source.file === rec.id) : []);
// Holdings on every date in the file for one portfolio: [{ date, positions }], oldest first.
// Built on demand and cached until the file (or the mapping) changes.
let snapCache = { parsed: null, map: new Map() };
export function snapshotsFor(p) {
  if (!parsed || !p?.source?.file || !rec || p.source.file !== rec.id) return null;
  if (snapCache.parsed !== parsed) snapCache = { parsed, map: new Map() };
  if (snapCache.map.has(p.source.key)) return snapCache.map.get(p.source.key);
  const g = parsed.groups.find(x => x.key === p.source.key);
  const out = g ? g.dates.map(d => ({ date: d.date, positions: snapshotPositions(d.rows, parsed.mapping, parsed.opts) })) : null;
  snapCache.map.set(p.source.key, out);
  return out;
}
export const datesFor = p => (parsed && p?.source ? parsed.groups.find(g => g.key === p.source.key)?.dates.map(d => d.date) || [] : p?.source?.dates || []);

// ---- connect / disconnect --------------------------------------------------------------------------------
export async function connect({ sameAs = null } = {}) {
  if (!supported()) throw new Error('unsupported');
  const [handle] = await window.showOpenFilePicker({ id: 'nexus-source', multiple: false, types: TYPES });
  // Reading the file the linked-file feature writes to would make the app feed itself.
  if (sameAs && typeof handle.isSameEntry === 'function' && await handle.isSameEntry(sameAs).catch(() => false)) throw Object.assign(new Error('same_file'), { code: 'same_file' });
  if ((await handle.queryPermission?.({ mode: 'read' })) !== 'granted' && (await handle.requestPermission({ mode: 'read' })) !== 'granted') throw Object.assign(new Error('permission'), { code: 'permission' });
  const file = await handle.getFile();
  const result = await parseFile(file);
  if (result.error) throw Object.assign(new Error(result.error), { code: result.error });
  // A new file is a new source: portfolios fed by the previous one keep their data but stop following.
  if (rec) detachAll();
  rec = { id: uid('src'), handle, name: handle.name, lastModified: file.lastModified };
  await idbSet(rec);
  const created = apply(result, { activateFirst: true });
  set({ state: 'linked', name: rec.name, lastRead: new Date().toISOString(), lastModified: file.lastModified, error: '' });
  startPolling();
  return { created, portfolios: result.groups.length, dates: new Set(result.groups.flatMap(g => g.dates.map(d => d.date))).size };
}

// Keep the portfolios, stop following the file.
export async function disconnect() {
  detachAll();
  rec = null; parsed = null;
  stopPolling();
  await idbDel();
  set({ state: supported() ? 'none' : 'unsupported', name: '', lastRead: null, lastModified: 0, error: '', portfolios: 0, dates: 0, template: '', skipped: 0 });
}
function detachAll() {
  for (const p of sourced()) store.mutatePortfolio(p.id, pp => { pp.source = { ...pp.source, detached: true, file: '' }; });
}

// ---- reading ------------------------------------------------------------------------------------------------
async function parseFile(file) {
  const r = await readFile(file, loadScript);
  const sheets = r.sheets.filter(s => s.rows.length > 1);
  // Excel: the first sheet that has a date column and a header.
  for (const sh of sheets) {
    const res = analyseRows(sh.rows, { decimal: r.decimal, templates: store.templates() });
    if (!res.error) return res;
  }
  return sheets.length ? analyseRows(sheets[0].rows, { decimal: r.decimal, templates: store.templates() }) : { error: 'no_rows' };
}

// Push the parsed file into the workspace. Returns how many portfolios were created.
function apply(result, { activateFirst = false } = {}) {
  parsed = result;
  const base = rec.name.replace(/\.[a-z0-9]+$/i, '');
  const existing = sourced();
  let created = 0, firstId = null;
  for (const g of result.groups) {
    let p = existing.find(x => x.source.key === g.key);
    // Connecting the same file again picks its old portfolios back up instead of duplicating them.
    const old = !p && activateFirst ? store.listPortfolios().find(x => x.source?.detached && x.source.fileName === rec.name && x.source.key === g.key) : null;
    if (old) {
      store.mutatePortfolio(old.id, pp => { pp.source = { ...pp.source, file: rec.id, detached: false, sig: '' }; });
      p = old;
    }
    if (!p) {
      p = store.newPortfolio({ name: g.key || base });
      p.source = { file: rec.id, fileName: rec.name, key: g.key, date: '' };
      store.upsertPortfolio(p, { activate: activateFirst && !created });
      created++;
    }
    firstId ||= p.id;
    syncPortfolio(p.id, g);
  }
  // A portfolio that has vanished from the file keeps its last data and says so.
  for (const p of existing) if (!result.groups.some(g => g.key === p.source.key) && !p.source.missing) store.mutatePortfolio(p.id, pp => { pp.source.missing = true; });
  set({ portfolios: result.groups.length, dates: new Set(result.groups.flatMap(g => g.dates.map(d => d.date))).size, template: result.template, skipped: result.skipped });
  if (activateFirst && firstId && !created) store.setActive(firstId);
  return created;
}

function syncPortfolio(id, g) {
  const p = store.listPortfolios().find(x => x.id === id);
  if (!p) return;
  const dates = g.dates.map(d => d.date);
  const pinned = p.source.date && dates.includes(p.source.date) ? p.source.date : '';
  const date = pinned || dates[dates.length - 1];
  const snap = g.dates.find(d => d.date === date);
  // Cheap fingerprint of what this portfolio would show; skip the write (and the re-render) if unchanged.
  const sig = date + '|' + dates.length + '|' + JSON.stringify(snap.rows).length + '|' + hash(JSON.stringify(snap.rows)) + '|' + hash(JSON.stringify(parsed.mapping));
  if (p.source.sig === sig && !p.source.missing) return;
  // Rows reported with quantity 0 (closed that day) price the close in the history, but are not holdings.
  const positions = carryIds(p.positions, snapshotPositions(snap.rows, parsed.mapping, parsed.opts).filter(x => x.type === 'cash' || !(x.qty === 0 || (x.qty == null && x.buyAmount === 0))));
  const hist = snapshotHistory(g, parsed.mapping, parsed.opts);
  store.mutatePortfolio(id, pp => {
    pp.positions = positions;
    pp.valDate = date;
    if (hist) pp.history = mergeHistory(pp.history, hist);
    pp.source = { ...pp.source, date: pinned, dates, shown: date, sig, syncedAt: new Date().toISOString(), missing: false, fileName: rec.name };
  });
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

// Show another date for one portfolio ('' = follow the latest).
export async function setDate(portfolioId, date) {
  const p = store.listPortfolios().find(x => x.id === portfolioId);
  if (!p || !p.source) return;
  if (!parsed && rec && status.state === 'linked') await refresh({ force: true });
  const g = parsed?.groups.find(x => x.key === p.source.key);
  if (!g) return;
  const latest = g.dates[g.dates.length - 1].date;
  store.mutatePortfolio(p.id, pp => { pp.source.date = date === latest ? '' : date; pp.source.sig = ''; }, { silent: true });
  syncPortfolio(p.id, g);
}

let reading = null;
export async function refresh({ force = false } = {}) {
  if (!rec || status.state !== 'linked') return false;
  if (reading) return reading;
  reading = (async () => {
    try {
      const file = await rec.handle.getFile();
      if (!force && parsed && file.lastModified === rec.lastModified) return false;
      const result = await parseFile(file);
      if (result.error) { set({ error: result.error }); return false; }
      rec.lastModified = file.lastModified;
      await idbSet(rec);
      apply(result);
      set({ lastRead: new Date().toISOString(), lastModified: file.lastModified, error: '' });
      return true;
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      // NotReadableError while Excel is mid-save: leave it, the next poll catches up.
      if (denied) { stopPolling(); set({ state: 'needs-permission' }); }
      else if (e && e.name === 'NotFoundError') set({ state: 'error', error: 'not_found' });
      else if (!(e && e.name === 'NotReadableError')) set({ error: (e && e.message) || String(e) });
      return false;
    } finally { reading = null; }
  })();
  return reading;
}

function startPolling() {
  stopPolling();
  timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
}
function stopPolling() { if (timer) clearInterval(timer); timer = null; }
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => { if (status.state === 'linked') refresh(); });
  document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'visible' && status.state === 'linked') refresh(); });
}

// ---- startup ----------------------------------------------------------------------------------------------------
export async function init() {
  if (!supported()) { set({ state: 'unsupported' }); return status; }
  rec = await idbGet();
  if (!rec || !rec.handle) { rec = null; set({ state: 'none' }); return status; }
  let perm = 'prompt';
  try { perm = await rec.handle.queryPermission({ mode: 'read' }); } catch (e) { perm = 'prompt'; }
  set({ name: rec.name, lastModified: rec.lastModified, state: perm === 'granted' ? 'linked' : 'needs-permission' });
  if (perm === 'granted') { await refresh({ force: true }); startPolling(); }
  return status;
}
// After the click on the banner.
export async function reconnect() {
  if (!rec) return status;
  const perm = await rec.handle.requestPermission({ mode: 'read' });
  if (perm !== 'granted') { set({ state: 'needs-permission' }); return status; }
  set({ state: 'linked', error: '' });
  await refresh({ force: true });
  startPolling();
  return status;
}
