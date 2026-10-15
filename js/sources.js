// The connected data sources: where the portfolios live. The app needs at least one; until then
// every portfolio page is the setup page (js/views/setup.js).
//
// A source is a file (CSV, Excel, JSON, XML, ODS on the user's disk or network share) or an HTTP
// API the organisation runs. Several can be connected at once; each portfolio follows exactly one.
// The app reads a source, keeps reading it while it changes, and writes every change made to a
// portfolio's holdings back into it: a new holding is a new row, a deleted one loses its row, an
// edit changes only the cells that changed.
//
// Writing: changes are queued (kept in IndexedDB, so a reload does not lose them), merged into the
// source as it is at that moment — someone else's edit in Excel or another system is not
// overwritten — and logged in the portfolio's control log. When the source cannot be written
// (Excel has the file open, the API is down or refuses), the queue waits and is retried.
//
// The file handles, API addresses and any API headers (tokens) are kept in this browser's
// IndexedDB, nowhere else.
import * as store from './store.js';
import { mergeHistory } from './importer.js';
import { FIELDS } from './instruments.js';
import { analyseSheets, parseExtras, snapshotPositions, snapshotHistory, carryIds, isHeld, diffPositions, applyOps, dropPortfolioRows } from './sourcefile.js';
import { connectorOf, file as fileConn, fileSupported, writable, formatOf, validUrl, serialise } from './connectors.js';
import { uid, todayISO } from './util.js';

export { fileSupported };
export const WRITE_MODES = ['inplace', 'snapshot'];
const FILE_POLL_MS = 4000, API_POLL_DEFAULT = 60, API_POLL_MIN = 15, WRITE_DELAY_MS = 600;

