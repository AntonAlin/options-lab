// Bulk upload: CSV/TSV/XLSX parsing, Swedish and English number and date formats, header
// auto-mapping, row validation, holdings and price-history import, and templates.
import { FIELDS, INSTRUMENTS, allFieldKeys, normKey, resolveType, validatePosition, OPTION_LABELS } from './instruments.js';
import { isNum, uid, parseISODate, toISODate } from './util.js';

// ---- text parsing --------------------------------------------------------------------------------
export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 20);
  const cands = [';', ',', '\t', '|'];
  let best = ',', bestScore = -1;
  for (const d of cands) {
    const counts = lines.map(l => splitLine(l, d).length);
    if (!counts.length) continue;
    const freq = new Map();
    counts.forEach(c => freq.set(c, (freq.get(c) || 0) + 1));
    const [mode, consistent] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const score = mode > 1 ? consistent * 100 + mode : 0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}
function splitLine(line, d) { return parseCSV(line, d)[0] || []; }

// RFC 4180-ish: quoted fields, doubled quotes, embedded newlines and delimiters.
export function parseCSV(text, delim) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

// Decide whether the file writes 1,5 or 1.5. Swedish Excel exports use ; and decimal comma.
export function detectDecimal(cells, delim) {
  let comma = 0, dot = 0;
  for (const raw of cells) {
    const s = String(raw).trim().replace(/[\s  ]/g, '');
    if (/^-?[\d.]*\d,\d+%?$/.test(s) && !/^-?\d{1,3}(,\d{3})+$/.test(s)) comma++;
    else if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) comma++;
    if (/^-?[\d,]*\d\.\d+%?$/.test(s) && !/^-?\d{1,3}(\.\d{3})+$/.test(s)) dot++;
  }
  if (comma === dot) return delim === ';' ? ',' : '.';
  return comma > dot ? ',' : '.';
}

export function parseNumber(raw, dec = '.') {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).trim();
  if (!s || /^(n\/?a|-|—|null|none)$/i.test(s)) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[−–]/g, '-').replace(/[\s  ']/g, '').replace(/%$/, '').replace(/^[A-Z]{3}|[A-Z]{3}$/g, '');
  if (dec === ',') s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
  const n = parseFloat(s);
  return neg ? -n : n;
}

export function parseDate(raw) {
  if (raw instanceof Date) return isNaN(raw) ? '' : toISODate(new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate())));
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) { // Excel serial date
    return toISODate(new Date(Date.UTC(1899, 11, 30) + raw * 86400000));
  }
  const s = String(raw ?? '').trim();
  if (!s) return '';
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    let [a, b, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
    // Day-first unless that is impossible (US exports): 03/15/2027 → 15 March.
    if (b > 12 && a <= 12) return iso(y, a, b);
    return iso(y, b, a);
  }
  const d = new Date(s);
  return isNaN(d) ? '' : toISODate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}
function iso(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? toISODate(dt) : '';
}

// ---- file reading ----------------------------------------------------------------------------------
export const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

// Returns { sheets: [{ name, rows: string[][] | any[][] }], decimal }
export async function readFile(file, loadScript) {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xlsm|xls|ods)$/.test(name)) {
    await loadScript(XLSX_URL);
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
    return { sheets: wb.SheetNames.map(n => ({ name: n, rows: sheetRows(wb.Sheets[n]) })), decimal: '.', kind: 'xlsx' };
  }
  let text = await file.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return parseText(text);
}
export function parseText(text) {
  const delim = detectDelimiter(text);
  const rows = parseCSV(text, delim);
  const decimal = detectDecimal(rows.slice(1, 200).flat(), delim);
  return { sheets: [{ name: 'CSV', rows }], decimal, delim, kind: 'csv' };
}

// SheetJS → 2-D array, with percent-formatted cells scaled to percent and dates as Date.
function sheetRows(ws) {
  if (!ws || !ws['!ref']) return [];
  const XLSX = window.XLSX;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const out = [];
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 20000); r++) {
    const row = [];
    for (let c = range.s.c; c <= Math.min(range.e.c, range.s.c + 200); c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) { row.push(''); continue; }
      if (cell.t === 'n' && cell.z && String(cell.z).includes('%')) row.push(cell.v * 100);
      else if (cell.t === 'd') row.push(cell.v);
      else row.push(cell.v ?? '');
    }
    if (row.some(x => String(x).trim() !== '')) out.push(row);
  }
  return out;
}

