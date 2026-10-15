// Fills in issuer LEIs automatically from GLEIF's ISIN-LEI mapping published with the site
// (data/lei/, js/leimap.js). Every ISIN in the workspace's holdings that has no LEI of its own is
// looked up once per published mapping; the answers are kept in the workspace (store.isinLei), so
// the TPT and the issuer register have them without a network request. Only the site itself is
// asked, for shards that each hold thousands of unrelated ISINs. Off with Settings → Issuers.
import * as store from './store.js';
import { createLookup, isIsin } from './leimap.js';
import { debounce } from './util.js';

const lookup = createLookup(async url => { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? r.text() : null; });
let running = null;
let status = { state: 'idle', date: '', found: 0, missing: 0, error: '' };
const listeners = new Set();
export const onStatus = fn => (listeners.add(fn), () => listeners.delete(fn));
export const getStatus = () => status;
const set = patch => { status = { ...status, ...patch }; listeners.forEach(fn => { try { fn(status); } catch (e) { console.error(e); } }); };

export const enabled = () => store.settings().leiAuto !== false;

// ISINs that need an answer: held, valid, no LEI on the holding, not answered for this mapping.
function pending(date) {
  const cache = store.isinLei();
  const fresh = cache.date && date && cache.date >= date;
  const out = new Set();
  for (const p of store.listPortfolios()) for (const pos of p.positions || []) {
    if (pos.issuerLei || !pos.isin) continue;
    const i = String(pos.isin).toUpperCase();
    if (!isIsin(i)) continue;
    if (fresh && i in cache.map) continue;
    out.add(i);
  }
  return [...out];
}

export function sync({ force = false } = {}) {
  if (running) return running;
  if (!enabled() && !force) return Promise.resolve(null);
  running = (async () => {
    try {
      const m = await lookup.manifest();
      if (!m) { set({ state: 'unavailable' }); return null; }
      const todo = pending(m.date);
      if (!todo.length) { set({ state: 'done', date: m.date }); return null; }
      set({ state: 'running', date: m.date });
      const res = await lookup.lookup(todo);
      if (!res) { set({ state: 'unavailable' }); return null; }
      store.setIsinLeis(res.date, res.found, res.missing);
      set({ state: 'done', date: res.date, found: Object.keys(res.found).length, missing: res.missing.length, error: '' });
      return res;
    } catch (e) {
      console.error(e);
      set({ state: 'error', error: String(e.message || e) });
      return null;
    } finally { running = null; }
  })();
  return running;
}

// Runs once at start and again a few seconds after holdings change.
export function init() {
  const later = debounce(() => sync(), 4000);
  store.subscribe(r => { if (r === 'data' || r === 'active') later(); });
  setTimeout(() => sync(), 1500);
}