// ---- persistence of the connections ---------------------------------------------------------------------
const DB = 'nexus-sources', OS = 'meta', KEY = 'list';
const OLD_DB = 'nexus-sourcefile'; // one read-only file, before sources could be written or added
function idb(name = DB) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(OS);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(name, key) {
  try {
    const db = await idb(name);
    return await new Promise((resolve, reject) => { const r = db.transaction(OS).objectStore(OS).get(key); r.onsuccess = () => resolve(r.result ?? null); r.onerror = () => reject(r.error); });
  } catch (e) { return null; }
}
// Remembering the connections and queues is a convenience (no reconnect after a reload); failing to
// store them, e.g. in a private window, must not break the connections themselves.
let saving = Promise.resolve();
function save() {
  const list = [...conns.values()].map(c => c.rec);
  saving = saving.then(async () => {
    try {
      const db = await idb();
      await new Promise((resolve, reject) => { const tx = db.transaction(OS, 'readwrite'); tx.objectStore(OS).put(list, KEY); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    } catch (e) { console.warn('Data sources could not be remembered', e); }
  });
  return saving;
}
async function migrateOld() {
  const old = await idbGet(OLD_DB, 'main');
  if (!old?.handle) return [];
  try { const db = await idb(OLD_DB); await new Promise(r => { const tx = db.transaction(OS, 'readwrite'); tx.objectStore(OS).delete('main'); tx.oncomplete = r; tx.onerror = r; }); } catch (e) { /* gone already */ }
  // Same id, so the portfolios it fed pick it back up. Write access is asked for on reconnect.
  return [{ id: old.id, kind: 'file', handle: old.handle, name: old.name, access: writable(formatOf(old.name)) ? 'readwrite' : 'read', stamp: null, pending: [] }];
}

// ---- state ------------------------------------------------------------------------------------------------
// Per source. state: init → linked | needs-permission | error. write: idle | pending | writing | blocked.
const blank = () => ({ state: 'init', error: '', status: 0, lastRead: null, portfolios: 0, dates: 0, template: '', skipped: 0, history: false, write: 'idle', writeError: '', lastWrite: null, queued: 0, localEdits: false });
const conns = new Map(); // id → { rec, st, parsed, timer, reading, flushing, flushTimer }
let phase = 'init';      // init → ready (the stored connections have been looked at)
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(c = null) { listeners.forEach(fn => { try { fn(c); } catch (e) { console.error(e); } }); }
function set(c, patch) { Object.assign(c.st, patch); emit(c); }

// What the pages show: [{ id, kind, name, url, access, format, writeMethod, ..., status }]
const publicRec = rec => { const { handle, pending, headers, ...r } = rec; return { ...r, headers: (headers || []).map(([k]) => [k, '••••']), queued: (pending || []).length }; };
export const list = () => [...conns.values()].map(c => ({ ...publicRec(c.rec), status: c.st }));
export const get = id => { const c = conns.get(id); return c ? { ...publicRec(c.rec), status: c.st } : null; };
export const initialised = () => phase === 'ready';
// The app is usable once one source is connected and readable.
export const ready = () => [...conns.values()].some(c => c.st.state === 'linked');
export const queued = (id = null) => [...conns.values()].filter(c => !id || c.rec.id === id).reduce((n, c) => n + (c.rec.pending || []).length, 0);
export const canWrite = c => !!c && c.rec.access !== 'read' && (c.rec.kind === 'api' ? c.rec.writeMethod === 'PUT' || c.rec.writeMethod === 'POST' : writable(formatOf(c.rec.name)));
export const writableSources = () => [...conns.values()].filter(c => c.st.state === 'linked' && canWrite(c)).map(c => publicRec(c.rec));

// The portfolios one source (or any) feeds.
export const sourced = (id = null) => store.listPortfolios().filter(p => p.source?.file && conns.has(p.source.file) && (!id || p.source.file === id));
export const connOf = p => (p?.source?.file ? conns.get(p.source.file) || null : null);
export const isSourced = p => !!connOf(p);
export const sourceName = p => connOf(p)?.rec.name || p?.source?.fileName || '';
export const handleOf = id => conns.get(id)?.rec.handle || null;
export const fileHandles = () => [...conns.values()].filter(c => c.rec.kind === 'file').map(c => c.rec.handle);

// The holdings on every date in the source for one portfolio: [{ date, positions }], oldest first.
const snapCache = new WeakMap();
export function snapshotsFor(p) {
  const c = connOf(p);
  if (!c?.parsed) return null;
  let m = snapCache.get(c.parsed);
  if (!m) snapCache.set(c.parsed, (m = new Map()));
  if (m.has(p.source.key)) return m.get(p.source.key);
  const g = c.parsed.groups.find(x => x.key === p.source.key);
  const out = g ? g.dates.map(d => ({ date: d.date, positions: snapshotPositions(d.rows, c.parsed.mapping, c.parsed.opts).filter(isHeld) })) : null;
  m.set(p.source.key, out);
  return out;
}
export const datesFor = p => { const c = connOf(p); return c?.parsed ? c.parsed.groups.find(g => g.key === p.source.key)?.dates.map(d => d.date) || [] : p?.source?.dates || []; };

// ---- connecting -------------------------------------------------------------------------------------------
function newConn(rec) { const c = { rec, st: blank(), parsed: null, timer: null, reading: null, flushing: null, flushTimer: null }; conns.set(rec.id, c); return c; }
const logConnect = (c, ids, result) => { for (const id of ids) store.logControl([{ kind: 'source.connect', data: { source: c.rec.name, kind: c.rec.kind, access: canWrite(c) ? 'readwrite' : 'read', portfolios: result.groups.length, dates: datesOf(result) } }], { id }); };

// A file. sameAs: file handles the app writes to otherwise (the linked workspace file), which would
// make the app feed itself.
export async function connectFile({ sameAs = [] } = {}) {
  const picked = await fileConn.pick();
  for (const h of [...sameAs, ...fileHandles()]) if (h && typeof picked.handle.isSameEntry === 'function' && await picked.handle.isSameEntry(h).catch(() => false)) throw Object.assign(new Error('same_file'), { code: 'same_file' });
  // The same file connected before (same name, now detached) keeps its id, so its portfolios come back.
  const old = store.listPortfolios().find(p => p.source?.detached && p.source.kind !== 'api' && p.source.fileName === picked.name && p.source.lastFile && !conns.has(p.source.lastFile));
  const rec = { id: old?.source.lastFile || uid('src'), kind: 'file', handle: picked.handle, name: picked.name, access: picked.access, stamp: null, pending: [] };
  return finishConnect(rec);
}

// An HTTP API. cfg: { name, url, format, headers: [[k, v]], pollSec, writeMethod: none|PUT|POST, writeUrl, withCredentials }
export function apiRec(cfg, id = null) {
  if (!validUrl(cfg.url)) throw Object.assign(new Error('bad_url'), { code: 'bad_url' });
  if (cfg.writeUrl && !validUrl(cfg.writeUrl)) throw Object.assign(new Error('bad_url'), { code: 'bad_url' });
  const host = (() => { try { return new URL(cfg.url).host; } catch (e) { return 'API'; } })();
  return {
    id: id || uid('src'), kind: 'api', name: String(cfg.name || '').trim() || host, url: cfg.url.trim(), format: cfg.format || 'auto',
    headers: (cfg.headers || []).filter(([k]) => String(k || '').trim()), pollSec: Math.max(API_POLL_MIN, Math.round(+cfg.pollSec || API_POLL_DEFAULT)),
    writeMethod: ['PUT', 'POST'].includes(cfg.writeMethod) ? cfg.writeMethod : 'none', writeUrl: (cfg.writeUrl || '').trim(), withCredentials: !!cfg.withCredentials,
    access: ['PUT', 'POST'].includes(cfg.writeMethod) ? 'readwrite' : 'read', stamp: null, pending: []
  };
}
export async function connectApi(cfg) {
  const rec = apiRec(cfg);
  const old = store.listPortfolios().find(p => p.source?.detached && p.source.kind === 'api' && p.source.url === rec.url);
  if (old?.source.lastFile && !conns.has(old.source.lastFile)) rec.id = old.source.lastFile;
  return finishConnect(rec);
}
// Change an API's settings (address, token, polling, writing). Queued writes go to the new address.
export async function updateApi(id, cfg) {
  const c = conns.get(id);
  if (!c || c.rec.kind !== 'api') return;
  const keepHeaders = (cfg.headers || []).map(([k, v]) => [k, v === '••••' ? (c.rec.headers.find(([kk]) => kk === k) || [k, ''])[1] : v]);
  const next = apiRec({ ...cfg, headers: keepHeaders }, id);
  c.rec = { ...next, pending: c.rec.pending, stamp: null };
  await save();
  set(c, { state: 'linked', error: '' });
  await refresh(id, { force: true });
  startPolling(c);
}

async function finishConnect(rec) {
  const { src, stamp } = await connectorOf(rec).read(rec);
  const result = analyse(src, rec);
  if (result.error) throw Object.assign(new Error(result.error), { code: result.error });
  if (conns.has(rec.id)) await disconnect(rec.id);
  const c = newConn(rec);
  rec.stamp = stamp;
  c.parsed = result;
  await save();
  const { created, ids } = apply(c, result, { activateFirst: true });
  logConnect(c, ids, result);
  set(c, { state: 'linked', lastRead: new Date().toISOString(), error: '' });
  startPolling(c);
  return { id: rec.id, created, portfolios: result.groups.length, dates: datesOf(result), access: canWrite(c) ? 'readwrite' : 'read' };
}
const datesOf = result => new Set(result.groups.flatMap(g => g.dates.map(d => d.date))).size;
function analyse(src, rec) {
  const res = analyseSheets(src.sheets, { decimal: src.decimal, templates: store.templates() });
  if (res.error) return res;
  res.extras = parseExtras(src.sheets, { skip: res.sheet, decimal: src.decimal });
  res.format = src.format;
  res.name = rec.name;
  return res;
}

// Keep the portfolios (with their last data), stop following the source. Unwritten changes are dropped.
export async function disconnect(id) {
  const c = conns.get(id);
  if (!c) return;
  stopPolling(c);
  for (const p of sourced(id)) store.mutatePortfolio(p.id, pp => { pp.source = { ...pp.source, detached: true, file: '', lastFile: id, kind: c.rec.kind, url: c.rec.url || '' }; });
  conns.delete(id);
  await save();
  emit(null);
}
// Take the source out of the app: its portfolios go too, each one's control log kept in the archive
// (store.archivePortfolio). The source itself is left as it is.
export async function removeSource(id) {
  const c = conns.get(id);
  if (!c) return 0;
  const pfs = sourced(id);
  for (const p of pfs) store.archivePortfolio(p.id, { reason: 'source_removed', source: c.rec.name });
  c.rec.pending = [];
  await disconnect(id);
  return pfs.length;
}
// Delete one portfolio: its rows leave the source (every date), its control log goes to the archive.
export function removePortfolio(pfId) {
  const p = store.listPortfolios().find(x => x.id === pfId);
  if (!p) return;
  const c = connOf(p);
  if (c && canWrite(c) && (p.source.dates || []).length) enqueue(c, { kind: 'drop', pfId: null, key: p.source.key, label: p.name });
  store.archivePortfolio(pfId, { reason: 'deleted', source: c ? c.rec.name : '' });
}
// A new portfolio in a writable source: it has no rows until its first holding is added.
// srcId: which source; the default is the one set in the setup card, or the first writable one.
export function attachNew(p, srcId = null) {
  const id = srcId || defaultTarget();
  const c = id ? conns.get(id) : null;
  if (!c || !canWrite(c)) return p;
  const keys = new Set([...(c.parsed?.groups || []).map(g => g.key), ...sourced(id).map(x => x.source.key)]);
  let key = (p.name || 'Portfolio').trim(), n = 2;
  while (keys.has(key)) key = `${p.name} (${n++})`;
  p.source = { file: id, fileName: c.rec.name, key, date: '', dates: [], shown: '' };
  return p;
}
export function defaultTarget() {
  const pref = store.settings().srcDefault;
  if (pref && conns.has(pref) && canWrite(conns.get(pref))) return pref;
  return writableSources()[0]?.id || null;
}
// Write a portfolio that lives only in this browser into a source (its holdings on today's date).
export function adoptPortfolio(pfId, srcId = null) {
  const p = store.listPortfolios().find(x => x.id === pfId);
  if (!p || isSourced(p)) return false;
  const q = attachNew({ name: p.name }, srcId);
  if (!q.source) return false;
  const c = conns.get(q.source.file);
  store.mutatePortfolio(pfId, pp => { pp.source = q.source; });
  if (p.positions.length) enqueue(c, { pfId, key: q.source.key, sourceDate: '', targetDate: todayISO(), ops: p.positions.map(pos => ({ kind: 'add', pos })), label: 'adopt' });
  return true;
}

// ---- reading -----------------------------------------------------------------------------------------------
// Push a parsed source into the workspace. Returns how many portfolios were created and the ids touched.
function apply(c, result, { activateFirst = false } = {}) {
  c.parsed = result;
  const base = c.rec.name.replace(/\.[a-z0-9]+$/i, '');
  const existing = sourced(c.rec.id);
  const dropping = new Set((c.rec.pending || []).filter(j => j.kind === 'drop').map(j => j.key));
  let created = 0, firstId = null;
  const ids = [];
  for (const g of result.groups) {
    if (dropping.has(g.key)) continue; // deleted here, not yet out of the source
    let p = existing.find(x => x.source.key === g.key);
    // Connecting the same source again picks its old portfolios back up instead of duplicating them.
    const old = !p && activateFirst ? store.listPortfolios().find(x => x.source?.detached && x.source.lastFile === c.rec.id && x.source.key === g.key) : null;
    if (old) { store.mutatePortfolio(old.id, pp => { pp.source = { ...pp.source, file: c.rec.id, detached: false, sig: '', xsig: '' }; }); p = old; }
    if (!p) {
      p = store.newPortfolio({ name: g.key || base });
      p.source = { file: c.rec.id, fileName: c.rec.name, key: g.key, date: '' };
      store.upsertPortfolio(p, { activate: activateFirst && !created });
      created++;
    }
    firstId ||= p.id;
    ids.push(p.id);
    syncPortfolio(c, p.id, g);
  }
  // A portfolio that has vanished from the source keeps its last data and says so. A new one with
  // no rows yet has not vanished.
  for (const p of existing) if (!result.groups.some(g => g.key === p.source.key) && (p.source.dates || []).length && !p.source.missing) store.mutatePortfolio(p.id, pp => { pp.source.missing = true; });
  set(c, { portfolios: result.groups.length, dates: datesOf(result), template: result.template, skipped: result.skipped, history: !!result.extras?.history });
  if (activateFirst && firstId && !created) store.setActive(firstId);
  return { created, ids };
}

function syncPortfolio(c, id, g) {
  const p = store.listPortfolios().find(x => x.id === id);
  if (!p) return;
  // Changes made here and not yet in the source win until they are: re-reading must not undo them.
  if ((c.rec.pending || []).some(j => j.pfId === id)) return;
  const parsed = c.parsed;
  const dates = g.dates.map(d => d.date);
  const pinned = p.source.date && dates.includes(p.source.date) ? p.source.date : '';
  const date = pinned || dates[dates.length - 1];
  const snap = g.dates.find(d => d.date === date);
  // Cheap fingerprint of what this portfolio would show; skip the write (and the re-render) if unchanged.
  const sig = date + '|' + dates.length + '|' + hash(JSON.stringify(snap.rows)) + '|' + hash(JSON.stringify(parsed.mapping));
  const xh = parsed.extras?.history;
  const xsig = xh ? hash(JSON.stringify(xh.dates) + Object.keys(xh.series).join()) + '|' + xh.dates.length : '';
  if (p.source.sig === sig && p.source.xsig === xsig && !p.source.missing) return;
  // App-side notes on a holding (fields the source has no column for, such as a matched price
  // series) survive a re-read.
  const prevById = new Map(p.positions.map(x => [x.id, x]));
  const positions = carryIds(p.positions, snapshotPositions(snap.rows, parsed.mapping, parsed.opts).filter(isHeld)).map(x => {
    const old = prevById.get(x.id);
    if (!old) return x;
    const keep = Object.entries(old).filter(([k]) => !FIELDS[k] && !(k in x) && k !== 'rawType');
    return keep.length ? { ...x, ...Object.fromEntries(keep) } : x;
  });
  const same = JSON.stringify(positions) === JSON.stringify(p.positions);
  const hist = snapshotHistory(g, parsed.mapping, parsed.opts);
  store.mutatePortfolio(id, pp => {
    if (!same) pp.positions = positions;
    pp.valDate = date;
    if (xh && p.source.xsig !== xsig) pp.history = mergeHistory(pp.history, xh);
    if (hist) pp.history = mergeHistory(pp.history, hist);
    pp.source = { ...pp.source, date: pinned, dates, shown: date, sig, xsig, syncedAt: new Date().toISOString(), missing: false, fileName: c.rec.name };
  }, { keepUndo: same });
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

// Show another date for one portfolio ('' = follow the latest).
export async function setDate(pfId, date) {
  const p = store.listPortfolios().find(x => x.id === pfId);
  const c = connOf(p);
  if (!c) return;
  if (!c.parsed && c.st.state === 'linked') await refresh(c.rec.id, { force: true });
  const g = c.parsed?.groups.find(x => x.key === p.source.key);
  if (!g) return;
  const latest = g.dates[g.dates.length - 1].date;
  store.mutatePortfolio(p.id, pp => { pp.source.date = date === latest ? '' : date; pp.source.sig = ''; }, { silent: true });
  syncPortfolio(c, p.id, g);
}

const readError = e => {
  if (!e) return { error: 'other' };
  if (e.name === 'NotAllowedError' || e.name === 'SecurityError') return { state: 'needs-permission' };
  if (e.name === 'NotFoundError') return { state: 'error', error: 'not_found' };
  if (e.code) return { error: e.code, status: e.status || 0 };
  return { error: e.message || String(e) };
};
export async function refresh(id = null, { force = false, skipFlush = false } = {}) {
  if (!id) { const r = await Promise.all([...conns.keys()].map(k => refresh(k, { force }))); return r.some(Boolean); }
  const c = conns.get(id);
  if (!c || c.st.state !== 'linked') return false;
  if (!skipFlush && (c.rec.pending || []).length && c.st.write !== 'writing') await flush(id);
  if (c.reading) return c.reading;
  c.reading = (async () => {
    try {
      const { stamp, src } = await connectorOf(c.rec).read(c.rec, { since: force || !c.parsed ? null : c.rec.stamp });
      if (!src) return false;
      const result = analyse(src, c.rec);
      if (result.error) { set(c, { error: result.error }); return false; }
      c.rec.stamp = stamp;
      save();
      apply(c, result);
      set(c, { lastRead: new Date().toISOString(), error: '', status: 0 });
      return true;
    } catch (e) {
      // NotReadableError while Excel is mid-save: leave it, the next poll catches up.
      if (e && e.name === 'NotReadableError') return false;
      const r = readError(e);
      if (r.state === 'needs-permission') stopPolling(c);
      set(c, r);
      return false;
    } finally { c.reading = null; }
  })();
  return c.reading;
}

// ---- writing ----------------------------------------------------------------------------------------------
// The date a change is written on. Viewing an older date pins it: the change corrects that date. On
// the latest date, "in place" edits it; "new snapshot" writes the portfolio again on today's date (or
// keeps editing a later date already there), so the source keeps every earlier version.
function targetFor(p) {
  const pinned = p.source?.date || '';
  const shown = p.source?.shown || '';
  if (pinned) return { sourceDate: pinned, targetDate: pinned };
  const latest = (p.source?.dates || []).slice(-1)[0] || '';
  const today = todayISO();
  if ((store.settings().srcWriteMode || 'inplace') === 'snapshot') return { sourceDate: shown, targetDate: latest > today ? latest : today };
  return { sourceDate: shown, targetDate: shown || today };
}
function enqueue(c, job) {
  c.rec.pending = [...(c.rec.pending || []), { ...job, at: new Date().toISOString() }];
  save();
  set(c, { write: c.st.write === 'blocked' ? 'blocked' : 'pending', queued: c.rec.pending.length });
  scheduleFlush(c);
}
function scheduleFlush(c, ms = WRITE_DELAY_MS) { clearTimeout(c.flushTimer); c.flushTimer = setTimeout(() => { flush(c.rec.id); }, ms); }

// Called by the store after every change the user makes to a portfolio (store.update, undo), and by
// pages that change a portfolio other than the active one.
export const recordChange = (id, before, after, label = '') => onUserChange({ id, before, after, label });
function onUserChange({ id, before, after, label }) {
  const p = store.listPortfolios().find(x => x.id === id);
  const c = connOf(p);
  if (!c || c.st.state !== 'linked') return;
  // Only what the source can hold: an app-side note on a holding (a matched price series) is not a change to it.
  const ops = diffPositions(before, after).map(o => (o.kind === 'change' ? { ...o, fields: o.fields.filter(f => f === 'type' || FIELDS[f]) } : o)).filter(o => o.kind !== 'change' || o.fields.length);
  if (!ops.length) return;
  // A read-only source keeps the change here only, until the source next changes.
  if (!canWrite(c)) { set(c, { localEdits: true }); return; }
  enqueue(c, { pfId: id, key: p.source.key, ...targetFor(p), ops, label: label || '' });
}

// Write a source's queue. Returns true when its queue is empty afterwards.
export async function flush(id = null) {
  if (!id) { const r = await Promise.all([...conns.keys()].map(k => flush(k))); return r.every(Boolean); }
  const c = conns.get(id);
  if (!c || !(c.rec.pending || []).length || c.st.state !== 'linked') return !(c?.rec.pending || []).length;
  if (c.flushing) return c.flushing;
  clearTimeout(c.flushTimer);
  c.flushing = (async () => {
    const batch = c.rec.pending.slice();
    set(c, { write: 'writing' });
    try {
      const conn = connectorOf(c.rec);
      const { src } = await conn.read(c.rec);
      const res = analyseSheets(src.sheets, { decimal: src.decimal, templates: store.templates() });
      if (res.error) throw Object.assign(new Error(res.error), { code: res.error });
      const sheet = src.sheets.find(s => s.name === res.sheet) || src.sheets[0];
      let rows = sheet.rows, layout = res.layout, mapping = res.mapping;
      const done = [];
      for (const job of batch) {
        if (job.kind === 'drop') { rows = dropPortfolioRows(rows, layout, job.key).rows; continue; }
        const r = applyOps(rows, { layout, mapping, opts: res.opts, key: job.key, sourceDate: job.sourceDate, targetDate: job.targetDate, ops: job.ops });
        rows = r.rows; layout = r.layout; mapping = r.mapping;
        done.push({ job, stats: r.stats });
      }
      const out = await serialise(src, { sheet: sheet.name, rows, layout, mapping, name: c.rec.name });
      await conn.write(c.rec, { ...out, etag: src.etag || '' });
      c.rec.pending = c.rec.pending.slice(batch.length);
      await save();
      // One control-log entry per portfolio per write: what reached the source, on which date.
      const per = new Map();
      for (const { job, stats } of done) {
        const cur = per.get(job.pfId) || { source: c.rec.name, date: job.targetDate, added: 0, removed: 0, changed: 0, copied: 0, missing: 0, columns: [] };
        for (const k of ['added', 'removed', 'changed', 'copied', 'missing']) cur[k] += stats[k];
        cur.columns = [...new Set([...cur.columns, ...stats.columns])];
        cur.date = job.targetDate;
        per.set(job.pfId, cur);
      }
      for (const [pid, data] of per) if (pid && store.listPortfolios().some(p => p.id === pid)) store.logControl([{ kind: 'source.write', data }], { id: pid });
      set(c, { write: c.rec.pending.length ? 'pending' : 'idle', writeError: '', lastWrite: new Date().toISOString(), queued: c.rec.pending.length });
      await refresh(id, { force: true, skipFlush: true });
      if (c.rec.pending.length) scheduleFlush(c);
      return !c.rec.pending.length;
    } catch (e) {
      console.warn(`The data source ${c.rec.name} could not be written`, e);
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      if (denied) { stopPolling(c); set(c, { state: 'needs-permission' }); }
      // NoModificationAllowedError / InvalidStateError: Excel has the file open. A 409/412 from an
      // API: it changed meanwhile; the retry reads it again first. The poll retries.
      set(c, { write: 'blocked', writeError: e?.code ? e.code + (e.status ? ' ' + e.status : '') : e?.name || e?.message || String(e), queued: (c.rec.pending || []).length });
      return false;
    } finally { c.flushing = null; }
  })();
  return c.flushing;
}
// Changes waiting to be written are thrown away (the source wins). The portfolios are re-read.
export async function discardPending(id) {
  const c = conns.get(id);
  if (!c) return;
  c.rec.pending = [];
  await save();
  set(c, { write: 'idle', writeError: '', queued: 0, localEdits: false });
  for (const p of sourced(id)) store.mutatePortfolio(p.id, pp => { pp.source.sig = ''; }, { silent: true });
  await refresh(id, { force: true, skipFlush: true });
}

// ---- polling ----------------------------------------------------------------------------------------------
function startPolling(c) {
  stopPolling(c);
  const ms = c.rec.kind === 'api' ? Math.max(API_POLL_MIN, c.rec.pollSec || API_POLL_DEFAULT) * 1000 : FILE_POLL_MS;
  c.timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(c.rec.id); }, ms);
}
function stopPolling(c) { if (c.timer) clearInterval(c.timer); c.timer = null; }
if (typeof window !== 'undefined') {
  // Files are cheap to look at on focus; APIs keep to their own interval.
  const onFocus = () => { for (const c of conns.values()) if (c.st.state === 'linked' && c.rec.kind === 'file') refresh(c.rec.id); };
  window.addEventListener('focus', onFocus);
  document.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'visible') onFocus(); });
  // Last chance for queued changes when the tab closes.
  window.addEventListener('pagehide', () => { if (queued()) flush(); });
}

