// Small helpers everything else leans on. No DOM in here except the download/script helpers,
// so the maths modules can import it under Node for the tests.

export const DAY_MS = 86400000;

export function uid(prefix = 'p') {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const isNum = x => typeof x === 'number' && Number.isFinite(x);
export const num = (x, fb = 0) => (isNum(x) ? x : fb);
// Payments per year. Select fields store it as text ("2"), so parse rather than type-check.
export const freqOf = (x, fb = 1) => { const n = Math.round(+x); return Number.isFinite(n) && n >= 1 ? n : fb; };
export const sum = arr => arr.reduce((a, b) => a + b, 0);
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function mean(a) { return a.length ? sum(a) / a.length : NaN; }
export function stdev(a, ddof = 1) {
  if (a.length <= ddof) return NaN;
  const m = mean(a);
  return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - ddof));
}
export function covariance(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  const ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
}
export function correlation(a, b) {
  const c = covariance(a, b);
  return c / (stdev(a) * stdev(b));
}
// Linear-interpolated quantile on a sorted copy (type 7, same as numpy/Excel PERCENTILE.INC).
export function quantile(arr, p) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((x, y) => x - y);
  const h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}

// ---- dates -----------------------------------------------------------------------------------
export function parseISODate(s) {
  if (s instanceof Date) return isNaN(s) ? null : s;
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d) ? null : d;
}
export function toISODate(d) {
  return d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 10) : '';
}
export function todayISO() {
  const d = new Date();
  return toISODate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}
export function yearsBetween(fromISO, toISO) {
  const a = parseISODate(fromISO), b = parseISODate(toISO);
  if (!a || !b) return NaN;
  return (b - a) / DAY_MS / 365.25;
}
export function addMonthsISO(iso, months) {
  const d = parseISODate(iso);
  if (!d) return '';
  const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return toISODate(t);
}

// ---- deterministic RNG (demo data has to look the same on every load) ----------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Cholesky of a symmetric PSD matrix. Tiny negative pivots (from user-edited correlations
// that are not quite PSD) are floored instead of throwing, so the demo never explodes.
export function cholesky(M) {
  const n = M.length, L = M.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = M[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) L[i][j] = Math.sqrt(Math.max(s, 1e-12));
      else L[i][j] = s / L[j][j];
    }
  }
  return L;
}

// ---- browser-only helpers --------------------------------------------------------------------
export function downloadBlob(content, type, filename) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

const SCRIPT_CACHE = new Map();
// `integrity` is a Subresource Integrity hash (sha384-…): the browser refuses the file if the CDN
// serves anything but the exact bytes we hashed. Empty means no check (see README for SheetJS).
export function loadScript(src, { integrity = '' } = {}) {
  if (!SCRIPT_CACHE.has(src)) {
    SCRIPT_CACHE.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
      s.onload = resolve;
      s.onerror = () => { SCRIPT_CACHE.delete(src); reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    }));
  }
  return SCRIPT_CACHE.get(src);
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function slug(s) {
  return String(s || 'portfolio').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'portfolio';
}
