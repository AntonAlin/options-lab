// A file on the user's own disk as the place the workspace lives: a JSON file (the whole
// workspace, lossless), a CSV or an Excel file (the active portfolio's positions, which the bulk
// upload reads back). Uses the File System Access API, so it works in Chrome and Edge on desktop;
// elsewhere `supported()` is false and the manual backup buttons remain the fallback.
//
// The file handle is kept in IndexedDB so the link survives a reload. The browser still asks for
// permission again after a restart (a click on the banner), which we cannot avoid.
import * as store from './store.js';
import { positionRows, toCSV, XLSX_URL, XLSX_SRI } from './importer.js';
import { loadScript, debounce } from './util.js';

const DB = 'nexus-filelink', OS = 'meta', KEY = 'main';
export const KINDS = ['json', 'csv', 'xlsx'];
const TYPES = {
  json: { description: 'Nexus Portfolio Lab workspace', accept: { 'application/json': ['.json'] } },
  csv: { description: 'CSV (positions)', accept: { 'text/csv': ['.csv'] } },
  xlsx: { description: 'Excel (positions + history)', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }
};

const status = { state: 'none', name: '', kind: '', lastSaved: null, error: '', pending: false, conflict: null };
const listeners = new Set();
export const supported = () => typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
export const getStatus = () => status;
export const handle = () => (rec ? rec.handle : null);
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function set(patch) { Object.assign(status, patch); listeners.forEach(fn => { try { fn(status); } catch (e) { console.error(e); } }); }

// ---- IndexedDB: one record { handle, kind, name, lastSaved, stamp } -------------------------------
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
async function idbSet(val) {
  const db = await idb();
  await new Promise((resolve, reject) => { const tx = db.transaction(OS, 'readwrite'); tx.objectStore(OS).put(val, KEY); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
}
async function idbDel() {
  try { const db = await idb(); await new Promise((resolve, reject) => { const tx = db.transaction(OS, 'readwrite'); tx.objectStore(OS).delete(KEY); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); } catch (e) { /* nothing to forget */ }
}

let rec = null; // the IndexedDB record while linked

// ---- content builders (pure; also used by the tests) --------------------------------------------------
export function kindOfName(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  const ext = (m ? m[1] : '').toLowerCase();
  return ext === 'json' ? 'json' : ext === 'csv' ? 'csv' : /^xls[xm]?$/.test(ext) ? 'xlsx' : null;
}
export function buildContent(kind, { p = store.active(), lang = 'en', stamp = new Date().toISOString() } = {}) {
  if (kind === 'json') return { blob: new Blob([store.exportWorkspace({ exportedAt: stamp })], { type: 'application/json' }) };
  if (!p) return null;
  const rows = positionRows(p);
  if (kind === 'csv') return { blob: new Blob(['﻿' + toCSV(rows, lang === 'sv' ? ';' : ',')], { type: 'text/csv;charset=utf-8' }) };
  return { rows, p };
}
async function xlsxBlob({ rows, p }) {
  await loadScript(XLSX_URL, { integrity: XLSX_SRI });
  const X = window.XLSX;
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), 'Positions');
  const h = p.history || { dates: [], series: {} };
  const keys = Object.keys(h.series || {});
  if (h.dates?.length && keys.length) {
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['date', ...keys], ...h.dates.map((d, i) => [d, ...keys.map(k => h.series[k][i] ?? '')])]), 'History');
  }
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['portfolio', p.name], ['baseCcy', p.baseCcy], ['valuationDate', p.valDate || ''], ['manager', p.manager || ''], ['savedBy', 'Nexus Portfolio Lab']]), 'Info');
  return new Blob([X.write(wb, { type: 'array', bookType: 'xlsx' })], { type: Object.keys(TYPES.xlsx.accept)[0] });
}