// ---- startup ----------------------------------------------------------------------------------------------
export async function init() {
  store.onUserChange(onUserChange);
  let recs = (await idbGet(DB, KEY)) || [];
  if (!recs.length) recs = await migrateOld();
  for (const rec of recs) {
    rec.pending ||= [];
    const c = newConn(rec);
    c.st.queued = rec.pending.length;
    c.st.write = rec.pending.length ? 'pending' : 'idle';
  }
  if (recs.length) save();
  // Files need the browser's permission again after a restart (one click); APIs just get read.
  await Promise.all([...conns.values()].map(async c => {
    if (c.rec.kind === 'file') {
      if (!fileSupported()) { c.st.state = 'error'; c.st.error = 'unsupported'; return; }
      const perm = await fileConn.permission(c.rec);
      c.st.state = perm === 'granted' ? 'linked' : 'needs-permission';
    } else c.st.state = 'linked';
    if (c.st.state === 'linked') { await refresh(c.rec.id, { force: true }); if (c.st.state === 'linked') startPolling(c); }
  }));
  phase = 'ready';
  emit(null);
}
// After the click on the banner or the card.
export async function reconnect(id) {
  const c = conns.get(id);
  if (!c) return;
  if (c.rec.kind === 'file') {
    let perm = await fileConn.permission(c.rec, { request: true });
    // An old read-only connection: write access was refused, so it stays read only.
    if (perm !== 'granted' && c.rec.access !== 'read') { c.rec.access = 'read'; perm = await fileConn.permission(c.rec, { request: true }); await save(); }
    if (perm !== 'granted') { set(c, { state: 'needs-permission' }); return; }
  }
  set(c, { state: 'linked', error: '' });
  await refresh(id, { force: true });
  startPolling(c);
}
