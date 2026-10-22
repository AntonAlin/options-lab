// Transports for the data sources in js/sources.js. A connector reads a source into rows and writes
// rows back in the same format; everything in between (layout, mapping, the change as row
// operations) is the same for all of them and lives in js/sourcefile.js.
//
//   file  a file on the user's disk or network share, through the File System Access API (Chrome
//         and Edge on desktop). CSV / TSV / TXT, JSON, XML, Excel (.xlsx .xlsm .xls) and
//         OpenDocument (.ods). Read and written, except XML, which is read only.
//   memory  rows held in this tab only, never stored: the one-click demo, and a file opened read
//         only through a plain file input where the browser has no File System Access API
//         (Safari, Firefox, every mobile browser). Read once; nothing is written back or polled.
//   api   an HTTP endpoint the organisation runs (a PMS, a custodian gateway, an internal service).
//         Read with GET; written, if configured, by sending the whole updated document back with
//         PUT or POST (If-Match when the endpoint gives an ETag, so a concurrent change is refused
//         rather than overwritten). JSON, CSV or XML. The endpoint must allow this site's origin (CORS).
import { parseText, sheetRows, XLSX_URL, XLSX_SRI } from './importer.js';
import { rowsToCSV, rowsToJSON, jsonLocate, rowsForWorkbook } from './sourcefile.js';
import { loadScript } from './util.js';

export const FILE_ACCEPT = {
  'text/csv': ['.csv', '.txt', '.tsv'],
  'application/json': ['.json'],
  'application/xml': ['.xml'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.xlsm'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.oasis.opendocument.spreadsheet': ['.ods']
};
export const FILE_EXT = /\.(csv|txt|tsv|json|xml|xlsx|xlsm|xls|ods)$/i;
export const API_FORMATS = ['auto', 'json', 'csv', 'xml'];
export const WRITE_METHODS = ['none', 'PUT', 'POST'];

// The format a name or content type stands for.
export function formatOf(name = '', contentType = '') {
  const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1]?.toLowerCase() || '';
  if (['xlsx', 'xlsm', 'xls', 'ods'].includes(ext)) return 'xlsx';
  if (ext === 'json' || /json/i.test(contentType)) return 'json';
  if (ext === 'xml' || /xml/i.test(contentType)) return 'xml';
  if (['csv', 'tsv', 'txt'].includes(ext) || /csv|text\/plain|tab-separated/i.test(contentType)) return 'csv';
  return '';
}
export const writable = format => ['csv', 'json', 'xlsx'].includes(format);

// ---- one parse for reading and writing ------------------------------------------------------------------
// { format, sheets: [{ name, rows }], decimal, delim, bom, wb (workbooks), root (JSON) }
export async function parseBytes({ name, text = null, buffer = null, contentType = '', format = '' }) {
  const fmt = format && format !== 'auto' ? format : formatOf(name, contentType);
  if (fmt === 'xlsx') {
    await loadScript(XLSX_URL, { integrity: XLSX_SRI });
    const X = window.XLSX;
    const wb = X.read(buffer, { type: 'array', cellDates: true });
    return { format: 'xlsx', wb, sheets: wb.SheetNames.map(n => ({ name: n, rows: sheetRows(wb.Sheets[n]) })), decimal: '.' };
  }
  let s = text ?? '';
  const bom = s.charCodeAt(0) === 0xfeff;
  if (bom) s = s.slice(1);
  // parseText sniffs JSON and XML by the first character when the name does not say.
  const hint = fmt === 'json' ? 'x.json' : fmt === 'xml' ? 'x.xml' : fmt === 'csv' ? 'x.csv' : String(name).toLowerCase();
  const r = parseText(s, hint);
  const out = { format: r.kind === 'json' ? 'json' : r.kind === 'xml' ? 'xml' : 'csv', sheets: r.sheets, decimal: r.decimal, delim: r.delim || ',', bom };
  if (out.format === 'json') { out.root = JSON.parse(s); out.loc = jsonLocate(out.root); }
  return out;
}

// Rows back into the format they came in. Returns { body, type }.
export async function serialise(src, { sheet, rows, layout, mapping, name = '' }) {
  if (src.format === 'csv') return { body: rowsToCSV(rows, { delim: src.delim, decimal: src.decimal, bom: src.bom }), type: 'text/csv;charset=utf-8' };
  if (src.format === 'json') return { body: rowsToJSON(rows, { headerRow: layout.headerRow, root: src.root, loc: src.loc }), type: 'application/json' };
  if (src.format === 'xlsx') {
    const X = window.XLSX;
    const old = src.wb.Sheets[sheet];
    const ws = X.utils.aoa_to_sheet(rowsForWorkbook(rows, layout, mapping), { cellDates: true, dateNF: 'yyyy-mm-dd' });
    if (old?.['!cols']) ws['!cols'] = old['!cols'];
    src.wb.Sheets[sheet] = ws;
    const bookType = /\.xlsm$/i.test(name) ? 'xlsm' : /\.xls$/i.test(name) ? 'biff8' : /\.ods$/i.test(name) ? 'ods' : 'xlsx';
    return { body: new Blob([X.write(src.wb, { type: 'array', bookType, cellDates: true })], { type: 'application/octet-stream' }), type: 'application/octet-stream' };
  }
  throw Object.assign(new Error('read_only_format'), { code: 'read_only_format' });
}

const err = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });

