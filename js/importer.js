// Bulk upload: CSV/TSV/XLSX parsing, Swedish and English number and date formats, header
// auto-mapping, row validation, holdings and price-history import, and templates.
import { FIELDS, INSTRUMENTS, allFieldKeys, normKey, resolveType, typePreset, validatePosition, OPTION_LABELS } from './instruments.js';
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

// fmt: 'auto' | 'ymd' | 'dmy' | 'mdy' | 'compact' (YYYYMMDD) | 'excel' (serial numbers)
export const DATE_FORMATS = ['auto', 'ymd', 'dmy', 'mdy', 'compact', 'excel'];
export function parseDate(raw, fmt = 'auto') {
  if (fmt !== 'auto' && raw !== null && raw !== undefined && !(raw instanceof Date)) {
    const s = String(raw).trim();
    if (!s) return '';
    let m;
    if (fmt === 'excel' && /^\d+(\.\d+)?$/.test(s)) return toISODate(new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000));
    if (fmt === 'compact' && (m = s.match(/^(\d{4})(\d{2})(\d{2})/)) && iso(+m[1], +m[2], +m[3])) return iso(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,4})[-/. ](\d{1,2})[-/. ](\d{1,4})/))) {
      const [a, b, c] = [+m[1], +m[2], +m[3]];
      const yy = y => (y < 100 ? y + 2000 : y);
      const r = fmt === 'ymd' ? iso(yy(a), b, c) : fmt === 'dmy' ? iso(yy(c), b, a) : fmt === 'mdy' ? iso(yy(c), a, b) : '';
      if (r) return r;
    }
    // Declared format did not fit this cell — fall back to auto-detection rather than dropping it.
  }
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
// SheetJS 0.20.x is only published on cdn.sheetjs.com (npm stops at 0.18.5), so its hash has to be
// taken from that file. Fill in sha384-… after `openssl dgst -sha384 -binary xlsx.full.min.js | openssl base64 -A`.
export const XLSX_SRI = '';

