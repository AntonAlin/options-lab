// Public market data published next to the site: ECB euro reference rates (last 90 days), the ECB
// euro area AAA government zero-coupon curve and €STR. A scheduled GitHub Action fetches them from
// the ECB and publishes data/market.json with the site; the browser only downloads that public
// file from the site's own address, so no portfolio data goes anywhere.
//
// The parsers and the validation are shared by the Action (scripts/market-data.mjs) and the app.
import { parseCSV } from './importer.js';
import { isNum } from './util.js';

export const MARKET_URL = 'data/market.json';
export const SOURCES = {
  fx: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml',
  curve: 'https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.{tenors}?lastNObservations=60&format=csvdata',
  estr: 'https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?lastNObservations=60&format=csvdata'
};
// ECB series codes → years.
export const TENORS = { SR_3M: 0.25, SR_6M: 0.5, SR_1Y: 1, SR_2Y: 2, SR_3Y: 3, SR_5Y: 5, SR_7Y: 7, SR_10Y: 10, SR_15Y: 15, SR_20Y: 20, SR_30Y: 30 };
export const curveUrl = () => SOURCES.curve.replace('{tenors}', Object.keys(TENORS).join('+'));

// ---- parsing (ECB formats) --------------------------------------------------------------------------
// eurofxref-hist-90d.xml: <Cube time="2026-09-28"><Cube currency="USD" rate="1.1234"/>…</Cube>, newest first.
export function parseFxHistory(xml) {
  const out = [];
  for (const m of String(xml).matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g)) {
    const rates = {};
    for (const r of m[2].matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[r[1]] = +r[2];
    if (Object.keys(rates).length) out.push({ date: m[1], rates });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ECB Data Portal csvdata: a header with KEY, TIME_PERIOD and OBS_VALUE (plus many metadata columns,
// some quoted with commas inside). Returns [{ key, date, value }].
export function parseEcbCsv(text) {
  const rows = parseCSV(String(text).replace(/^﻿/, ''), ',');
  if (rows.length < 2) return [];
  const h = rows[0].map(x => String(x).trim().toUpperCase());
  const iKey = h.indexOf('KEY'), iDate = h.indexOf('TIME_PERIOD'), iVal = h.indexOf('OBS_VALUE'), iType = h.indexOf('DATA_TYPE_FM');
  if (iDate < 0 || iVal < 0) return [];
  return rows.slice(1).map(r => {
    const value = parseFloat(r[iVal]);
    const key = iType >= 0 && r[iType] ? String(r[iType]).trim() : iKey >= 0 ? String(r[iKey]).trim().split('.').pop() : '';
    return { key, date: String(r[iDate] || '').trim().slice(0, 10), value };
  }).filter(o => /^\d{4}-\d{2}-\d{2}$/.test(o.date) && Number.isFinite(o.value));
}

// Build the published file from the three downloads.
export function buildMarket({ fxXml, curveCsv, estrCsv, now = new Date().toISOString() }) {
  const fxDays = parseFxHistory(fxXml);
  const ccys = [...new Set(fxDays.flatMap(d => Object.keys(d.rates)))].sort();
  const fx = { dates: fxDays.map(d => d.date), rates: Object.fromEntries(ccys.map(c => [c, fxDays.map(d => d.rates[c] ?? null)])) };
  const obs = parseEcbCsv(curveCsv).filter(o => TENORS[o.key] !== undefined);
  const byDate = new Map();
  for (const o of obs) { if (!byDate.has(o.date)) byDate.set(o.date, {}); byDate.get(o.date)[o.key] = o.value; }
  const keys = Object.keys(TENORS);
  const dates = [...byDate.keys()].filter(d => keys.every(k => isNum(byDate.get(d)[k]))).sort();
  const curve = { name: 'ECB euro area AAA government, spot rates (Svensson), continuous compounding, %', tenors: keys.map(k => TENORS[k]), dates, zero: dates.map(d => keys.map(k => byDate.get(d)[k])) };
  const est = parseEcbCsv(estrCsv).sort((a, b) => a.date.localeCompare(b.date));
  const estr = { name: 'Euro short-term rate (€STR), %', dates: est.map(o => o.date), values: est.map(o => o.value) };
  return { version: 1, generatedAt: now, attribution: 'Source: European Central Bank (ECB). Reused under the ECB\'s terms of use.', sources: { fx: SOURCES.fx, curve: curveUrl(), estr: SOURCES.estr }, fx, curves: { EUR: curve }, estr };
}

// What must hold before the file is published. Returns a list of problems (empty = fine).
export function validateMarket(m) {
  const errs = [];
  if (!m || m.version !== 1) return ['version'];
  const { fx, curves, estr } = m;
  if (!fx?.dates?.length || fx.dates.length < 20) errs.push('fx: fewer than 20 days');
  const last = k => { const s = fx?.rates?.[k]; return s ? s[s.length - 1] : null; };
  if (!(last('USD') > 0.6 && last('USD') < 2.5)) errs.push('fx: USD rate out of range ' + last('USD'));
  if (!(last('SEK') > 5 && last('SEK') < 25)) errs.push('fx: SEK rate out of range ' + last('SEK'));
  if (Object.keys(fx?.rates || {}).length < 20) errs.push('fx: fewer than 20 currencies');
  const c = curves?.EUR;
  if (!c?.dates?.length) errs.push('curve: no complete day');
  else {
    const z = c.zero[c.zero.length - 1];
    if (z.some(x => !(x > -3 && x < 15))) errs.push('curve: rate out of range ' + z.join(','));
    if (c.tenors.length !== Object.keys(TENORS).length) errs.push('curve: tenors missing');
  }
  if (!estr?.dates?.length) errs.push('estr: no observation');
  else if (!(estr.values[estr.values.length - 1] > -2 && estr.values[estr.values.length - 1] < 15)) errs.push('estr: out of range');
  // Stale data: the newest ECB date should be within a week of the file's own date.
  const newest = fx?.dates?.[fx.dates.length - 1];
  if (newest && m.generatedAt && (Date.parse(m.generatedAt) - Date.parse(newest)) / 864e5 > 7) errs.push('fx: newest date ' + newest + ' is more than a week old');
  return errs;
}

// ---- using it -----------------------------------------------------------------------------------------
// Latest index with date ≤ `date` (or the latest overall when no date is given).
function indexOn(dates, date) {
  if (!dates?.length) return -1;
  if (!date) return dates.length - 1;
  for (let i = dates.length - 1; i >= 0; i--) if (dates[i] <= date) return i;
  return -1;
}
// ECB rates for a valuation date: { date, rates: { CCY: units per EUR } }, or null when the date is
// outside the 90 days published (older) — the app then leaves the portfolio's rates alone.
export function fxOn(m, date) {
  const i = indexOn(m?.fx?.dates, date);
  if (i < 0) return null;
  // A valuation date far past the newest rate (a stale file) is not served either.
  if (date && (Date.parse(date) - Date.parse(m.fx.dates[i])) / 864e5 > 7) return null;
  const rates = { EUR: 1 };
  for (const [c, s] of Object.entries(m.fx.rates)) if (isNum(s[i])) rates[c] = s[i];
  return { date: m.fx.dates[i], rates };
}
// The EUR curve for a date, with €STR as its overnight point: { date, t: [years], z: [decimal] }.
export function curveOn(m, date) {
  const c = m?.curves?.EUR;
  const i = indexOn(c?.dates, date);
  if (i < 0) return null;
  if (date && (Date.parse(date) - Date.parse(c.dates[i])) / 864e5 > 7) return null;
  const t = [...c.tenors], z = c.zero[i].map(x => x / 100);
  const j = indexOn(m.estr?.dates, c.dates[i]);
  if (j >= 0) { t.unshift(1 / 365); z.unshift(m.estr.values[j] / 100); }
  return { date: c.dates[i], ccy: 'EUR', t, z };
}
// Zero rate (continuous, decimal) at T years: linear in the rate, flat beyond both ends.
export function zeroAt(curve, T) {
  const { t, z } = curve;
  if (!(T > t[0])) return z[0];
  if (T >= t[t.length - 1]) return z[z.length - 1];
  let k = 1;
  while (t[k] < T) k++;
  const w = (T - t[k - 1]) / (t[k] - t[k - 1]);
  return z[k - 1] + w * (z[k] - z[k - 1]);
}