// ---- header mapping ---------------------------------------------------------------------------------
const ALIAS_INDEX = (() => {
  const m = new Map();
  for (const [key, spec] of Object.entries(FIELDS)) {
    m.set(normKey(key), key);
    m.set(normKey(spec.en), key);
    m.set(normKey(spec.sv), key);
    (spec.aliases || []).forEach(a => { if (!m.has(normKey(a))) m.set(normKey(a), key); });
  }
  return m;
})();
export function guessField(header) {
  const k = normKey(header);
  if (!k) return '';
  if (ALIAS_INDEX.has(k)) return ALIAS_INDEX.get(k);
  // "Market value (SEK)" / "Kurs lokal valuta" — try again without the trailing qualifier.
  const stripped = normKey(String(header).replace(/\(.*?\)|\[.*?\]/g, '').replace(/\b(local|lokal|base|bas|sek|eur|usd)\b/gi, ''));
  return ALIAS_INDEX.get(stripped) || '';
}

// Find the header row: the first of the top 15 rows where at least two cells map to a field.
export function findHeaderRow(rows) {
  let best = 0, bestHits = -1;
  rows.slice(0, 15).forEach((r, i) => {
    const hits = r.filter(c => guessField(c)).length;
    if (hits > bestHits) { bestHits = hits; best = i; }
  });
  return bestHits >= 2 ? best : 0;
}
export function autoMapping(headers) {
  const used = new Set();
  return headers.map(h => {
    const f = guessField(h);
    if (!f || used.has(f)) return '';
    used.add(f);
    return f;
  });
}

// ---- value normalisation -----------------------------------------------------------------------------
const SELECT_SYNONYMS = {
  optType: { call: ['c', 'call', 'köp', 'kop', 'köpoption', 'calloption'], put: ['p', 'put', 'sälj', 'salj', 'säljoption', 'putoption'] },
  direction: { receive: ['receive', 'rec', 'r', 'receivefixed', 'erhåll', 'erhållfast', 'long'], pay: ['pay', 'p', 'payfixed', 'betala', 'betalafast', 'short'] },
  protection: { buy: ['buy', 'b', 'bought', 'long', 'köp', 'köpt', 'köpskydd', 'buyprotection'], sell: ['sell', 's', 'sold', 'short', 'sälj', 'såld', 'säljskydd', 'sellprotection'] },
  freq: { 1: ['1', 'a', 'annual', 'annually', 'yearly', 'år', 'årlig', 'årligen'], 2: ['2', 's', 'sa', 'semi', 'semiannual', 'semiannually', 'halvår', 'halvårs', 'halvårsvis'], 4: ['4', 'q', 'quarterly', 'kvartal', 'kvartalsvis'], 12: ['12', 'm', 'monthly', 'månad', 'månadsvis'] },
  underlyingClass: { equity: ['equity', 'eq', 'stock', 'index', 'aktie', 'aktier', 'aktieindex'], rates: ['rates', 'rate', 'ir', 'bond', 'interest', 'ränta', 'räntor', 'obligation'], commodity: ['commodity', 'cmd', 'råvara', 'råvaror', 'oil', 'gold'], fx: ['fx', 'currency', 'valuta'], credit: ['credit', 'kredit', 'cds'] },
  subClass: { equity: ['equity', 'aktie', 'aktier', 'aktiefond', 'stock'], fixed_income: ['fixedincome', 'bond', 'bonds', 'ränta', 'räntefond', 'obligation', 'fi', 'credit'], money_market: ['moneymarket', 'mm', 'penningmarknad', 'likviditet', 'kortränta'], mixed: ['mixed', 'balanced', 'multiasset', 'blandfond', 'blandat', 'mix'], alternative: ['alternative', 'alternativ', 'hedge', 'absolutereturn'], commodity: ['commodity', 'råvara', 'råvaror'] },
  altType: { private_equity: ['privateequity', 'pe', 'onoterat', 'buyout', 'venture', 'vc'], real_estate: ['realestate', 're', 'property', 'fastighet', 'fastigheter'], hedge_fund: ['hedgefund', 'hf', 'hedgefond'], infrastructure: ['infrastructure', 'infra', 'infrastruktur'], private_credit: ['privatecredit', 'directlending', 'direktlån', 'privatdebt'], crypto: ['crypto', 'krypto', 'bitcoin', 'btc', 'eth'], other: ['other', 'övrigt', 'annat'] }
};
export function normaliseSelect(field, raw) {
  const k = normKey(raw);
  if (!k) return '';
  const syn = SELECT_SYNONYMS[field];
  if (syn) for (const [val, list] of Object.entries(syn)) if (list.includes(k) || normKey(val) === k) return String(val);
  const opts = FIELDS[field]?.options || [];
  for (const o of opts) {
    if (normKey(o) === k) return o;
    const lab = OPTION_LABELS[o];
    if (lab && (normKey(lab.en) === k || normKey(lab.sv) === k)) return o;
  }
  return String(raw).trim();
}

