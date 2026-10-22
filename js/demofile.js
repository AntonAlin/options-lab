// The demo as a file: the made-up Nordic funds as an Excel workbook (or a CSV) that the app connects
// to exactly as it would to an organisation's real holdings file. It doubles as the template: the
// same layout with the rows taken out is what a fund fills in.
//
// Workbook layout (every sheet is optional except Holdings):
//   Holdings      Date | Portfolio | Instrument type | <one column per field> — one row per holding per date
//   Prices        Date | <one column per price series> — the price history behind VaR and performance.
//                 Not "History": Excel reserves that sheet name and SheetJS refuses to write it.
//   Instructions  read by people, ignored by the app
//
// The CSV holds the Holdings sheet only. Pure module: the caller passes SheetJS in.
import { buildDemo } from './demo.js';
import { INSTRUMENTS, typeLabel } from './instruments.js';
import { toCSV } from './importer.js';
import { headerOf, DATE_HEADER, PORTFOLIO_HEADER } from './sourcefile.js';
import { parseISODate, toISODate, DAY_MS } from './util.js';

// The price sheet's name. Readers still take an old "History" sheet (js/sourcefile.js).
export const PRICE_SHEET = 'Prices';
export const DEMO_FUNDS = ['Demo: Nordic Balanced Fund', 'Demo: Nordic Equity Fund'];

// The latest month-end on or before `today`, moved back to a weekday.
const weekday = iso => { let d = parseISODate(iso); while ([0, 6].includes(d.getUTCDay())) d = new Date(d - DAY_MS); return toISODate(d); };
const monthEnd = (y, m) => toISODate(new Date(Date.UTC(y, m + 1, 0)));
export function demoDate(today) {
  const d = parseISODate(today);
  const end = monthEnd(d.getUTCFullYear(), d.getUTCMonth());
  return weekday(end <= today ? end : monthEnd(d.getUTCFullYear(), d.getUTCMonth() - 1));
}
// Six month-ends, oldest first, the last one the demo date.
export function demoDates(valDate, n = 6) {
  const d = parseISODate(valDate);
  return Array.from({ length: n }, (_, i) => weekday(monthEnd(d.getUTCFullYear(), d.getUTCMonth() - (n - 1 - i))));
}

// Every fund on every date: { rows: [{ fund, date, positions }], history }, oldest date first.
export function demoData(valDate) {
  const p = buildDemo(valDate);
  const h = p.history;
  const at = (series, date) => { const s = h.series[series]; if (!s) return null; let i = h.dates.indexOf(date); while (i > 0 && s[i] == null) i--; return i >= 0 ? s[i] : null; };
  const dates = demoDates(valDate);
  const strip = x => { const { id, ...rest } = x; return rest; };
  const out = [];
  dates.forEach((date, i) => {
    const back = dates.length - 1 - i; // months before the demo date
    const priced = p.positions.map(strip).map(x => {
      const px = x.ticker ? at(x.ticker, date) : null;
      const y = { ...x };
      if (px != null && back) y.price = Math.round(px * 10000) / 10000;
      // The fund built up its US tech and semiconductor holdings over the half year.
      if (['NVDA', 'ASML'].includes(x.ticker) && back) y.qty = Math.round(x.qty * (1 - 0.08 * back));
      return y;
    }).filter(x => !(x.ticker === 'ORSTED 31' && back >= 4)); // bought four months ago
    out.push({ fund: DEMO_FUNDS[0], date, positions: priced });
    // The equity fund: the Swedish shares, an index future and cash, in its own sizes.
    const eq = priced.filter(x => (x.type === 'equity' && x.ccy === 'SEK') || x.ticker === 'OMXS30F' || x.name === 'Custody account SEK')
      .map(x => ({ ...x, qty: x.type === 'cash' ? 9e6 : x.type === 'future' ? -20 : Math.round(x.qty * 0.6) }));
    out.push({ fund: DEMO_FUNDS[1], date, positions: eq });
  });
  return { rows: out, history: h };
}

// The field columns: identity, size and price first, then everything else the held types use.
const LEAD = ['type', 'name', 'ticker', 'isin', 'issuer', 'qty', 'price', 'costPrice', 'ccy'];
export function holdingColumns(positions) {
  const used = new Set(positions.flatMap(x => INSTRUMENTS[x.type]?.fields || []));
  return [...LEAD.filter(k => k === 'type' || used.has(k)), ...[...used].filter(k => !LEAD.includes(k))];
}
// The Holdings sheet: header plus one row per holding per fund per date.
export function holdingsRows(valDate, { empty = false } = {}) {
  const { rows } = demoData(valDate);
  const cols = holdingColumns(rows.flatMap(r => r.positions));
  const header = [DATE_HEADER, PORTFOLIO_HEADER, ...cols.map(headerOf)];
  if (empty) return [header];
  const body = rows.flatMap(r => r.positions.map(x => [r.date, r.fund, ...cols.map(k => (k === 'type' ? typeLabel(x.type) : x[k] ?? ''))]));
  return [header, ...body];
}
export function historyRows(valDate) {
  const { history: h } = demoData(valDate);
  const keys = Object.keys(h.series);
  return [[DATE_HEADER, ...keys], ...h.dates.filter(d => d <= valDate).map(d => [d, ...keys.map(k => h.series[k][h.dates.indexOf(d)] ?? '')])];
}
export const demoCSV = (valDate, opts = {}) => '﻿' + toCSV(holdingsRows(valDate, opts), ',') + '\r\n';

const INSTRUCTIONS = [
  ['Nexus Portfolio Lab — holdings file'],
  [''],
  ['Holdings', 'One row per holding per date. The first column is the date the holding applies to; the Portfolio column says which fund or mandate it belongs to.'],
  ['', 'Add a new date by copying the rows of the last date and changing what changed. The app shows the latest date and keeps every earlier one for history and changes.'],
  ['', 'Changes made in the app (a new holding, an edit, a deletion) are written back into this file. Close the file in Excel while the app writes, or the write waits until you do.'],
  ['Prices', 'Optional. Date in the first column, one column per price series (ticker or ISIN). Feeds VaR, volatility and performance.'],
  ['Instrument type', 'Equity, ETF, Fund, Government bond, Corporate bond, FRN, Money market, Cash, Future, Option, FX forward, Interest rate swap, CDS and the other types listed in the app.'],
  [''],
  ['The demo funds and every figure in them are made up. Prices are synthetic, not market data.']
];
// The workbook (demo or empty template). X is SheetJS.
export function demoWorkbook(X, valDate, { empty = false } = {}) {
  const wb = X.utils.book_new();
  const hold = holdingsRows(valDate, { empty }).map((r, i) => (i ? r.map((v, c) => (c === 0 ? toDate(v) : v)) : r));
  const ws = X.utils.aoa_to_sheet(hold, { cellDates: true, dateNF: 'yyyy-mm-dd' });
  ws['!cols'] = hold[0].map(h => ({ wch: Math.max(10, String(h).length + 2) }));
  X.utils.book_append_sheet(wb, ws, 'Holdings');
  if (!empty) X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(historyRows(valDate).map((r, i) => (i ? [toDate(r[0]), ...r.slice(1)] : r)), { cellDates: true, dateNF: 'yyyy-mm-dd' }), PRICE_SHEET);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(INSTRUCTIONS), 'Instructions');
  return wb;
}
const toDate = iso => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); };
