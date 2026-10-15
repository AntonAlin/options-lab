// Download GLEIF's ISIN-LEI mapping and write data/lei/ for the site (see js/leimap.js).
//   node scripts/lei-map.mjs [outDir] [--from file.csv|file.zip]
// Without --from it asks GLEIF for the latest file. Exits non-zero, writing nothing, when the
// download fails or looks implausible, so a bad day never replaces a good published copy.
import { mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { shardOf, shardText, csvPairReader, SHARD_BITS } from '../js/leimap.js';

const args = process.argv.slice(2);
const fromAt = args.indexOf('--from');
const from = fromAt >= 0 ? args[fromAt + 1] : null;
const out = args.find((a, i) => !a.startsWith('--') && (fromAt < 0 || i !== fromAt + 1)) || 'data/lei';
const LATEST = 'https://mapping.gleif.org/api/v2/isin-lei/latest';
const MIN_PAIRS = from ? 1 : 1_000_000; // the real file holds millions; far fewer means a broken download
const MAX_BYTES = 900 * 1024 * 1024;    // GitHub Pages sites are limited to about 1 GB

const UA = { 'User-Agent': 'nexus-portfolio-lab ISIN-LEI mapping (GitHub Actions)' };
// The newest file's download link, wherever GLEIF's JSON puts it.
async function latestLink() {
  // GLEIF's API is JSON:API: it answers 406 to a plain application/json Accept header.
  const res = await fetch(LATEST, { headers: { ...UA, Accept: 'application/vnd.api+json, application/json;q=0.9, */*;q=0.1' } });
  if (!res.ok) throw new Error(`${LATEST}: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const json = await res.json();
  let link = null, name = '';
  const walk = o => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && /^https?:\/\//.test(v) && /download/i.test(k + v) && !link) link = v;
      if (typeof v === 'string' && /filename/i.test(k)) name = v;
      walk(v);
    }
  };
  walk(json);
  if (!link) throw new Error('GLEIF: no download link in ' + JSON.stringify(json).slice(0, 300));
  return { link, name };
}

// Lines of the CSV inside a zip (unzip -p streams it) or of a plain CSV.
function csvLines(path) {
  if (/\.zip$/i.test(path)) {
    const p = spawn('unzip', ['-p', path], { stdio: ['ignore', 'pipe', 'inherit'] });
    return { lines: createInterface({ input: p.stdout, crlfDelay: Infinity }), done: new Promise((res, rej) => p.on('close', c => (c === 0 ? res() : rej(new Error('unzip exited ' + c))))) };
  }
  return { lines: createInterface({ input: createReadStream(path), crlfDelay: Infinity }), done: Promise.resolve() };
}

async function main() {
  let file = from, source = from || '', tmp = null;
  if (!from) {
    const { link, name } = await latestLink();
    source = name || link;
    tmp = join(tmpdir(), 'isin-lei.zip');
    const res = await fetch(link, { headers: UA });
    if (!res.ok || !res.body) throw new Error(`${link}: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
    await new Promise((resolve, reject) => Readable.fromWeb(res.body).pipe(createWriteStream(tmp)).on('finish', resolve).on('error', reject));
    file = tmp;
  }
  const buckets = new Map();
  const { read, stats } = csvPairReader();
  const { lines, done } = csvLines(file);
  for await (const line of lines) {
    const pair = read(line);
    if (!pair) continue;
    const s = shardOf(pair[0]);
    (buckets.get(s) || buckets.set(s, []).get(s)).push(pair);
  }
  await done;
  if (stats.kept < MIN_PAIRS) throw new Error(`only ${stats.kept} ISIN-LEI pairs (${JSON.stringify(stats)}): not publishing`);

  // Written to a fresh directory and swapped in at the end, so a failure leaves the old one alone.
  const stage = out + '.new';
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  let bytes = 0;
  const n = 1 << SHARD_BITS;
  for (let k = 0; k < n; k++) {
    const id = k.toString(16).padStart(Math.ceil(SHARD_BITS / 4), '0');
    const text = shardText(buckets.get(id) || []);
    bytes += Buffer.byteLength(text);
    await writeFile(join(stage, id + '.txt'), text);
  }
  if (bytes > MAX_BYTES) throw new Error(`mapping is ${(bytes / 1e6).toFixed(0)} MB, over the ${MAX_BYTES / 1e6} MB budget: not publishing`);
  const manifest = { source: 'GLEIF ISIN-LEI mapping', file: source, date: new Date().toISOString().slice(0, 10), pairs: stats.kept, skipped: { badIsin: stats.badIsin, badLei: stats.badLei }, bits: SHARD_BITS, shards: n, bytes, licence: 'CC0 (GLEIF)' };
  await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await rm(out, { recursive: true, force: true });
  await rename(stage, out);
  if (tmp) await rm(tmp, { force: true });
  console.log(`ISIN-LEI mapping: ${stats.kept} pairs in ${n} shards, ${(bytes / 1e6).toFixed(1)} MB → ${out}`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