export function coerce(field, raw, dec) {
  const spec = FIELDS[field];
  if (!spec) return raw;
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return undefined;
  switch (spec.type) {
    case 'number': { const n = parseNumber(raw, dec); return isNum(n) ? n : String(raw); }
    case 'date': return parseDate(raw) || String(raw);
    case 'ccy': return String(raw).trim().toUpperCase().slice(0, 3);
    case 'select': return field === 'type' ? raw : normaliseSelect(field, raw);
    default: return raw instanceof Date ? toISODate(raw) : String(raw).trim();
  }
}

// Infer a type when the file has no type column. Order matters — most specific first.
export function inferType(p) {
  if (p.optType || isNum(p.strike)) return 'option';
  if (p.buyCcy && p.sellCcy) return 'fx_forward';
  if (p.protection) return 'cds';
  if (isNum(p.fixedRate)) return 'irs';
  if (p.maturity && isNum(p.multiplier)) return 'future';
  if (p.maturity && (isNum(p.spread))) return 'frn';
  if (p.maturity && (isNum(p.coupon) || isNum(p.yield) || isNum(p.price))) {
    if (/(govern|treasur|stat|riksg|kingdom|republic|bund)/i.test((p.issuer || '') + ' ' + (p.name || ''))) return 'govt_bond';
    if (!isNum(p.coupon) || p.coupon === 0) return 'money_market';
    return 'corp_bond';
  }
  if (/^(cash|kassa|likvid|bank|deposit)/i.test(p.name || '')) return 'cash';
  return 'equity';
}

// Build positions from rows using a column→field mapping.
export function rowsToPositions(rows, mapping, { decimal = '.', defaultType = 'auto' } = {}) {
  return rows.map((r, i) => {
    const p = {};
    let rawType = '';
    mapping.forEach((field, c) => {
      if (!field) return;
      if (field === 'type') { rawType = r[c]; return; }
      const v = coerce(field, r[c], decimal);
      if (v !== undefined) p[field] = v;
    });
    let type = rawType ? resolveType(rawType) : null;
    const typeUnknown = !!rawType && !type;
    if (!type) type = defaultType === 'auto' ? inferType(p) : defaultType;
    // Options/warrants flagged in the type column as "call"/"put".
    if (type === 'option' && !p.optType && /put|sälj/i.test(rawType)) p.optType = 'put';
    if (type === 'option' && !p.optType && /call|köp/i.test(rawType)) p.optType = 'call';
    const def = INSTRUMENTS[type];
    for (const [k, v] of Object.entries(def.defaults || {})) if (p[k] === undefined) p[k] = v;
    // Keep only fields the type knows about, but remember extras so the user can see them.
    const pos = { id: uid(), type };
    for (const f of def.fields) if (p[f] !== undefined) pos[f] = p[f];
    if (type === 'cash' && !pos.name) pos.name = 'Cash ' + (pos.ccy || '');
    const errors = validatePosition(pos);
    if (typeUnknown) errors.unshift({ field: 'type', code: 'type_guessed:' + rawType });
    return { line: i + 1, pos, errors, raw: r };
  });
}

