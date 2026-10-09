// Where the published curves come from, beyond the ECB. Every provider turns one or more downloads
// into a "part" — one currency's zero curve and, when there is one, its overnight rate — which
// buildMarket (marketdata.js) adds to data/market.json once it has passed validatePart.
//
// Built in:
//   riksbank    SEK  treasury bills and benchmark government bonds, SWESTR       (Sveriges Riksbank)
//   ustreasury  USD  daily Treasury par yield curve, SOFR                         (US Treasury, New York Fed)
//   norgesbank  NOK  generic government bond and treasury bill yields             (Norges Bank)
//
// Anything else is a custom provider: a JSON description of an HTTP endpoint that returns CSV or
// JSON (an internal data server, a vendor's REST API, FRED, …), read by the same generic code. See
// market-sources.json and docs/MARKET-DATA-SOURCES.md. The scheduled GitHub Action (or whatever
// server runs scripts/market-data.mjs) does the downloading; the browser never talks to a provider.
import { parseCSV, detectDelimiter } from './importer.js';
import { SE_TENORS, riksbankUrl, swestrUrl, buildSekCurve, RIKSBANK } from './marketdata.js';

// ---- tenors, dates, numbers ---------------------------------------------------------------------------
// "3M", "6 Mo", "1.5 Month", "12M", "1Y", "10 Yr", "2W", "ON" → years. Anything else → null.
export function parseTenor(label) {
  const s = String(label ?? '').trim().toUpperCase();
  if (/^(ON|O\/N|OVERNIGHT|1D)$/.test(s)) return 1 / 365;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(D|DAYS?|W|WK|WKS|WEEKS?|M|MO|MOS|MONTHS?|Y|YR|YRS|YEARS?|J|ÅR)$/);
  if (!m) return null;
  const n = +m[1], u = m[2][0];
  return u === 'D' ? n / 365 : u === 'W' ? (n * 7) / 365 : u === 'M' ? n / 12 : n;
}

// Slash dates are ambiguous one by one (03/04/2026), not as a column: a first part above 12 means
// day first, a second part above 12 means month first. Dots (31.12.2026) are always day first.
function slashOrder(values) {
  for (const v of values) {
    const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/\d{4}/);
    if (m && +m[1] > 12) return 'dmy';
    if (m && +m[2] > 12) return 'mdy';
  }
  return 'mdy';
}
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
// To YYYY-MM-DD, or '' when it is not a date. fmt: 'auto' | 'ymd' | 'mdy' | 'dmy'.
export function toIsoDate(v, fmt = 'auto') {
  const s = String(v ?? '').trim();
  const pad = (y, mo, d) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return pad(m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (m) return (fmt === 'dmy' || s[m[1].length] === '.') ? pad(m[3], +m[2], +m[1]) : pad(m[3], +m[1], +m[2]);
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](\d{4})/); // 01 Sep 2026 (Bank of England and others)
  if (m && MONTHS[m[2].toUpperCase()]) return pad(m[3], MONTHS[m[2].toUpperCase()], +m[1]);
  return '';
}

// 2.35, "2,35" (decimal comma), "2.35%", "" or "." (FRED's missing value) → number or NaN.
export function toNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(/%$/, '').replace(/\s/g, '');
  if (!s || s === '.' || /^(NA|N\/A|NAN|NULL|-)$/i.test(s)) return NaN;
  return Number(/^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s);
}

// A published yield (in %) as a continuously compounded rate (in %), the convention of every curve
// in the file. Simple rates (money market) need the tenor.
export function toContinuous(y, compounding = 'continuous', T = 1) {
  switch (compounding) {
    case 'continuous': return y;
    case 'annual': return Math.log(1 + y / 100) * 100;
    case 'semiannual': return 2 * Math.log(1 + y / 200) * 100;
    case 'quarterly': return 4 * Math.log(1 + y / 400) * 100;
    case 'simple': return T > 0 ? (Math.log(1 + (y / 100) * T) / T) * 100 : y;
    default: throw new Error('unknown compounding ' + compounding);
  }
}

