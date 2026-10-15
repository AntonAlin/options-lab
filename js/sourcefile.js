// The data in a connected source, as rows: where the date, portfolio and field columns are, how the
// rows split into portfolios and dates, and how a change made in the app becomes row operations
// written back in the source's own format. Pure functions only (no browser APIs), so the tests run
// them under Node; js/sources.js owns the connections and js/connectors.js the transports.
//
// The first column holds a date, so one source can carry many snapshots — a daily holdings dump
// appended to over time — and, with a portfolio column, many portfolios.
import { autoMapping, rowsToPositions, detectTemplate, applyTemplateMapping, parseDate, guessField, parseHistory } from './importer.js';
import { normKey, INSTRUMENTS, FIELDS, typeLabel, resolveType } from './instruments.js';
import { posKey as key } from './insights.js';
import { uid, isNum } from './util.js';
import { convertTPTSheets } from './tpt.js';

// ---- reading -------------------------------------------------------------------------------------------

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
export const PORTFOLIO_HEADER = 'Portfolio', DATE_HEADER = 'Date';

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
  if (dateCol < 0) {
    // A template with headers and no rows yet: a date header in a row that also names two fields.
    const hr = rows.slice(0, 15).findIndex(r => r.some(isDateHeader) && r.filter(h => guessField(h)).length >= 2);
    if (hr >= 0) return { headerRow: hr, header: rows[hr].map(headerText), dateCol: rows[hr].findIndex(isDateHeader), pfCol: rows[hr].findIndex(h => !isDateHeader(h) && isPortfolioHeader(h)) };
    return { error: dateRatio(sample, 0) >= 0.5 && headerFor(0) < 0 ? 'no_header' : 'no_date' };
  }
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
//   [{ key, dates: [{ date, rows }] }] with dates ascending. key is '' when there is no portfolio column.
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

// Column → field mapping: a saved import template that matches the headers wins (so the bulk-upload
// page is where an odd layout gets taught once), otherwise the auto-mapping. The date and portfolio
// columns never map to a position field.
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

// A saved template that names its date column (and portfolio column) finds the header row and both
// columns itself, so a layout the detector cannot read — the date in column 7 under "Pricing day",
// headers on row 4 — is mapped once and read the same way every time after.
export function templateLayout(rows, templates = []) {
  const withDate = (templates || []).filter(x => x && x.dateHeader);
  if (!withDate.length) return null;
  const hit = detectTemplate(withDate, [{ rows }]);
  if (!hit) return null;
  const header = rows[hit.headerRow].map(headerText);
  const nk = header.map(h => normKey(h));
  const dateCol = nk.indexOf(hit.template.dateHeader);
  if (dateCol < 0) return null;
  let pfCol = hit.template.pfHeader ? nk.indexOf(hit.template.pfHeader) : -1;
  if (!hit.template.pfHeader) pfCol = header.findIndex((h, c) => c !== dateCol && isPortfolioHeader(h));
  return { headerRow: hit.headerRow, header, dateCol, pfCol };
}

// Every row is kept, invalid ones included: a live feed must not drop a holding silently. The
// holdings page flags rows with errors.
export function snapshotPositions(rows, mapping, opts) {
  return rowsToPositions(rows, mapping, opts).map(r => r.pos);
}
// Rows reported with quantity 0 (closed that day) price the close in the history, but are not holdings.
export const isHeld = x => x.type === 'cash' || !(x.qty === 0 || (x.qty == null && x.buyAmount === 0));

// ISIN, then ticker, then name; '' when a position has none of them.
export const posKey = x => { const k = key(x); return k.startsWith('x:') ? '' : k; };
const canon = v => {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
};
const terms = x => { const { id, ...rest } = x; return canon(rest); };