// Merge imported positions into an existing list.
export function mergePositions(existing, incoming, mode) {
  if (mode === 'replace') return { positions: incoming, added: incoming.length, updated: 0 };
  if (mode === 'append') return { positions: [...existing, ...incoming], added: incoming.length, updated: 0 };
  const out = existing.map(x => ({ ...x }));
  const keyOf = x => [x.isin && 'i:' + x.isin.toUpperCase(), x.ticker && 't:' + x.ticker.toUpperCase() + '|' + x.type, x.name && 'n:' + x.name.toLowerCase() + '|' + x.type].filter(Boolean);
  const index = new Map();
  out.forEach((x, i) => keyOf(x).forEach(k => { if (!index.has(k)) index.set(k, i); }));
  let added = 0, updated = 0;
  for (const inc of incoming) {
    const hit = keyOf(inc).map(k => index.get(k)).find(i => i !== undefined);
    if (hit !== undefined) {
      const { id, ...rest } = inc;
      // Only overwrite with values the file actually contained.
      for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== '') out[hit][k] = v;
      updated++;
    } else { out.push(inc); added++; }
  }
  return { positions: out, added, updated };
}

// ---- price history ------------------------------------------------------------------------------------
// Wide: Date | SERIES_A | SERIES_B ...   Long: Date | Ticker | Price
export function parseHistory(rows, decimal = '.') {
  if (!rows.length) throw new Error('empty');
  const hdr = rows[0].map(h => String(h ?? '').trim());
  const nk = hdr.map(normKey);
  const dateCol = nk.findIndex(h => ['date', 'datum', 'day', 'dag', 'asof', 'pricedate', 'tradedate'].includes(h));
  const idCol = nk.findIndex(h => ['ticker', 'symbol', 'isin', 'id', 'name', 'namn', 'security', 'instrument'].includes(h));
  const pxCol = nk.findIndex(h => ['price', 'close', 'last', 'px', 'kurs', 'pris', 'stängning', 'nav', 'adjclose', 'value', 'värde'].includes(h));
  const series = {}, dates = new Set();
  if (idCol >= 0 && pxCol >= 0 && hdr.length <= 6) {
    const dc = dateCol >= 0 ? dateCol : 0;
    for (const r of rows.slice(1)) {
      const d = parseDate(r[dc]), id = String(r[idCol] ?? '').trim(), px = parseNumber(r[pxCol], decimal);
      if (!d || !id || !isNum(px)) continue;
      (series[id] ||= {})[d] = px; dates.add(d);
    }
  } else {
    const dc = dateCol >= 0 ? dateCol : 0;
    hdr.forEach((h, c) => { if (c !== dc && h) series[h] = {}; });
    for (const r of rows.slice(1)) {
      const d = parseDate(r[dc]);
      if (!d) continue;
      dates.add(d);
      hdr.forEach((h, c) => {
        if (c === dc || !h) return;
        const px = parseNumber(r[c], decimal);
        if (isNum(px)) series[h][d] = px;
      });
    }
  }
  const sorted = [...dates].sort();
  if (sorted.length < 2) throw new Error('too_few_dates');
  return { dates: sorted, series: Object.fromEntries(Object.entries(series).filter(([, m]) => Object.keys(m).length).map(([k, m]) => [k, sorted.map(d => m[d] ?? null)])) };
}

// Union dates, forward-fill nothing (gaps stay null and count as flat days in analytics).
export function mergeHistory(a, b) {
  if (!a || !a.dates?.length) return b;
  const dates = [...new Set([...a.dates, ...b.dates])].sort();
  const pos = arr => new Map(arr.map((d, i) => [d, i]));
  const ia = pos(a.dates), ib = pos(b.dates);
  const series = {};
  for (const [k, v] of Object.entries(a.series)) series[k] = dates.map(d => (ia.has(d) ? v[ia.get(d)] : null));
  for (const [k, v] of Object.entries(b.series)) {
    const old = series[k];
    series[k] = dates.map((d, i) => (ib.has(d) && v[ib.get(d)] != null ? v[ib.get(d)] : old ? old[i] : null));
  }
  return { dates, series };
}