// ---- reading a download ---------------------------------------------------------------------------
// CSV (any delimiter, header row first) or JSON (an array of records, at `path` if given, else the
// first array found) → array of plain objects.
export function readRecords(text, { format = 'auto', path = '', delimiter } = {}) {
  const raw = String(text ?? '').replace(/^﻿/, '');
  const fmt = format === 'auto' ? (/^\s*[[{]/.test(raw) ? 'json' : 'csv') : format;
  if (fmt === 'json') {
    let data;
    try { data = typeof text === 'string' ? JSON.parse(raw) : text; } catch (e) { return []; }
    for (const k of String(path || '').split('.').filter(Boolean)) data = data?.[k];
    if (!Array.isArray(data) && data && typeof data === 'object') data = Object.values(data).find(Array.isArray);
    return Array.isArray(data) ? data.filter(r => r && typeof r === 'object') : [];
  }
  const rows = parseCSV(raw, delimiter || detectDelimiter(raw));
  if (rows.length < 2) return [];
  const head = rows[0].map(h => String(h).trim());
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// The first key of a record that matches one of the names (case and spacing ignored).
const norm = s => String(s).toLowerCase().replace(/[\s_-]/g, '');
function findKey(rec, names) {
  if (!rec) return null;
  const keys = Object.keys(rec);
  for (const n of [names].flat().filter(Boolean)) { const k = keys.find(x => norm(x) === norm(n)); if (k) return k; }
  return null;
}
const DATE_KEYS = ['date', 'time_period', 'effectiveDate', 'datum', 'observation_date'];
const VALUE_KEYS = ['obs_value', 'value', 'rate', 'percentRate', 'yield'];
const TENOR_KEYS = ['tenor', 'maturity', 'term'];

// Records → [{ date, tenor, value }]. Two layouts:
//   wide: a date column and one column per tenor (headers like "3 Mo", "10Y", or mapped in `columns`)
//   long: one row per date and tenor (dateField, tenorField, valueField)
// `tenor` on the spec gives every record the same tenor (one series per download). `filter` keeps
// records whose fields equal the given value(s). `unit: 'decimal'` means 0.0235 rather than 2.35.
export function observations(records, spec = {}) {
  const first = records[0];
  if (!first) return [];
  const dateKey = findKey(first, spec.dateField || DATE_KEYS) || Object.keys(first)[0];
  const filters = Object.entries(spec.filter || {}).map(([f, v]) => [findKey(first, f) || f, [v].flat().map(String)]);
  const recs = records.filter(r => filters.every(([k, vs]) => vs.includes(String(r[k] ?? '').trim())));
  const order = spec.dateFormat && spec.dateFormat !== 'auto' ? spec.dateFormat : slashOrder(recs.map(r => r[dateKey]));
  const scale = spec.unit === 'decimal' ? 100 : 1;
  const out = [];
  const push = (r, tenor, v) => {
    const date = toIsoDate(r[dateKey], order), value = toNumber(v) * scale;
    if (date && tenor > 0 && Number.isFinite(value)) out.push({ date, tenor, value });
  };
  const tenorKey = spec.tenor == null ? findKey(first, spec.tenorField || TENOR_KEYS) : null;
  const layout = spec.layout || (spec.tenor != null || tenorKey ? 'long' : 'wide');
  if (layout === 'long') {
    const valueKey = findKey(first, spec.valueField || VALUE_KEYS);
    if (!valueKey) return [];
    for (const r of recs) push(r, spec.tenor != null ? +spec.tenor : parseTenor(r[tenorKey]), r[valueKey]);
  } else {
    const cols = spec.columns
      ? Object.entries(spec.columns).map(([h, t]) => [findKey(first, h), typeof t === 'number' ? t : parseTenor(t)]).filter(([k]) => k)
      : Object.keys(first).filter(k => k !== dateKey).map(k => [k, parseTenor(k)]).filter(([, t]) => t);
    for (const r of recs) for (const [k, t] of cols) push(r, t, r[k]);
  }
  return out;
}

// Observations → a curve in the file's format. The tenors are those quoted on the newest date (a
// tenor added or dropped along the way does not cost the other days); a day counts when it has
// every one of them. The last `keep` complete days are kept.
export function curveFromObs(obs, { name = '', compounding = 'continuous', keep = 60 } = {}) {
  const byDate = new Map();
  for (const o of obs) { if (!byDate.has(o.date)) byDate.set(o.date, new Map()); byDate.get(o.date).set(o.tenor, o.value); }
  const dates = [...byDate.keys()].sort();
  if (!dates.length) return null;
  const tenors = [...byDate.get(dates[dates.length - 1]).keys()].sort((a, b) => a - b);
  const full = dates.filter(d => tenors.every(t => byDate.get(d).has(t))).slice(-keep);
  return { name, tenors, dates: full, zero: full.map(d => tenors.map(t => toContinuous(byDate.get(d).get(t), compounding, t))) };
}
// Observations of one rate → { name, dates, values }, the last `keep` days.
export function seriesFromObs(obs, { name = '', keep = 60 } = {}) {
  const byDate = new Map(obs.map(o => [o.date, o.value]));
  const dates = [...byDate.keys()].sort().slice(-keep);
  return { name, dates, values: dates.map(d => byDate.get(d)) };
}

// ---- downloading -----------------------------------------------------------------------------------
// URL and header placeholders: {from} (100 days back), {to} and {today}, {year}, {prevYear}, and
// ${ENV_VAR} for keys and tokens. Secrets stay in the environment (GitHub Actions secrets): the
// templates are what gets logged, never the expanded URL.
const ENV_RE = /\$\{([A-Z0-9_]+)\}/g;
export const envNeeded = obj => [...new Set([...JSON.stringify(obj ?? '').matchAll(ENV_RE)].map(m => m[1]))];
export function expand(tpl, { today, env = {} }) {
  const iso = d => d.toISOString().slice(0, 10);
  const to = iso(today), from = iso(new Date(today.getTime() - 100 * 864e5)), y = today.getUTCFullYear();
  return String(tpl).replace(/\{from\}/g, from).replace(/\{to\}|\{today\}/g, to).replace(/\{year\}/g, y).replace(/\{prevYear\}/g, y - 1)
    .replace(ENV_RE, (_, k) => encodeURIComponent(env[k] ?? ''));
}
const expandHeaders = (h, ctx) => Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k, expand(v, ctx).replace(/%20/g, ' ')]));

