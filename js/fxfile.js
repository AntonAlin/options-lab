// ECB euro reference rates read from the ECB's own file, downloaded by the user: eurofxref.csv
// (inside eurofxref.zip), eurofxref-hist.csv (latest row used) or eurofxref-daily.xml. Reading a
// file keeps the site free of outbound requests. Returns { date, rates: { CCY: units per EUR } }.
import { parseDate } from './importer.js';

export const ECB_PAGE = 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html';

export function parseEcbRates(text) {
  const s = String(text || '').replace(/^﻿/, '');
  if (/<(gesmes:Envelope|Cube)\b/.test(s)) {
    const date = (s.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/) || [])[1] || '';
    const rates = {};
    for (const m of s.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[m[1]] = +m[2];
    return finish(date, rates);
  }
  // CSV: header "Date, USD, JPY, ...", then one row per day, newest first.
  const lines = s.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('ecb_format');
  const head = lines[0].split(',').map(x => x.trim());
  const row = lines[1].split(',').map(x => x.trim());
  if (!/^date$/i.test(head[0])) throw new Error('ecb_format');
  const rates = {};
  head.forEach((c, i) => { const v = parseFloat(row[i]); if (i > 0 && /^[A-Z]{3}$/.test(c) && Number.isFinite(v) && v > 0) rates[c] = v; });
  return finish(parseDate(row[0]) || '', rates);
}
function finish(date, rates) {
  if (Object.keys(rates).length < 5) throw new Error('ecb_format');
  return { date, rates: { ...rates, EUR: 1 } };
}