// Keep position ids stable across refreshes so selections, transactions and pending writes keep
// pointing at the right holding. A position without a key keeps its id if one with exactly the same
// terms had one.
export function carryIds(prev, next) {
  const ids = new Map(), byTerms = new Map();
  (prev || []).forEach(x => {
    const k = posKey(x);
    if (k) { if (!ids.has(k)) ids.set(k, x.id); return; }
    const tm = terms(x);
    if (!byTerms.has(tm)) byTerms.set(tm, []);
    byTerms.get(tm).push(x.id);
  });
  const used = new Set();
  return next.map(x => {
    const k = posKey(x);
    let id = k ? ids.get(k) : (byTerms.get(terms(x)) || []).find(i => !used.has(i)) || null;
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

// Parse a whole sheet into { layout, mapping, opts, template, groups, skipped } or { error }.
// allowEmpty: a template with headers only is a valid (empty) source, to be filled from the app.
export function analyseRows(rows, { decimal = '.', templates = [], allowEmpty = false } = {}) {
  const layout = templateLayout(rows, templates) || detectLayout(rows);
  if (layout.error) return layout;
  const { mapping, opts, template } = sourceMapping(layout, templates);
  if (mapping.filter(Boolean).length < 2) return { error: 'no_fields' };
  const { groups, skipped } = splitSnapshots(rows, layout);
  if (!groups.length && !allowEmpty) return { error: 'no_rows' };
  return { layout, mapping, opts: { decimal, ...opts }, template, groups, skipped };
}

// The holdings sheet of a parsed source: the first sheet with a date column and fields.
// A FinDatEx TPT report is converted to the platform's layout first (js/tpt.js); tpt says so, and
// such a source is read only — the report is the fund manager's, not something to edit in place.
export function analyseSheets(sheetsIn, opts = {}) {
  const { sheets, tpt } = convertTPTSheets(sheetsIn);
  const usable = sheets.filter(s => s.rows.length >= 1);
  const done = x => (tpt && !x.error ? { ...x, tpt } : x);
  for (const sh of usable) { const x = analyseRows(sh.rows, opts); if (!x.error) return done({ ...x, sheet: sh.name }); }
  for (const sh of usable) { const x = analyseRows(sh.rows, { ...opts, allowEmpty: true }); if (!x.error) return done({ ...x, sheet: sh.name }); }
  return usable.length ? analyseRows(usable[0].rows, opts) : { error: 'no_rows' };
}

// Other sheets of a workbook: a price history (sheet named History / Prices / Historik / Kurser,
// wide or long, the layout the bulk upload's history import reads). Read, never written.
const HISTORY_SHEET = /^(price\s*)?histor(y|ik)$|^prices?$|^priser$|^kurser$|^prishistorik$|^kurshistorik$/i;
export function parseExtras(sheets, { skip = '', decimal = '.' } = {}) {
  let history = null;
  for (const sh of sheets) {
    if (sh.name === skip || !HISTORY_SHEET.test(String(sh.name || '').trim())) continue;
    try { history = parseHistory(sh.rows, decimal); } catch (e) { /* too few dates: ignore */ }
    if (history) break;
  }
  return { history };
}

// ---- writing: changes in the app as row operations ---------------------------------------------------------

// The difference between two versions of a portfolio's holdings: removals, edits, additions.
export function diffPositions(before = [], after = []) {
  const a = new Map(before.map(x => [x.id, x])), b = new Map(after.map(x => [x.id, x]));
  const ops = [];
  for (const [id, y] of a) if (!b.has(id)) ops.push({ kind: 'remove', pos: y });
  for (const [id, x] of b) {
    const y = a.get(id);
    if (!y) continue;
    const fields = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(k => k !== 'id' && canon(x[k] ?? null) !== canon(y[k] ?? null));
    if (fields.length) ops.push({ kind: 'change', before: y, after: x, fields });
  }
  for (const [id, x] of b) if (!a.has(id)) ops.push({ kind: 'add', pos: x });
  return ops;
}

export const headerOf = f => (f === 'type' ? 'Instrument type' : FIELDS[f]?.en || f);
const empty = v => v === undefined || v === null || v === '';
// A value as the source holds it: a column's scale undone.
function encode(field, v, opts = {}) {
  if (empty(v)) return '';
  const sc = opts.transforms?.[field]?.scale;
  if (isNum(v) && isNum(sc) && sc !== 0 && sc !== 1) return v / sc;
  return v;
}

// Apply one portfolio's operations to the rows of the holdings sheet. Pure: returns new rows and the
// (possibly widened) layout and mapping, plus what was done.
//   key         the portfolio's value in the Portfolio column ('' when there is none)
//   sourceDate  the date the app showed when the change was made ('' for a portfolio with no rows yet)
//   targetDate  the date the change is written on: the same date (edit in place) or a later one, in
//               which case the source date's rows are first copied to it (a new dated snapshot)
//   ops         [{ kind: 'add', pos } | { kind: 'remove', pos } | { kind: 'change', before, after, fields }]
export function applyOps(rowsIn, { layout: layoutIn, mapping: mapIn, opts = {}, key = '', sourceDate = '', targetDate, ops = [] }) {
  const rows = rowsIn.map(r => (Array.isArray(r) ? [...r] : []));
  const layout = { ...layoutIn };
  const mapping = [...mapIn];
  const header = rows[layout.headerRow];
  // Cells to the right of the last header belong to no column; new columns start after them.
  const width = Math.max(...rows.map(r => r.length));
  while (header.length < width) header.push('');
  while (mapping.length < header.length) mapping.push('');
  const stats = { added: 0, removed: 0, changed: 0, copied: 0, missing: 0, columns: [] };
  const addColumn = (title, field) => { header.push(title); mapping.push(field); return header.length - 1; };
  if (layout.pfCol < 0 && key) layout.pfCol = addColumn(PORTFOLIO_HEADER, '');
  const rowKey = r => (layout.pfCol >= 0 ? String(r[layout.pfCol] ?? '').trim() : '');
  const blockIdx = date => (date ? rows.map((_, i) => i).filter(i => i > layout.headerRow && cellDate(rows[i][layout.dateCol]) === date && rowKey(rows[i]) === key) : []);

  let idx = blockIdx(targetDate);
  if (!idx.length && sourceDate && sourceDate !== targetDate) {
    for (const i of blockIdx(sourceDate)) { const r = [...rows[i]]; r[layout.dateCol] = targetDate; rows.push(r); stats.copied++; }
    idx = blockIdx(targetDate);
  }

  // The type column: reuse the source's own spelling of a type (a template's code, the English
  // name, the id), so the rows the app adds look like the ones already there.
  const typeCol = () => { let c = mapping.indexOf('type'); if (c < 0) c = addColumn(headerOf('type'), 'type'); return c; };
  const typeRaw = type => {
    for (const [raw, id] of Object.entries(opts.typeMap || {})) if (id === type) return raw;
    const c = mapping.indexOf('type');
    if (c >= 0) for (const r of rows.slice(layout.headerRow + 1)) { const raw = String(r[c] ?? '').trim(); if (raw && (opts.typeMap?.[raw] || resolveType(raw)) === type) return raw; }
    const label = typeLabel(type);
    return resolveType(label) === type ? label : type;
  };
  const constant = (f, v, type) => canon(opts.constants?.[f] ?? INSTRUMENTS[type]?.defaults?.[f] ?? null) === canon(v ?? null);
  const setCell = (r, f, v, type) => {
    if (!FIELDS[f] || f === 'type') return;
    let c = mapping.indexOf(f);
    if (c < 0) {
      if (empty(v) || constant(f, v, type)) return; // nothing to keep that the reader would not supply anyway
      c = addColumn(headerOf(f), f);
      stats.columns.push(f);
    }
    while (r.length <= c) r.push('');
    r[c] = encode(f, v, opts);
  };

  // The rows on the target date, parsed the way the reader parses them, to find each position's row.
  const entries = rowsToPositions(idx.map(i => rows[i]), mapping, opts).map(e => ({ pos: e.pos, i: idx[e.line - 1] }));
  const pool = new Set(entries);
  const score = (a, b) => { const ks = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => k !== 'id'); return ks.length ? ks.filter(k => canon(a[k] ?? null) === canon(b[k] ?? null)).length / ks.length : 0; };
  const find = (pos, { exactOnly = false } = {}) => {
    const k = posKey(pos);
    if (exactOnly && !k) return null;
    const cands = [...pool].filter(e => posKey(e.pos) === k).sort((a, b) => score(b.pos, pos) - score(a.pos, pos));
    const hit = cands[0];
    if (!hit || (!k && score(hit.pos, pos) < 0.999)) return null; // without a key only an exact match counts
    pool.delete(hit);
    return hit;
  };
  const write = (r, pos, fields) => {
    for (const f of fields) {
      if (f === 'type') { const c = typeCol(); while (r.length <= c) r.push(''); r[c] = pos.type === 'unknown' ? pos.rawType || '' : typeRaw(pos.type); }
      else setCell(r, f, pos[f], pos.type);
    }
  };

  const dropped = new Set(), added = [];
  const newRow = pos => {
    const r = new Array(header.length).fill('');
    r[layout.dateCol] = targetDate;
    if (layout.pfCol >= 0) r[layout.pfCol] = key;
    write(r, pos, ['type', ...(INSTRUMENTS[pos.type]?.fields || Object.keys(pos))]);
    return r;
  };
  const allFields = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => k !== 'id');
  for (const op of ops) {
    if (op.kind === 'remove') {
      const e = find(op.pos);
      if (e) { dropped.add(e.i); stats.removed++; } else stats.missing++;
    } else if (op.kind === 'change') {
      const e = find(op.before);
      if (!e) { added.push(newRow(op.after)); stats.added++; stats.missing++; continue; }
      write(rows[e.i], op.after, op.fields);
      stats.changed++;
    } else if (op.kind === 'add') {
      // The source may already have a row for it on that date (closed out with quantity 0, or added
      // by someone else meanwhile): that row is updated, never doubled.
      const e = find(op.pos, { exactOnly: true });
      if (e) { write(rows[e.i], op.pos, allFields(e.pos, op.pos)); stats.changed++; }
      else { added.push(newRow(op.pos)); stats.added++; }
    }
  }
  // New rows go right after the portfolio's block on the target date, so the sheet stays readable.
  const after = idx.length ? Math.max(...idx) : rows.length - 1;
  const out = [];
  rows.forEach((r, i) => { if (!dropped.has(i)) out.push(r); if (i === after) out.push(...added); });
  return { rows: out, layout: { ...layout, header: out[layout.headerRow].map(headerText) }, mapping, stats };
}

// Every row of one portfolio, on every date, gone (a portfolio deleted in the app).
export function dropPortfolioRows(rowsIn, layout, key) {
  let n = 0;
  const rows = rowsIn.filter((r, i) => { const hit = i > layout.headerRow && cellDate(r[layout.dateCol]) && (layout.pfCol >= 0 ? String(r[layout.pfCol] ?? '').trim() : '') === key; if (hit) n++; return !hit; });
  return { rows, removed: n };
}

// ---- serialising rows back into the source's format -------------------------------------------------------

// CSV out: the source's own delimiter and decimal sign, every row padded to the header's width.
export function rowsToCSV(rows, { delim = ',', decimal = '.', bom = true } = {}) {
  const width = Math.max(...rows.map(r => r.length));
  const cell = v => (v instanceof Date ? parseDate(v) : typeof v === 'number' && decimal === ',' ? String(v).replace('.', ',') : v);
  // Quote only what the delimiter needs, so 1,5 in a semicolon file stays a number to Excel.
  const q = v => { const x = String(v ?? ''); return x.includes(delim) || /["\r\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
  return (bom ? '﻿' : '') + rows.map(r => Array.from({ length: width }, (_, i) => q(cell(r[i] ?? ''))).join(delim)).join('\r\n') + '\r\n';
}

// JSON: where the records sit in the document. Same search as importer.parseJSONRows (the largest
// array of objects or arrays, depth first), so the rows read and the rows written are the same list.
export function jsonLocate(root) {
  const isRecords = a => Array.isArray(a) && a.length && a.every(x => x && typeof x === 'object');
  const find = (o, path, depth = 0) => {
    if (isRecords(o)) return { path, n: o.length };
    if (depth > 6 || !o || typeof o !== 'object') return null;
    let best = null;
    for (const [k, v] of Object.entries(o)) { const f = find(v, [...path, k], depth + 1); if (f && (!best || f.n > best.n)) best = f; }
    return best;
  };
  const hit = find(root, []);
  if (!hit) return null;
  const arr = hit.path.reduce((o, k) => o[k], root);
  return { path: hit.path, arrays: Array.isArray(arr[0]) };
}
// The records rebuilt from rows (header row first): dotted headers become nested objects again,
// empty cells are left out, dates are ISO text. With no records found (a new source) the document
// is a plain array.
export function rowsToJSON(rows, { headerRow = 0, root = null, loc = null } = {}) {
  const val = v => (v instanceof Date ? parseDate(v) : v);
  const header = (rows[headerRow] || []).map(headerText);
  const body = rows.slice(headerRow + 1);
  let records;
  if (loc?.arrays) records = [rows[headerRow], ...body].map(r => r.map(v => (v === '' ? null : val(v))));
  else {
    records = body.map(r => {
      const o = {};
      header.forEach((h, c) => {
        const v = r[c];
        if (!h || v === '' || v === undefined || v === null) return;
        const parts = h.split('.');
        let t = o;
        parts.slice(0, -1).forEach(p => { if (!t[p] || typeof t[p] !== 'object') t[p] = {}; t = t[p]; });
        t[parts.at(-1)] = val(v);
      });
      return o;
    });
  }
  let doc = records;
  if (root && loc && loc.path.length) {
    doc = JSON.parse(JSON.stringify(root));
    let t = doc;
    loc.path.slice(0, -1).forEach(k => { t = t[k]; });
    t[loc.path.at(-1)] = records;
  }
  return JSON.stringify(doc, null, 2) + '\n';
}

// Rows with real dates for a workbook: the date column and every date field.
export function rowsForWorkbook(rows, layout, mapping) {
  const dateCols = new Set([layout.dateCol, ...mapping.map((f, c) => (FIELDS[f]?.type === 'date' ? c : -1)).filter(c => c >= 0)]);
  const width = Math.max(...rows.map(r => r.length));
  return rows.map((r, ri) => Array.from({ length: width }, (_, c) => {
    const v = r[c] ?? '';
    if (v === '') return null; // no cell at all, rather than an empty string cell
    if (ri > layout.headerRow && dateCols.has(c) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); }
    return v;
  }));
}
