// Excel downloads: SheetJS loaded with its integrity hash (the same copy the reader uses), real
// date cells, column widths and a filter on the header row. Every Excel button goes through here.
import { XLSX_URL, XLSX_SRI } from './importer.js';
import { downloadBlob, loadScript } from './util.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
// A date string as a date cell (local midnight, which is what Excel shows as that day).
export const xlDate = v => { if (typeof v !== 'string' || !ISO.test(v)) return v; const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); };

// sheets: [{ name, rows, dateCols?: Set<number> }] — dateCols are the columns whose ISO strings
// become date cells (below the header row).
export function buildWorkbook(X, sheets) {
  const wb = X.utils.book_new();
  for (const sh of sheets) {
    const rows = sh.rows.map((r, i) => r.map((v, c) => (v === '' || v === undefined || v === null ? null : i > 0 && sh.dateCols?.has(c) ? xlDate(v) : v)));
    const ws = X.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: 'yyyy-mm-dd' });
    const width = Math.max(0, ...rows.map(r => r.length));
    ws['!cols'] = Array.from({ length: width }, (_, c) => ({ wch: Math.min(48, Math.max(8, ...rows.slice(0, 500).map(r => (r[c] instanceof Date ? 10 : String(r[c] ?? '').length + 2)))) }));
    if (rows.length > 1 && width && sh.filter !== false) ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: width - 1 } }) };
    X.utils.book_append_sheet(wb, ws, String(sh.name).slice(0, 31));
  }
  return wb;
}

export async function downloadWorkbook(filename, sheets) {
  await loadScript(XLSX_URL, { integrity: XLSX_SRI });
  const X = window.XLSX;
  const wb = buildWorkbook(X, sheets);
  const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  downloadBlob(new Blob([X.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true })], { type }), type, filename);
}