// The downloads one spec asks for, as [{ text, tenor? }]. `url` is one download; `urls` several that
// are read as one (e.g. last year's and this year's file); `series` one download per tenor
// ({ "1M": url, … }). A download that fails is skipped as long as another one came through.
async function download(spec, ctx) {
  const jobs = spec.series
    ? Object.entries(spec.series).map(([t, url]) => ({ url, tenor: parseTenor(t) ?? +t }))
    : [spec.urls || spec.url].flat().filter(Boolean).map(url => ({ url }));
  const res = [], errs = [];
  for (const [i, j] of jobs.entries()) {
    if (i && spec.pauseMs) await ctx.sleep(spec.pauseMs);
    try { res.push({ text: await ctx.get(expand(j.url, ctx), { headers: expandHeaders(spec.headers, ctx), label: j.url }), tenor: j.tenor }); }
    catch (e) { errs.push(e.message); }
  }
  if (!res.length) throw new Error(errs.join('; ') || 'nothing to download');
  for (const e of errs) ctx.warn?.(e);
  return res;
}
const obsOf = (downloads, spec) => downloads.flatMap(d => observations(readRecords(d.text, spec), d.tenor != null ? { ...spec, tenor: d.tenor, layout: 'long' } : spec));

// A provider from a description: { id, ccy, name, attribution, curve: {…}, overnight?: {…} }. Both
// specs take the download options above and the reading options of readRecords and observations;
// the curve also takes `compounding` (how the source quotes: continuous, annual, semiannual,
// quarterly, simple) and a `name` for the published file.
export function httpProvider(cfg) {
  return {
    id: cfg.id, ccy: cfg.ccy, name: cfg.name || cfg.id, strict: !!cfg.strict, needs: envNeeded([cfg.curve, cfg.overnight]),
    async fetch(ctx) {
      const curve = await download(cfg.curve, ctx);
      let overnight = null;
      if (cfg.overnight) { try { overnight = await download(cfg.overnight, ctx); } catch (e) { ctx.warn?.(`${cfg.id} overnight: ${e.message}`); } }
      return { curve, overnight };
    },
    build(raw) {
      const curve = curveFromObs(obsOf(raw.curve, cfg.curve), { name: cfg.curve.name || cfg.name || cfg.id, compounding: cfg.curve.compounding || 'continuous' });
      if (!curve) return null;
      const overnight = raw.overnight ? seriesFromObs(obsOf(raw.overnight, { ...cfg.overnight, tenor: 1 / 365, layout: 'long' }), { name: cfg.overnight.name || cfg.ccy + ' overnight rate, %' }) : null;
      return { id: cfg.id, ccy: cfg.ccy, curve, overnight: overnight?.dates.length ? overnight : null, attribution: cfg.attribution || '', source: String(cfg.curve.url || [cfg.curve.urls].flat().at(-1) || Object.values(cfg.curve.series || {})[0] || '') };
    }
  };
}