// ---- linking ---------------------------------------------------------------------------------------------
async function adopt(handle, kind) {
  rec = { handle, kind, name: handle.name, lastSaved: null, stamp: null };
  await idbSet(rec);
  set({ state: 'linked', name: handle.name, kind, lastSaved: null, error: '', conflict: null });
}
export async function linkNew(kind) {
  if (!supported()) throw new Error('unsupported');
  const p = store.active();
  const base = (p ? p.name : 'nexus-portfolio-lab').replace(/[\\/:*?"<>|]+/g, '-');
  const handle = await window.showSaveFilePicker({ id: 'nexus-workspace', suggestedName: `${kind === 'json' ? 'nexus-portfolio-lab' : base}.${kind}`, types: [TYPES[kind]] });
  await adopt(handle, kind);
  await save();
  return status;
}
// Link a file that already exists. For JSON the caller decides whether to load it (returned as
// `workspace`) or overwrite it; CSV/XLSX are always overwritten with the current positions.
export async function linkExisting() {
  if (!supported()) throw new Error('unsupported');
  const [handle] = await window.showOpenFilePicker({ id: 'nexus-workspace', multiple: false, types: KINDS.map(k => TYPES[k]) });
  const kind = kindOfName(handle.name);
  if (!kind) throw new Error('kind');
  if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('permission');
  let workspace = null;
  if (kind === 'json') {
    try { const text = await (await handle.getFile()).text(); const obj = JSON.parse(text); if (obj && (obj.portfolios || obj.positions)) workspace = obj; } catch (e) { workspace = null; }
  }
  await adopt(handle, kind);
  return { kind, name: handle.name, workspace };
}
export async function unlink() {
  rec = null;
  await idbDel();
  set({ state: supported() ? 'none' : 'unsupported', name: '', kind: '', lastSaved: null, error: '', conflict: null });
}

// ---- saving ------------------------------------------------------------------------------------------------
let saving = null;
export async function save({ lang = 'en' } = {}) {
  if (!rec || status.state === 'none' || status.state === 'unsupported') return false;
  if (saving) { await saving; }
  saving = (async () => {
    try {
      const stamp = new Date().toISOString();
      const c = buildContent(rec.kind, { lang, stamp });
      if (!c) { set({ pending: false }); return false; } // no active portfolio to mirror
      const blob = c.blob || await xlsxBlob(c);
      const w = await rec.handle.createWritable();
      await w.write(blob);
      await w.close();
      rec.lastSaved = stamp; rec.stamp = stamp;
      await idbSet(rec);
      set({ state: 'linked', lastSaved: stamp, error: '', pending: false, conflict: null });
      return true;
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      set({ state: denied ? 'needs-permission' : 'error', error: denied ? '' : (e && e.message) || String(e), pending: false });
      return false;
    } finally { saving = null; }
  })();
  return saving;
}
const scheduleSave = debounce(opts => { save(opts); }, 1500);
export function markDirty(opts) { if (status.state === 'linked') { set({ pending: true }); scheduleSave(opts); } }

// ---- startup ------------------------------------------------------------------------------------------------
export async function init() {
  if (!supported()) { set({ state: 'unsupported' }); return status; }
  rec = await idbGet();
  if (!rec || !rec.handle) { set({ state: 'none' }); return status; }
  let perm = 'prompt';
  try { perm = await rec.handle.queryPermission({ mode: 'readwrite' }); } catch (e) { perm = 'prompt'; }
  set({ name: rec.name, kind: rec.kind, lastSaved: rec.lastSaved, state: perm === 'granted' ? 'linked' : 'needs-permission' });
  if (perm === 'granted') await checkFile();
  return status;
}
// After the permission click on the banner.
export async function reconnect() {
  if (!rec) return status;
  const perm = await rec.handle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') { set({ state: 'needs-permission' }); return status; }
  set({ state: 'linked', error: '' });
  await checkFile();
  return status;
}
// A JSON file written by another browser or machine (synced folder) carries a newer stamp than
// the one we last wrote: surface it instead of silently overwriting either side.
async function checkFile() {
  if (rec.kind !== 'json') return;
  try {
    const obj = JSON.parse(await (await rec.handle.getFile()).text());
    const fileAt = obj?.exportedAt || null;
    const n = obj?.portfolios ? Object.keys(obj.portfolios).length : 0;
    if (!store.listPortfolios().length && n) { set({ conflict: { fileAt, n, empty: true, workspace: obj } }); return; }
    if (fileAt && fileAt !== rec.stamp && n) set({ conflict: { fileAt, n, empty: false, workspace: obj } });
  } catch (e) { /* unreadable or not yet written: the next save fixes it */ }
}
export async function loadFromFile() {
  const c = status.conflict;
  if (!c || !c.workspace) return 0;
  const n = store.importWorkspace(c.workspace, { merge: false });
  rec.stamp = c.fileAt; await idbSet(rec);
  set({ conflict: null });
  return n;
}
export function dismissConflict() { set({ conflict: null }); }