// ---- file ------------------------------------------------------------------------------------------------
export const fileSupported = () => typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
export const file = {
  // Opens the picker; returns { handle, name, access }. Asks for read and write; a refusal of write
  // still connects, read only, and says so.
  async pick() {
    if (!fileSupported()) throw err('unsupported');
    const [handle] = await window.showOpenFilePicker({ id: 'nexus-source', multiple: false, types: [{ description: 'Holdings (CSV, Excel, JSON, XML, ODS)', accept: FILE_ACCEPT }] });
    if (!FILE_EXT.test(handle.name)) throw err('kind');
    let access = 'readwrite';
    const ask = async mode => (await handle.queryPermission?.({ mode })) === 'granted' || (await handle.requestPermission({ mode })) === 'granted';
    if (!writable(formatOf(handle.name)) || !(await ask('readwrite'))) {
      access = 'read';
      if (!(await ask('read'))) throw err('permission');
    }
    return { handle, name: handle.name, access };
  },
  async permission(rec, { request = false } = {}) {
    const mode = rec.access === 'read' ? 'read' : 'readwrite';
    try { return await (request ? rec.handle.requestPermission({ mode }) : rec.handle.queryPermission({ mode })); } catch (e) { return 'prompt'; }
  },
  // { stamp, src } — stamp changes when the file does; src is null when the stamp is unchanged.
  async read(rec, { since = null } = {}) {
    const f = await rec.handle.getFile();
    if (since !== null && f.lastModified === since) return { stamp: f.lastModified, src: null };
    const fmt = formatOf(rec.name);
    const src = await parseBytes({ name: rec.name, text: fmt === 'xlsx' ? null : await f.text(), buffer: fmt === 'xlsx' ? await f.arrayBuffer() : null });
    return { stamp: f.lastModified, src };
  },
  async write(rec, { body }) {
    const w = await rec.handle.createWritable();
    await w.write(body);
    await w.close();
  },
  sameAs: async (rec, other) => !!(other && typeof rec.handle?.isSameEntry === 'function' && await rec.handle.isSameEntry(other).catch(() => false))
};

// ---- api -------------------------------------------------------------------------------------------------
const headersOf = rec => Object.fromEntries((rec.headers || []).filter(([k]) => String(k || '').trim()).map(([k, v]) => [String(k).trim(), String(v ?? '')]));
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
export function validUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' || (x.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname)); } catch (e) { return false; }
}
export const api = {
  async read(rec, { since = null } = {}) {
    let res;
    try { res = await fetch(rec.url, { method: 'GET', headers: headersOf(rec), cache: 'no-store', credentials: rec.withCredentials ? 'include' : 'omit' }); }
    catch (e) { throw err('network'); } // CORS refusals look exactly like this from inside the page
    if (res.status === 401 || res.status === 403) throw err('auth', { status: res.status });
    if (!res.ok) throw err('http', { status: res.status });
    const ct = res.headers.get('content-type') || '';
    const etag = res.headers.get('etag') || '';
    const fmt = rec.format && rec.format !== 'auto' ? rec.format : formatOf(new URL(rec.url).pathname, ct);
    const isBinary = fmt === 'xlsx' || /spreadsheet|excel|octet-stream/i.test(ct);
    const buffer = isBinary ? await res.arrayBuffer() : null;
    const text = isBinary ? null : await res.text();
    const stamp = etag || res.headers.get('last-modified') && res.headers.get('last-modified') + '|' + hash(text || '') || hash(text || String(buffer?.byteLength || 0));
    if (since !== null && stamp === since) return { stamp, src: null };
    const src = await parseBytes({ name: new URL(rec.url).pathname, text, buffer, contentType: ct, format: isBinary ? 'xlsx' : fmt });
    src.etag = etag;
    return { stamp, src };
  },
  async write(rec, { body, type, etag = '' }) {
    const method = rec.writeMethod === 'POST' ? 'POST' : 'PUT';
    const headers = { ...headersOf(rec), 'content-type': type };
    if (etag) headers['if-match'] = etag;
    let res;
    try { res = await fetch(rec.writeUrl || rec.url, { method, headers, body, credentials: rec.withCredentials ? 'include' : 'omit' }); }
    catch (e) { throw err('network'); }
    if (res.status === 409 || res.status === 412) throw err('conflict', { status: res.status });
    if (res.status === 401 || res.status === 403) throw err('auth', { status: res.status });
    if (!res.ok) throw err('http', { status: res.status });
  }
};
// ---- memory ----------------------------------------------------------------------------------------------
// rec.src is a parsed source ({ format, sheets, decimal, ... }) built in the page. It never changes,
// so a read with a stamp is always "unchanged"; there is nothing to write to.
export const memory = {
  async read(rec, { since = null } = {}) {
    if (since !== null && since === rec.stamp) return { stamp: rec.stamp, src: null };
    return { stamp: rec.stamp, src: rec.src };
  },
  async write() { throw err('read_only_format'); }
};
// A File from <input type="file"> (or a drop), parsed the way a connected file is.
export async function readFileObject(f) {
  if (!FILE_EXT.test(f.name)) throw err('kind');
  const fmt = formatOf(f.name, f.type);
  return parseBytes({ name: f.name, text: fmt === 'xlsx' ? null : await f.text(), buffer: fmt === 'xlsx' ? await f.arrayBuffer() : null, contentType: f.type });
}
export const connectorOf = rec => (rec.kind === 'api' ? api : rec.kind === 'memory' ? memory : file);