// Returns { sheets: [{ name, rows: string[][] | any[][] }], decimal }
export async function readFile(file, loadScript) {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xlsm|xls|ods)$/.test(name)) {
    await loadScript(XLSX_URL, { integrity: XLSX_SRI });
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(buf, { type: 'array', cellDates: true });
    return { sheets: wb.SheetNames.map(n => ({ name: n, rows: sheetRows(wb.Sheets[n]) })), decimal: '.', kind: 'xlsx' };
  }
  let text = await file.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return parseText(text, name);
}
// Plain text: JSON and XML are recognised by extension or by their first character, everything
// else goes through the delimiter sniffer (comma, semicolon, tab, pipe).
export function parseText(text, name = '') {
  const head = text.trimStart()[0];
  if (/\.json$/.test(name) || ((head === '{' || head === '[') && !/\.(csv|tsv|txt)$/.test(name))) {
    const rows = parseJSONRows(text);
    return { sheets: [{ name: 'JSON', rows }], decimal: detectDecimal(rows.slice(1, 200).flat(), ','), kind: 'json' };
  }
  if (/\.xml$/.test(name) || head === '<') {
    const rows = parseXMLRows(text);
    return { sheets: [{ name: 'XML', rows }], decimal: detectDecimal(rows.slice(1, 200).flat(), ','), kind: 'xml' };
  }
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

// opts: { scale: number, dateFormat, valueMap: { rawValue: value } } — set per field in the mapping UI.
export function coerce(field, raw, dec, opts = {}) {
  const spec = FIELDS[field];
  if (!spec) return raw;
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return undefined;
  const vm = opts.valueMap && opts.valueMap[String(raw).trim()];
  if (vm !== undefined && vm !== '') raw = vm;
  switch (spec.type) {
    case 'number': {
      const n = parseNumber(raw, dec);
      return isNum(n) ? (isNum(opts.scale) && opts.scale !== 1 ? n * opts.scale : n) : String(raw);
    }
    case 'date': return parseDate(raw, opts.dateFormat || 'auto') || String(raw);
    case 'ccy': {
      // Minor units are written GBp / ZAc / ILa: upper-casing would turn pence into pounds (×100).
      const c = String(raw).trim();
      const minor = { GBp: 'GBX', GBX: 'GBX', GBx: 'GBX', GBP_pence: 'GBX', ZAc: 'ZAC', ZAC: 'ZAC', ILa: 'ILA', ILA: 'ILA', ILs: 'ILS' }[c];
      return minor || c.toUpperCase().slice(0, 3);
    }
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
//   constants:  { field: value }   used when the file has no column for it (or the cell is empty)
//   transforms: { field: { scale, dateFormat } }
//   typeMap:    { rawTypeValue: typeId | '__skip' } for custodian-specific type codes
//   skipPattern: 'Total; Summa' — rows containing any of these are ignored
export function rowsToPositions(rows, mapping, { decimal = '.', defaultType = 'auto', constants = {}, transforms = {}, typeMap = {}, skipPattern = '', dateFormat = 'auto' } = {}) {
  const skips = String(skipPattern || '').split(/[;|]/).map(x => x.trim().toLowerCase()).filter(Boolean);
  const out = [];
  rows.forEach((r, i) => {
    if (skips.length && r.some(c => { const t = String(c ?? '').toLowerCase(); return skips.some(sk => t.includes(sk)); })) return;
    const p = {};
    let rawType = '';
    for (const [field, val] of Object.entries(constants || {})) {
      if (field === 'type' || val === '' || val === null || val === undefined) continue;
      const v = coerce(field, val, '.', { dateFormat: 'auto' });
      if (v !== undefined) p[field] = v;
    }
    mapping.forEach((field, c) => {
      if (!field) return;
      if (field === 'type') { rawType = r[c]; return; }
      const v = coerce(field, r[c], decimal, { dateFormat, ...(transforms[field] || {}) });
      if (v !== undefined) p[field] = v;
    });
    const rawKey = String(rawType ?? '').trim();
    if (rawKey && typeMap[rawKey] === '__skip') return;
    let type = rawKey ? (typeMap[rawKey] || resolveType(rawKey)) : (constants.type || null);
    // A type the file names but nobody recognises is not guessed: a guess is how a total return swap
    // became a 125 bn equity position. The row is kept, unvalued, until the type is mapped.
    if (rawKey && !type) {
      const pos = { id: uid(), type: 'unknown', rawType: rawKey };
      for (const f of ['name', 'ticker', 'isin', 'issuer', 'qty', 'price', 'ccy', 'strategy']) if (p[f] !== undefined) pos[f] = p[f];
      out.push({ line: i + 1, pos, errors: [{ field: 'type', code: 'unknown_type:' + rawKey }], raw: r, rawType: rawKey });
      return;
    }
    if (!type) type = defaultType === 'auto' ? inferType(p) : defaultType;
    // Labels such as "Warrant", "Euribor future" or "Money market fund" fill in what they imply.
    const preset = rawKey && !typeMap[rawKey] ? typePreset(rawKey) : null;
    if (preset) for (const [k, v] of Object.entries(preset)) if (p[k] === undefined) p[k] = v;
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
    out.push({ line: i + 1, pos, errors, raw: r, rawType: rawKey });
  });
  return out;
}

// Distinct values of the type column with the instrument type each resolves to.
export function typeValues(rows, mapping) {
  const c = mapping.indexOf('type');
  if (c < 0) return [];
  const m = new Map();
  rows.forEach(r => { const k = String(r[c] ?? '').trim(); if (k) m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].map(([value, count]) => ({ value, count, auto: resolveType(value) })).sort((a, b) => b.count - a.count);
}

// Mandatory datapoints for the types in play: [{ field, types: [...], oneOf: [..]|null }]
export function mandatoryFields(types) {
  const req = new Map();
  for (const t of types) {
    const d = INSTRUMENTS[t];
    if (!d) continue;
    for (const f of d.required) (req.get(f) || req.set(f, { field: f, types: [], oneOf: null }).get(f)).types.push(t);
    for (const g of d.requireOneOf || []) {
      const key = g.join('|');
      (req.get(key) || req.set(key, { field: key, types: [], oneOf: g }).get(key)).types.push(t);
    }
  }
  return [...req.values()];
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
  { type: 'alternative', name: 'Nordic Buyout Fund IV', altType: 'private_equity', qty: 1, price: 18500000, ccy: 'SEK', liquidityDays: 365, country: 'SE' },
  { type: 'inflation_linked', name: 'Sweden IL 3113 0.125% 2032', issuer: 'Kingdom of Sweden', qty: 10000000, price: 101.2, indexRatio: 1.318, ccy: 'SEK', coupon: 0.125, freq: 1, maturity: '2032-06-01', rating: 'AAA', country: 'SE' },
  { type: 'convertible', name: 'Cellnex 0.75% 2031 CB', issuer: 'Cellnex Telecom', qty: 1000000, price: 88.5, ccy: 'EUR', coupon: 0.75, freq: 1, maturity: '2031-11-20', reportedDelta: 0.35, rating: 'BB+', country: 'ES' },
  { type: 'certificate', name: 'BULL OMX X5 AVA', issuer: 'Avanza Bank', qty: 2000, price: 118.4, ccy: 'SEK', leverage: 5, underlyingClass: 'equity', country: 'SE' },
  { type: 'equity_swap', name: 'CFD short Kering', issuer: 'Goldman Sachs International', qty: -3000, underlyingPrice: 190, costPrice: 205, mtm: 45000, ccy: 'EUR', underlyingClass: 'equity', country: 'FR' },
  { type: 'ccs', name: 'USD/SEK CCS 2030', issuer: 'Nordea', buyCcy: 'SEK', buyAmount: 105000000, sellCcy: 'USD', sellAmount: 10000000, maturity: '2030-06-15', mtm: -1250000, ccy: 'SEK' },
  { type: 'repo', name: 'Reverse repo SGB collateral', issuer: 'SEB', qty: 25000000, ccy: 'SEK', rate: 1.85, maturity: '2026-10-05' },
  { type: 'otc', name: 'SX5E Asian call (counterparty MTM)', issuer: 'BNP Paribas', qty: 5000000, ccy: 'EUR', mtm: 210000, underlyingClass: 'equity', reportedDelta: 0.55, maturity: '2027-12-17' },
  { type: 'swaption', name: 'EUR 1y10y payer 2.75%', issuer: 'BNP Paribas', qty: 20000000, ccy: 'EUR', payerReceiver: 'payer', strike: 2.75, maturity: '2027-09-28', tenor: 10, marketRate: 2.6, vol: 82, volType: 'normal', freq: 1 },
  { type: 'cap_floor', name: 'EUR 3m cap 3% 2030', issuer: 'Société Générale', qty: 50000000, ccy: 'EUR', capFloor: 'cap', strike: 3, maturity: '2030-09-28', marketRate: 2.3, vol: 90, volType: 'normal', freq: 4 },
  { type: 'inflation_swap', name: 'EUR HICP ZC 10y', issuer: 'Deutsche Bank', qty: 25000000, ccy: 'EUR', direction: 'receive', fixedRate: 2.05, breakeven: 2.15, marketRate: 2.5, maturity: '2036-09-28' },
  { type: 'otc', name: 'SX5E var swap Dec27 (counterparty MTM)', issuer: 'JPMorgan', qty: 100000, ccy: 'EUR', mtm: 42000, underlyingClass: 'volatility', vega: -100000, maturity: '2027-12-17' },
  { type: 'exotic_option', name: 'OMXS30 down-and-in put 2200', issuer: 'Nordea', qty: 100, exoticKind: 'barrier', optType: 'put', barrierType: 'down-and-in', barrier: 2200, strike: 2500, maturity: '2027-06-18', underlyingPrice: 2650, vol: 20, multiplier: 100, ccy: 'SEK', underlyingClass: 'equity' },
  { type: 'sec_lending', name: 'Loan of Volvo B', isin: 'SE0000115446', issuer: 'Morgan Stanley', qty: 15000000, ccy: 'SEK', collateralValue: 16000000, haircut: 3, collateralType: 'government', rate: 0.35 }
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
// Every position of a portfolio as rows the bulk upload reads straight back: a type column plus
// each field any of the held instrument types uses. This is what the linked CSV/Excel file holds.
export function positionRows(p) {
  const keys = ['type', ...new Set((p.positions || []).flatMap(x => INSTRUMENTS[x.type]?.fields || []))];
  return [keys, ...(p.positions || []).map(x => keys.map(k => x[k] ?? ''))];
}
export function templateCSV(type = null) {
  const cols = templateColumns(type);
  const ex = TEMPLATE_EXAMPLES.filter(e => !type || e.type === type);
  return toCSV([cols, ...ex.map(e => cols.map(c => e[c] ?? ''))]);
}

export { parseISODate };

// ---- JSON -------------------------------------------------------------------------------------------
// Accepts an array of objects, an array of arrays, or any object that holds one somewhere
// ({ "data": { "positions": [...] } }). Nested objects are flattened to dotted keys.
export function parseJSONRows(text) {
  const root = JSON.parse(text);
  const isRecords = a => Array.isArray(a) && a.length && a.every(x => x && typeof x === 'object');
  const find = (o, depth = 0) => {
    if (isRecords(o)) return o;
    if (depth > 6 || !o || typeof o !== 'object') return null;
    let best = null;
    for (const v of Object.values(o)) { const f = find(v, depth + 1); if (f && (!best || f.length > best.length)) best = f; }
    return best;
  };
  const recs = find(root);
  if (!recs) throw new Error('no_records');
  if (Array.isArray(recs[0])) return recs.map(r => r.map(v => (v === null ? '' : v)));
  const flat = (o, pre = '', out = {}) => {
    for (const [k, v] of Object.entries(o)) {
      const key = pre ? pre + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out);
      else out[key] = Array.isArray(v) ? v.join('; ') : v;
    }
    return out;
  };
  const flats = recs.map(r => flat(r));
  const headers = [];
  flats.forEach(f => Object.keys(f).forEach(k => { if (!headers.includes(k)) headers.push(k); }));
  return [headers, ...flats.map(f => headers.map(h => (f[h] === null || f[h] === undefined ? '' : f[h])))];
}

// ---- XML --------------------------------------------------------------------------------------------
// Small tolerant parser (elements, attributes, text, CDATA, comments, entities) so it runs in the
// browser and under Node alike. The record element is the most frequent element that has
// children or attributes; each record's attributes and descendant leaf values become columns.
export function parseXMLRows(text) {
  const ent = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()] ??
    (e[1].toLowerCase() === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(+e.slice(1)))));
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const attrs = {};
      (m[4] || '').replace(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (_, k, __, a, b) => { attrs[k.replace(/^.*:/, '')] = ent(a ?? b ?? ''); });
      const node = { name: m[3].replace(/^.*:/, ''), attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6]) top.text += ent(m[6]);
  }
  const counts = new Map();
  const walk = (n, depth) => n.children.forEach(c => {
    if (c.children.length || Object.keys(c.attrs).length) {
      const k = c.name; const e = counts.get(k) || { n: 0, depth };
      e.n++; counts.set(k, e);
    }
    walk(c, depth + 1);
  });
  walk(root, 0);
  const [recName] = [...counts.entries()].filter(([, e]) => e.n > 1).sort((a, b) => b[1].n - a[1].n || a[1].depth - b[1].depth)[0] || [];
  if (!recName) throw new Error('no_records');
  const recs = [];
  const collect = n => n.children.forEach(c => (c.name === recName ? recs.push(c) : collect(c)));
  collect(root);
  const flat = (n, pre, out) => {
    for (const [k, v] of Object.entries(n.attrs)) out[(pre ? pre + '.' : '') + k] = v;
    if (!n.children.length) { if (pre && n.text.trim()) out[pre] = n.text.trim(); return out; }
    n.children.forEach(c => flat(c, pre ? pre + '.' + c.name : c.name, out));
    return out;
  };
  const flats = recs.map(r => flat(r, '', {}));
  const headers = [];
  flats.forEach(f => Object.keys(f).forEach(k => { if (!headers.includes(k)) headers.push(k); }));
  return [headers, ...flats.map(f => headers.map(h => f[h] ?? ''))];
}

