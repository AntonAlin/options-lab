// Control log: a per-portfolio, append-only record of who checked what and when. Sign-offs of the
// daily limit check, breach cases (opened, notes, closed) and every change to a limit, fund rule or
// global exposure setting. Each entry carries the SHA-256 of the one before it, so an entry edited
// or removed afterwards (in a backup, the linked file or the browser's database) breaks the chain.
//
// What this is not: there are no user accounts, so "by" is the name typed in on this computer, and
// anyone who can edit the file can rebuild the whole chain. The chain proves that nothing was
// changed after a head hash you kept elsewhere (the exported log, a PDF, an e-mail) — keep one.
//
// Pure module: no store, no DOM. store.js appends through here, the view reads from here.
import { isNum } from './util.js';

// ---- SHA-256 (FIPS 180-4) --------------------------------------------------------------------------
// Synchronous and dependency free: crypto.subtle is async and missing on plain-http intranet pages.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
export function sha256(str) {
  const bytes = new TextEncoder().encode(String(str));
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map(x => x.toString(16).padStart(8, '0')).join('');
}

// ---- the chain -------------------------------------------------------------------------------------
export const GENESIS = '0'.repeat(64);
// Key order fixed, so the same entry always hashes the same, whatever order the object came back in.
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}
const body = e => canon({ seq: e.seq, at: e.at, by: e.by, kind: e.kind, valDate: e.valDate, data: e.data, prev: e.prev });
export const entryHash = e => sha256(body(e));

// Append entries to a log (an array, changed in place). Returns the entries as stored.
export function append(log, items, { by = '', valDate = '', at = new Date().toISOString() } = {}) {
  const out = [];
  for (const it of items) {
    const last = log[log.length - 1];
    const e = { seq: last ? last.seq + 1 : 1, at, by: String(by || '').trim(), kind: it.kind, valDate: it.valDate || valDate || '', data: it.data || {}, prev: last ? last.hash : GENESIS };
    e.hash = entryHash(e);
    log.push(e);
    out.push(e);
  }
  return out;
}

// { ok, n, head, brokenAt (seq of the first bad entry), reason }
export function verify(log = []) {
  let prev = GENESIS;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.seq !== i + 1) return { ok: false, n: log.length, head: log[log.length - 1]?.hash || GENESIS, brokenAt: e.seq ?? i + 1, reason: 'seq' };
    if (e.prev !== prev) return { ok: false, n: log.length, head: log[log.length - 1]?.hash || GENESIS, brokenAt: e.seq, reason: 'link' };
    if (entryHash(e) !== e.hash) return { ok: false, n: log.length, head: log[log.length - 1]?.hash || GENESIS, brokenAt: e.seq, reason: 'hash' };
    prev = e.hash;
  }
  return { ok: true, n: log.length, head: prev, brokenAt: null, reason: '' };
}

// ---- changes to the controls -------------------------------------------------------------------------
// What the log watches on a portfolio: UCITS limits, fund rules, global exposure settings, LMTs.
export function controlsOf(p) {
  return JSON.parse(JSON.stringify({ limits: p?.limits || {}, rules: p?.rules || [], ge: p?.globalExposure || {}, lmt: p?.lmt || {} }));
}
const ruleSummary = r => ({ name: r.name, measure: r.measure, dir: r.dir, limit: r.limit, on: r.on !== false, conds: r.conds || [], groupBy: r.groupBy });
// Log items for every difference between two controlsOf() results.
export function controlDiff(before, after) {
  const items = [];
  for (const id of new Set([...Object.keys(before.limits || {}), ...Object.keys(after.limits || {})])) {
    const a = before.limits?.[id] || {}, b = after.limits?.[id] || {};
    if (!!a.on !== !!b.on) items.push({ kind: 'limit', data: { limit: id, field: 'on', from: !!a.on, to: !!b.on } });
    if (a.value !== b.value) items.push({ kind: 'limit', data: { limit: id, field: 'value', from: a.value ?? null, to: b.value ?? null } });
  }
  const ra = new Map((before.rules || []).map(r => [r.id, r])), rb = new Map((after.rules || []).map(r => [r.id, r]));
  for (const [id, r] of rb) {
    if (!ra.has(id)) items.push({ kind: 'rule', data: { rule: id, change: 'added', to: ruleSummary(r) } });
    else if (canon(ruleSummary(ra.get(id))) !== canon(ruleSummary(r))) items.push({ kind: 'rule', data: { rule: id, change: 'changed', from: ruleSummary(ra.get(id)), to: ruleSummary(r) } });
  }
  for (const [id, r] of ra) if (!rb.has(id)) items.push({ kind: 'rule', data: { rule: id, change: 'removed', from: ruleSummary(r) } });
  for (const key of ['ge', 'lmt']) if (canon(before[key]) !== canon(after[key])) items.push({ kind: key, data: { from: before[key], to: after[key] } });
  return items;
}