// ---- the built-in providers ----------------------------------------------------------------------------
export const BUILTIN = {
  // The Riksbank allows only a few calls a minute without an API key: one series at a time, with a pause.
  riksbank: {
    id: 'riksbank', ccy: 'SEK', name: 'Sveriges Riksbank', strict: true, needs: [],
    async fetch(ctx) {
      const iso = d => d.toISOString().slice(0, 10);
      const to = iso(ctx.today), from = iso(new Date(ctx.today.getTime() - 100 * 864e5));
      const series = {};
      for (const [i, id] of Object.keys(SE_TENORS).entries()) {
        if (i) await ctx.sleep(13000);
        try { series[id] = await ctx.get(riksbankUrl(id, from, to)); } catch (e) { ctx.warn?.(`Riksbank ${id}: ${e.message}`); }
      }
      let swestr = null;
      try { swestr = await ctx.get(swestrUrl(from)); } catch (e) { ctx.warn?.(`SWESTR: ${e.message}`); }
      return { series, swestr };
    },
    build(raw) {
      const se = buildSekCurve(raw);
      return se && { id: 'riksbank', ccy: 'SEK', curve: se.curve, overnight: se.swestr, attribution: 'Swedish rates: Sveriges Riksbank.', source: RIKSBANK.obs };
    }
  },
  // Par yields on a bond-equivalent (semi-annual) basis, MM/DD/YYYY dates, one file per calendar
  // year: last year's file too, so early January still has 60 days. SOFR from the New York Fed.
  ustreasury: httpProvider({
    id: 'ustreasury', ccy: 'USD', name: 'US Treasury', attribution: 'US rates: U.S. Department of the Treasury; SOFR: Federal Reserve Bank of New York.',
    curve: {
      name: 'US Treasury daily par yield curve (CMT), converted from semi-annual to continuous compounding, %',
      urls: ['https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{prevYear}/all?type=daily_treasury_yield_curve&field_tdr_date_value={prevYear}&page&_format=csv',
        'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve&field_tdr_date_value={year}&page&_format=csv'],
      format: 'csv', layout: 'wide', dateField: 'Date', dateFormat: 'mdy', compounding: 'semiannual'
    },
    overnight: { name: 'Secured Overnight Financing Rate (SOFR), %', url: 'https://markets.newyorkfed.org/api/rates/secured/sofr/last/60.json', format: 'json', path: 'refRates', dateField: 'effectiveDate', valueField: 'percentRate' }
  }),
  // Norges Bank's SDMX API: generic yields of government bonds (GBON) and treasury bills (TBIL),
  // one row per date and tenor, annual compounding.
  norgesbank: httpProvider({
    id: 'norgesbank', ccy: 'NOK', name: 'Norges Bank', attribution: 'Norwegian rates: Norges Bank.',
    curve: {
      name: 'Norges Bank generic government bond and treasury bill yields, continuous compounding, %',
      url: 'https://data.norges-bank.no/api/data/GOVT_GENERIC_RATES/B..GBON+TBIL.?format=csv&startPeriod={from}&endPeriod={to}&locale=en',
      format: 'csv', layout: 'long', dateField: 'TIME_PERIOD', tenorField: 'TENOR', valueField: 'OBS_VALUE', compounding: 'annual'
    }
  })
};