// ---- saved mapping templates ----------------------------------------------------------------------------
// A template remembers how one file layout maps onto the platform: column → field (keyed by the
// normalised header text, so column order may change), per-field transforms, constants for
// fields the file lacks, custom type codes, the header row and number/date conventions.
export function buildTemplate({ name, header, mapping, headerRow = 0, sheet = '', decimal = '.', dateFormat = 'auto', transforms = {}, constants = {}, typeMap = {}, skipPattern = '', defaultType = 'auto', mode = 'append', id = null }) {
  const map = {};
  header.forEach((h, c) => { if (mapping[c]) map[normKey(h) || 'col' + c] = mapping[c]; });
  const clean = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  return {
    id: id || 'tpl_' + Math.random().toString(36).slice(2, 10), name: String(name || 'Template').slice(0, 80), version: 1,
    created: new Date().toISOString(), headers: header.map(h => normKey(h)).filter(Boolean),
    headerRow, sheet, decimal, dateFormat, mapping: map,
    transforms: Object.fromEntries(Object.entries(transforms || {}).filter(([f, t]) => Object.values(map).includes(f) && t && (t.scale !== undefined && t.scale !== 1 || t.dateFormat))),
    constants: clean(constants), typeMap: clean(typeMap), skipPattern: skipPattern || '', defaultType, mode
  };
}
export function applyTemplateMapping(tpl, header) {
  return header.map((h, c) => tpl.mapping[normKey(h) || 'col' + c] || '');
}
// Share of the template's headers present in this header row (0…1).
export function templateScore(tpl, header) {
  if (!tpl || !tpl.headers || !tpl.headers.length) return 0;
  const have = new Set(header.map(h => normKey(h)).filter(Boolean));
  return tpl.headers.filter(h => have.has(h)).length / tpl.headers.length;
}
// Best template for a parsed file: checks every sheet and the first 15 rows as header candidates.
export function detectTemplate(templates, sheets, threshold = 0.8) {
  let best = null;
  for (const tpl of templates || []) {
    sheets.forEach((sh, si) => sh.rows.slice(0, 15).forEach((row, ri) => {
      const sc = templateScore(tpl, row);
      if (sc >= threshold && (!best || sc > best.score || (sc === best.score && ri === tpl.headerRow))) best = { template: tpl, sheet: si, headerRow: ri, score: sc };
    }));
  }
  return best;
}
export function validateTemplate(obj) {
  if (!obj || typeof obj !== 'object' || !obj.mapping || typeof obj.mapping !== 'object' || !Array.isArray(obj.headers)) throw new Error('invalid_template');
  const fields = new Set(allFieldKeys());
  for (const f of Object.values(obj.mapping)) if (!fields.has(f)) throw new Error('invalid_template');
  return {
    ...obj, id: obj.id || 'tpl_' + Math.random().toString(36).slice(2, 10), name: String(obj.name || 'Template').slice(0, 80),
    transforms: obj.transforms || {}, constants: obj.constants || {}, typeMap: obj.typeMap || {},
    headerRow: Number.isInteger(obj.headerRow) ? obj.headerRow : 0, decimal: obj.decimal === ',' ? ',' : '.', dateFormat: DATE_FORMATS.includes(obj.dateFormat) ? obj.dateFormat : 'auto'
  };
}
