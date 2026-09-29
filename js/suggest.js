// Suggestions for columns and type codes the importer does not recognise. A small softmax
// (multinomial logistic) regression over hashed character n-grams of the header and a few shapes
// of the sample values: dates, ISINs, currency codes, magnitudes. It is trained offline on the
// field registry by scripts/train-import-model.mjs, never on anyone's files, and runs here in the
// browser. It only suggests: nothing is mapped until the user accepts it.
export const DIM = 1 << 14;
export const MIN_CONFIDENCE = 0.5;

// FNV-1a, 32 bit, into DIM buckets.
function bucket(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % DIM;
}

// "MarketValue_SEK (local)" → ['market', 'value', 'sek', 'local']
export function words(text) {
  return String(text ?? '')
    .replace(/([a-zåäö])([A-ZÅÄÖ])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9åäöæøüé%]+/g, ' ')
    .trim().split(' ').filter(Boolean);
}

function textFeatures(text, out) {
  const w = words(text);
  const joined = '^' + w.join('') + '$';
  for (const n of [3, 4]) for (let i = 0; i + n <= joined.length; i++) out.push('c' + n + ':' + joined.slice(i, i + n));
  for (const x of w) out.push('w:' + x);
  if (w.length) out.push('first:' + w[0], 'last:' + w[w.length - 1]);
}

const CCY = new Set(['SEK', 'EUR', 'USD', 'NOK', 'DKK', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'NZD', 'PLN', 'CZK', 'HUF', 'ISK', 'CNY', 'HKD', 'SGD', 'ZAR', 'BRL', 'MXN', 'INR', 'KRW', 'TRY', 'GBX', 'GBP']);
const RATING = /^(AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|CCC[+-]?|CC|C|D|NR|Aaa|Aa[1-3]|A[1-3]|Baa[1-3]|Ba[1-3]|B[1-3]|Caa[1-3])$/;
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const DATE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{8}|\d{4}\/\d{1,2}\/\d{1,2})(?:[ T]\d{1,2}:\d{2}.*)?$/;

// Numbers as files write them: 1 234,56 · 1,234.56 · 12.5% · (300)
export function looseNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw ?? '').trim().replace(/[\s  ']/g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/%$/, '');
  if (!/^[-+]?[\d.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lastComma >= 0) s = /,\d{3}$/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  const x = Number(s);
  return Number.isFinite(x) ? (neg ? -x : x) : null;
}

function valueFeatures(samples, out) {
  const vals = (samples || []).map(v => (v instanceof Date ? v.toISOString().slice(0, 10) : v)).filter(v => v !== null && v !== undefined && String(v).trim() !== '').slice(0, 25);
  if (!vals.length) { out.push('v:none'); return; }
  const n = vals.length;
  const share = f => vals.filter(f).length / n;
  const s = vals.map(v => String(v).trim());
  const nums = vals.map(looseNumber);
  const numShare = nums.filter(x => x !== null).length / n;
  const flags = {
    date: share((_, i) => DATE.test(s[i])),
    isin: share((_, i) => ISIN.test(s[i].toUpperCase())),
    ccy: share((_, i) => CCY.has(s[i].toUpperCase()) && s[i].length === 3),
    cc2: share((_, i) => /^[A-Za-z]{2}$/.test(s[i])),
    rating: share((_, i) => RATING.test(s[i])),
    pct: share((_, i) => /%$/.test(s[i])),
    longtext: share((_, i) => s[i].length > 14 && /\s/.test(s[i]) && nums[i] === null),
    word: share((_, i) => nums[i] === null && /^[A-Za-zÅÄÖåäö _-]{2,14}$/.test(s[i])),
    code: share((_, i) => nums[i] === null && /^[A-Z0-9 ._/-]{2,12}$/.test(s[i]) && /[A-Z]/.test(s[i]))
  };
  for (const [k, x] of Object.entries(flags)) if (x >= 0.6) out.push('v:' + k);
  if (numShare >= 0.8 && !flags.date) {
    out.push('v:num');
    const xs = nums.filter(x => x !== null);
    const abs = xs.map(Math.abs).sort((a, b) => a - b);
    const med = abs[Math.floor(abs.length / 2)];
    out.push('v:mag:' + (med === 0 ? 'zero' : Math.max(-3, Math.min(9, Math.floor(Math.log10(med))))));
    if (xs.filter(x => x < 0).length / xs.length >= 0.2) out.push('v:neg');
    if (xs.every(x => Number.isInteger(x))) out.push('v:int');
    if (xs.every(x => x >= 0 && x <= 1)) out.push('v:unit');
    if (xs.every(x => x >= 60 && x <= 140)) out.push('v:par');
  }
  if (n >= 5 && new Set(s.map(x => x.toLowerCase())).size <= Math.max(2, n / 4)) out.push('v:few');
}

// Feature buckets for one column: header text plus, when given, sample values.
export function featuresOf(header, samples = null) {
  const out = [];
  textFeatures(header, out);
  if (samples) valueFeatures(samples, out);
  return [...new Set(out.map(bucket))];
}

// Class probabilities for a feature list, highest first: [{ label, p }].
export function scores(model, feats) {
  const z = model.bias.slice(), sc = model.scale ?? 1;
  for (const f of feats) {
    const w = model.w[f];
    if (!w) continue;
    for (let i = 0; i < w.length; i += 2) z[w[i]] += w[i + 1] * sc;
  }
  const m = Math.max(...z);
  const e = z.map(x => Math.exp(x - m));
  const tot = e.reduce((a, b) => a + b, 0);
  return model.classes.map((label, i) => ({ label, p: e[i] / tot })).sort((a, b) => b.p - a.p);
}

// Best field for each unmapped column: [{ col, field, p }]. Fields already mapped, or claimed by
// a more confident column, are skipped; '__none' (an unrelated column) is never suggested.
export function suggestColumns(model, header, body, mapping, { min = MIN_CONFIDENCE, skipCols = [] } = {}) {
  const used = new Set(mapping.filter(Boolean));
  const cands = [];
  header.forEach((h, c) => {
    if (mapping[c] || skipCols.includes(c)) return;
    if (!String(h ?? '').trim()) return;
    const ranked = scores(model, featuresOf(h, body.slice(0, 25).map(r => r[c])));
    ranked.slice(0, 3).forEach((r, rank) => cands.push({ col: c, field: r.label, p: r.p, rank }));
  });
  cands.sort((a, b) => b.p - a.p);
  const taken = new Set(), out = [];
  for (const x of cands) {
    if (x.field === '__none' && !taken.has(x.col)) { taken.add(x.col); continue; }
    if (taken.has(x.col) || used.has(x.field) || x.p < min) continue;
    taken.add(x.col); used.add(x.field);
    out.push({ col: x.col, field: x.field, p: x.p });
  }
  return out.sort((a, b) => a.col - b.col);
}

// Best instrument type for a type code the registry does not know, or null.
export function suggestType(model, code, { min = MIN_CONFIDENCE } = {}) {
  const [best] = scores(model, featuresOf(code));
  return best && best.label !== '__none' && best.p >= min ? { type: best.label, p: best.p } : null;
}

// Browser: the trained weights ship with the site as a static file, fetched once when needed.
let loading = null;
export function loadModels() {
  if (!loading) {
    loading = fetch(new URL('./models/import-model.json', import.meta.url))
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch(err => { console.warn('Import suggestions unavailable', err); loading = null; return null; });
  }
  return loading;
}