// ---- configuration --------------------------------------------------------------------------------------
// market-sources.json: { providers: [ids of built-ins], strict: [ids that fail --strict], custom: [descriptions] }.
// No file: every built-in, with the Riksbank strict as before.
export const DEFAULT_CONFIG = { providers: Object.keys(BUILTIN), strict: ['riksbank'], custom: [] };

// The configured providers, checked. Custom ids are published as "custom:<id>"; a custom provider
// cannot claim EUR (the ECB's) and only https URLs are allowed. Returns { providers, errors }.
export function resolveProviders(config = DEFAULT_CONFIG, { only = null } = {}) {
  const errors = [], providers = [];
  const strict = new Set(config.strict ?? DEFAULT_CONFIG.strict);
  for (const id of config.providers ?? DEFAULT_CONFIG.providers) {
    if (!BUILTIN[id]) { errors.push(`unknown provider "${id}" (built in: ${Object.keys(BUILTIN).join(', ')})`); continue; }
    providers.push({ ...BUILTIN[id], strict: strict.has(id) });
  }
  for (const c of config.custom || []) {
    const bad = customErrors(c);
    if (bad.length) { errors.push(`custom provider "${c?.id ?? '?'}": ${bad.join('; ')}`); continue; }
    const id = 'custom:' + c.id;
    providers.push(httpProvider({ ...c, id, strict: strict.has(id) || strict.has(c.id) }));
  }
  // One provider per currency: the first one listed wins.
  const byCcy = new Map();
  for (const p of providers) {
    if (only && !only.includes(p.id) && !only.includes(p.id.replace(/^custom:/, ''))) continue;
    if (byCcy.has(p.ccy)) errors.push(`${p.id}: ${p.ccy} already comes from ${byCcy.get(p.ccy).id}; left out`);
    else byCcy.set(p.ccy, p);
  }
  return { providers: [...byCcy.values()], errors };
}
function customErrors(c) {
  const errs = [];
  if (!c || typeof c !== 'object') return ['not an object'];
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(c.id || '')) errs.push('id must be lower-case letters, digits and dashes');
  if (!/^[A-Z]{3}$/.test(c.ccy || '')) errs.push('ccy must be a three-letter currency code');
  if (c.ccy === 'EUR') errs.push('EUR comes from the ECB');
  for (const [k, s] of [['curve', c.curve], ['overnight', c.overnight]]) {
    if (!s) { if (k === 'curve') errs.push('curve is missing'); continue; }
    const urls = [s.url, s.urls, Object.values(s.series || {})].flat().filter(Boolean);
    if (!urls.length) errs.push(`${k}: no url, urls or series`);
    if (urls.some(u => !/^https:\/\//.test(String(u)))) errs.push(`${k}: URLs must start with https://`);
    if (s.compounding && !['continuous', 'annual', 'semiannual', 'quarterly', 'simple'].includes(s.compounding)) errs.push(`${k}: unknown compounding ${s.compounding}`);
  }
  return errs;
}
