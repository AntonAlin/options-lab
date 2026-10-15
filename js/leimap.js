// ISIN → LEI from GLEIF's public ISIN-LEI mapping file, published with the site in small pieces so
// the browser can look up the issuers of the holdings without telling anyone which ISINs it holds.
//
// scripts/lei-map.mjs (run by the Pages deploy) downloads GLEIF's file and writes data/lei/: a
// manifest and 4096 shard files. An ISIN's shard is a hash of the ISIN, so the browser fetches only
// the shards its own ISINs fall into, from the site itself; each shard holds a few thousand
// unrelated ISINs, so the request reveals no more than "one of these". Pure functions only, shared
// by the script, the browser and the tests.
import { isLei } from './instruments.js';

export const LEI_DIR = 'data/lei/';
export const SHARD_BITS = 12; // 4096 shards
export const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

// FNV-1a, 32 bits: the same number in Node and every browser.
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export const shardOf = (isin, bits = SHARD_BITS) => (fnv1a(String(isin).toUpperCase()) & ((1 << bits) - 1)).toString(16).padStart(Math.ceil(bits / 4), '0');
export const shardFile = id => `${LEI_DIR}${id}.txt`;

// ISIN check digit (ISO 6166, Luhn over the letters-as-numbers string): a typo in a file never
// reaches the lookup, and GLEIF's file is filtered on it too.
export function isIsin(v) {
  const s = String(v ?? '').trim().toUpperCase();
  if (!ISIN_RE.test(s)) return false;
  const digits = [...s.slice(0, 11)].map(c => (c >= 'A' ? String(c.charCodeAt(0) - 55) : c)).join('');
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = +digits[digits.length - 1 - i];
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === +s[11];
}

// One shard as text: the first line lists the LEIs ("#L lei0 lei1 ..."), then one "ISIN index" line
// per ISIN, sorted. Large issuers have thousands of ISINs, so the LEI is written once per shard.
export function shardText(pairs) {
  const leis = [...new Set(pairs.map(p => p[1]))].sort();
  const at = new Map(leis.map((l, i) => [l, i]));
  const lines = pairs.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([i, l]) => `${i} ${at.get(l).toString(36)}`);
  return `#L ${leis.join(' ')}\n${lines.join('\n')}\n`;
}
export function parseShard(text) {
  const out = new Map();
  const lines = String(text || '').split('\n');
  const head = lines[0] || '';
  if (!head.startsWith('#L')) return out;
  const leis = head.slice(2).trim().split(' ').filter(Boolean);
  for (let k = 1; k < lines.length; k++) {
    const line = lines[k];
    const sp = line.indexOf(' ');
    if (sp < 0) continue;
    const lei = leis[parseInt(line.slice(sp + 1), 36)];
    if (lei) out.set(line.slice(0, sp), lei);
  }
  return out;
}

// GLEIF's CSV: a header naming the LEI and ISIN columns (in either order), then one pair per line.
// Returns a line reader so the script can stream millions of lines.
export function csvPairReader() {
  let li = -1, ii = -1, header = true;
  const stats = { lines: 0, kept: 0, badIsin: 0, badLei: 0 };
  const read = line => {
    const cells = line.replace(/^﻿/, '').split(',').map(c => c.replace(/^"|"$/g, '').trim());
    if (header) {
      header = false;
      const h = cells.map(c => c.toUpperCase());
      li = h.findIndex(c => c === 'LEI' || c.includes('LEI'));
      ii = h.findIndex(c => c === 'ISIN' || c.includes('ISIN'));
      if (li < 0 || ii < 0) throw new Error('GLEIF file: no LEI/ISIN header in "' + line.slice(0, 80) + '"');
      return null;
    }
    if (!line.trim()) return null;
    stats.lines++;
    const isin = (cells[ii] || '').toUpperCase(), lei = (cells[li] || '').toUpperCase();
    if (!ISIN_RE.test(isin)) { stats.badIsin++; return null; }
    if (!isLei(lei)) { stats.badLei++; return null; }
    stats.kept++;
    return [isin, lei];
  };
  return { read, stats };
}

// ---- browser side ------------------------------------------------------------------------------------
// fetchText(url) → Promise<string|null>. Shards are cached for the page's lifetime.
export function createLookup(fetchText, base = '') {
  let manifest;
  const shards = new Map();
  const getManifest = async () => {
    if (manifest === undefined) {
      try { const t = await fetchText(base + LEI_DIR + 'manifest.json'); manifest = t ? JSON.parse(t) : null; }
      catch (e) { manifest = null; }
    }
    return manifest;
  };
  const getShard = id => {
    if (!shards.has(id)) shards.set(id, fetchText(base + shardFile(id)).then(t => parseShard(t)).catch(() => new Map()));
    return shards.get(id);
  };
  // { date, found: { isin: lei }, missing: [isin] } or null when no mapping is published.
  async function lookup(isins) {
    const m = await getManifest();
    if (!m || !m.shards) return null;
    const wanted = [...new Set(isins.map(x => String(x).toUpperCase()).filter(isIsin))];
    const byShard = new Map();
    for (const i of wanted) { const s = shardOf(i, m.bits || SHARD_BITS); (byShard.get(s) || byShard.set(s, []).get(s)).push(i); }
    const found = {}, missing = [];
    await Promise.all([...byShard.entries()].map(async ([s, list]) => {
      const map = await getShard(s);
      for (const i of list) { const l = map.get(i); if (l) found[i] = l; else missing.push(i); }
    }));
    return { date: m.date || '', found, missing };
  }
  return { lookup, manifest: getManifest };
}