// ---- templates ------------------------------------------------------------------------------------------
export const TEMPLATE_EXAMPLES = [
  { type: 'equity', name: 'Atlas Copco A', ticker: 'ATCO A', isin: 'SE0017486889', issuer: 'Atlas Copco', qty: 12000, price: 172.5, ccy: 'SEK', sector: 'Industrials', country: 'SE', beta: 1.1, adv: 4500000 },
  { type: 'etf', name: 'iShares Core MSCI World', ticker: 'IWDA', isin: 'IE00B4L5Y983', qty: 3000, price: 98.4, ccy: 'EUR', subClass: 'equity', country: 'IE' },
  { type: 'fund', name: 'Nordic Corporate Bond Fund', isin: 'SE0000000001', qty: 25000, price: 118.2, ccy: 'SEK', subClass: 'fixed_income', duration: 0.6, liquidityDays: 3, country: 'SE' },
  { type: 'govt_bond', name: 'Sweden 1.00% 2030', isin: 'SE0000000002', issuer: 'Kingdom of Sweden', qty: 10000000, price: 95.8, ccy: 'SEK', coupon: 1, freq: 1, maturity: '2030-11-12', rating: 'AAA', country: 'SE' },
  { type: 'corp_bond', name: 'Volvo Treasury 3.625% 2029', isin: 'XS0000000003', issuer: 'Volvo', qty: 2000000, price: 101.3, ccy: 'EUR', coupon: 3.625, freq: 1, maturity: '2029-09-25', rating: 'A', sector: 'Industrials', country: 'SE' },
  { type: 'frn', name: 'Castellum FRN 2028', isin: 'SE0000000004', issuer: 'Castellum', qty: 5000000, price: 100.4, ccy: 'SEK', coupon: 4.35, spread: 190, freq: 4, maturity: '2028-03-15', rating: 'BBB-', sector: 'Real Estate', country: 'SE' },
  { type: 'money_market', name: 'Swedish T-bill Dec', issuer: 'Riksgälden', qty: 20000000, yield: 1.9, ccy: 'SEK', maturity: '2026-12-16', rating: 'AAA', country: 'SE' },
  { type: 'cash', name: 'Custody account SEK', issuer: 'SEB', qty: 4500000, ccy: 'SEK' },
  { type: 'future', name: 'OMXS30 Index Future Dec', ticker: 'OMXS30Z', qty: -20, price: 2650, multiplier: 100, ccy: 'SEK', underlyingClass: 'equity', maturity: '2026-12-18', country: 'SE' },
  { type: 'option', name: 'OMXS30 put 2400 Dec', qty: 50, optType: 'put', strike: 2400, maturity: '2026-12-18', underlyingPrice: 2650, vol: 19, multiplier: 100, ccy: 'SEK', underlyingClass: 'equity', rate: 2 },
  { type: 'fx_forward', name: 'Sell USD/SEK Dec', buyCcy: 'SEK', buyAmount: 52000000, sellCcy: 'USD', sellAmount: 5000000, maturity: '2026-12-18', issuer: 'Nordea' },
  { type: 'irs', name: 'SEK 5y payer', qty: 50000000, ccy: 'SEK', direction: 'pay', fixedRate: 2.35, marketRate: 2.45, freq: 1, maturity: '2031-06-20', issuer: 'LCH' },
  { type: 'cds', name: 'iTraxx Main S46 5y', issuer: 'iTraxx Europe Main', qty: 10000000, ccy: 'EUR', protection: 'buy', spread: 100, marketSpread: 62, maturity: '2031-12-20', rating: 'A-' },
  { type: 'commodity', name: 'Physical Gold ETC', ticker: 'PHAU', qty: 800, price: 255, ccy: 'USD', sector: 'Precious metals' },
  { type: 'alternative', name: 'Nordic Buyout Fund IV', altType: 'private_equity', qty: 1, price: 18500000, ccy: 'SEK', liquidityDays: 365, country: 'SE' }
];

export function templateColumns(type = null) {
  return type ? ['type', ...INSTRUMENTS[type].fields] : allFieldKeys();
}
export function toCSV(rows, delim = ',') {
  const esc = v => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",;\n\r\t]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map(r => r.map(esc).join(delim)).join('\r\n');
}
export function templateCSV(type = null) {
  const cols = templateColumns(type);
  const ex = TEMPLATE_EXAMPLES.filter(e => !type || e.type === type);
  return toCSV([cols, ...ex.map(e => cols.map(c => e[c] ?? ''))]);
}

export { parseISODate };