// ---- breach cases ------------------------------------------------------------------------------------
// A case is opened on a breach of one rule, gets notes, and is closed. Its state is read from the log.
export const caseId = (rule, start) => `${rule}@${start}`;
export function caseList(log = []) {
  const byId = new Map();
  for (const e of log) {
    if (!e.kind?.startsWith('case.')) continue;
    const d = e.data || {};
    let c = byId.get(d.case);
    if (e.kind === 'case.open' && !c) {
      c = { id: d.case, rule: d.rule, name: d.name || '', start: d.start, cause: d.cause || 'unknown', peak: d.peak, limit: d.limit, status: 'open', opened: { at: e.at, by: e.by, seq: e.seq }, notes: [], closed: null };
      byId.set(d.case, c);
    }
    if (!c) continue;
    if (d.text || d.action || (d.cause && e.kind !== 'case.open')) c.notes.push({ at: e.at, by: e.by, seq: e.seq, kind: e.kind, text: d.text || '', action: d.action || '', cause: d.cause || '' });
    if (d.cause) c.cause = d.cause;
    if (e.kind === 'case.close') { c.status = 'closed'; c.closed = { at: e.at, by: e.by, seq: e.seq, text: d.text || '' }; }
    if (e.kind === 'case.reopen') { c.status = 'open'; c.closed = null; }
  }
  return [...byId.values()].sort((a, b) => (a.status === b.status ? b.start.localeCompare(a.start) : a.status === 'open' ? -1 : 1));
}

// Breaches that have no case: the current ones (from compliance) and the episodes found in the
// history. An episode is covered by a case of the same rule opened on a date inside the episode
// (on or after its start, and not after its end); a current breach by an open case of its rule or a
// case inside its ongoing episode.
// current: [{ id, value, limit, dir }] of rules in breach now; episodes: breachHistory().episodes.
export function unhandled({ current = [], episodes = [], log = [], valDate = '' }) {
  const cases = caseList(log);
  const inside = (c, ep) => c.rule === ep.id && c.start >= ep.start && (!ep.end || c.start <= ep.end);
  const out = [];
  const openEp = new Map();
  for (const ep of episodes) {
    if (ep.ongoing) openEp.set(ep.id, ep);
    if (!cases.some(c => inside(c, ep))) out.push({ rule: ep.id, start: ep.start, end: ep.end, ongoing: !!ep.ongoing, cause: ep.cause, peak: ep.peak, limit: ep.limit, dir: ep.dir, days: ep.days });
  }
  for (const r of current) {
    const ep = openEp.get(r.id);
    if (ep) continue; // listed (or covered) as its episode
    if (cases.some(c => c.rule === r.id && c.status === 'open')) continue;
    out.push({ rule: r.id, start: valDate, end: null, ongoing: true, cause: 'unknown', peak: r.value, limit: r.limit, dir: r.dir, days: 0 });
  }
  return out.sort((a, b) => (a.ongoing === b.ongoing ? b.start.localeCompare(a.start) : a.ongoing ? -1 : 1));
}

// The newest sign-off, and whether today's valuation date has one.
export function lastSignoff(log = []) {
  for (let i = log.length - 1; i >= 0; i--) if (log[i].kind === 'signoff') return log[i];
  return null;
}

// CSV rows for the export: one row per entry, with the chain columns.
export function exportRows(log = [], describe = e => '') {
  return [['seq', 'time (UTC)', 'by', 'valuation date', 'kind', 'description', 'data', 'prev hash', 'hash'],
    ...log.map(e => [e.seq, e.at, e.by, e.valDate, e.kind, describe(e), canon(e.data), e.prev, e.hash])];
}

export const fmtLimitValue = x => (isNum(x) ? String(x) : x === true ? 'on' : x === false ? 'off' : '–');
