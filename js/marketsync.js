// Keeps portfolios on the data published with the site (data/market.json): ECB FX rates for the
// portfolio's valuation date, the EUR curve and (when published) the Riksbank's SEK curve. Only portfolios that have not been given rates by
// hand or from their own ECB file are touched, and only when "update automatically" is on.
import * as store from './store.js';
import { MARKET_URL, fxOn, curveOn, isPublishedSource } from './marketdata.js';
import { setDateRates } from './insights.js';

let market = null;
let loading = null;
let lastError = '';
export const current = () => market;
export const lastLoadError = () => lastError;

// The market data can come from somewhere other than the site: an organisation that runs
// scripts/market-data.mjs on its own server with its own providers sets that file's address in
// Settings. Allowed: a path on the site itself, any https:// address, or http:// on this computer.
// The request is a plain GET without cookies; it carries no portfolio data.
export function checkMarketUrl(u) {
  const s = String(u ?? '').trim();
  if (!s) return '';
  if (/^https:\/\/[^\s/]+/i.test(s) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(s)) return s;
  if (!/^[a-z][a-z0-9+.-]*:|^\/\/|\s/i.test(s)) return s; // a relative path on the site
  return null;
}
export const marketUrl = () => checkMarketUrl(store.settings().marketUrl) || MARKET_URL;

export function load({ force = false } = {}) {
  if (loading && !force) return loading;
  const url = marketUrl();
  loading = fetch(url + (force ? `${url.includes('?') ? '&' : '?'}t=${Date.now()}` : ''), { cache: 'no-cache', credentials: 'omit' })
    .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
    .then(m => { if (!m || m.version !== 1 || !m.fx?.dates?.length) throw new Error('format'); market = m; lastError = ''; return m; })
    .catch(err => { loading = null; lastError = err.message || String(err); throw err; });
  return loading;
}

// Switch to another market data file (or back to the site's, with ''). The data loaded so far is
// dropped first, so a file that cannot be read leaves the portfolios on the rates they have.
export function setMarketUrl(u) {
  const ok = checkMarketUrl(u);
  if (ok === null) return Promise.reject(new Error('url'));
  store.setSetting('marketUrl', ok);
  market = null;
  return load({ force: true }).then(() => syncAll());
}

// What the published data would change on this portfolio: { fx, curve, dropCurve } or null.
export function planFor(p, m = market) {
  if (!m || !p || p.demo) return null;
  const s = store.settings();
  if (s.marketAuto === false) return null;
  const plan = {};
  if (['fallback', 'ecb-auto'].includes(p.fxSource || 'fallback')) {
    const fx = fxOn(m, p.valDate || '');
    if (fx && (p.fxSource !== 'ecb-auto' || p.fxDate !== fx.date)) plan.fx = fx;
  }
  if (p.curveMode === 'off') { if (p.curves) plan.dropCurve = true; }
  else {
    for (const ccy of Object.keys(m.curves || {})) {
      const c = curveOn(m, p.valDate || '', ccy);
      if (c && p.curves?.[ccy]?.date !== c.date) (plan.curves ||= {})[ccy] = { ...c, source: sourceOf(ccy, m) };
      // Valuation date outside the data: drop a published curve (never one given by hand).
      if (!c && isPublishedSource(p.curves?.[ccy]?.source)) (plan.drop ||= []).push(ccy);
    }
    // A currency that is no longer published at all (e.g. the Riksbank download failed for a week).
    for (const [ccy, c] of Object.entries(p.curves || {})) if (!m.curves?.[ccy] && isPublishedSource(c?.source)) (plan.drop ||= []).push(ccy);
  }
  return Object.keys(plan).length ? plan : null;
}
// Where a published curve came from. Files written before curves carried their source: EUR is the
// ECB's, SEK the Riksbank's.
const sourceOf = (ccy, m) => m?.curves?.[ccy]?.source || (ccy === 'SEK' ? 'riksbank' : 'ecb');
export function applyPlan(p, plan) {
  if (plan.fx) { p.fxEur = { ...p.fxEur, ...plan.fx.rates }; p.fxSource = 'ecb-auto'; p.fxDate = plan.fx.date; }
  for (const [ccy, c] of Object.entries(plan.curves || {})) p.curves = { ...(p.curves || {}), [ccy]: c };
  for (const ccy of plan.drop || []) if (p.curves) delete p.curves[ccy];
  if (plan.dropCurve || (p.curves && !Object.keys(p.curves).length)) delete p.curves;
}

// Bring every portfolio in line with the published data. Returns the number changed.
export function syncAll() {
  const todo = store.listPortfolios().map(p => [p, planFor(p)]).filter(([, plan]) => plan);
  todo.forEach(([p, plan], i) => store.mutatePortfolio(p.id, pp => applyPlan(pp, plan), { silent: i < todo.length - 1 }));
  return todo.length;
}

let busy = false;
// Rates for a past date, for portfolios that follow the published data: { fxEur, curves } or null.
export function ratesOn(p, date, m = market) {
  if (!m || !p || p.fxSource !== 'ecb-auto' || store.settings().marketAuto === false) return null;
  const fx = fxOn(m, date);
  if (!fx) return null;
  const curves = {};
  if (p.curveMode !== 'off') for (const ccy of Object.keys(m.curves || {})) { const c = curveOn(m, date, ccy); if (c) curves[ccy] = { ...c, source: sourceOf(ccy, m) }; }
  return { fxEur: { ...p.fxEur, ...fx.rates }, fxDate: fx.date, curves: Object.keys(curves).length ? curves : undefined };
}

export function init() {
  setDateRates((p, date) => ratesOn(p, date));
  // A new valuation date (typed in, or a connected file moved on) may need other rates.
  store.subscribe(() => {
    if (busy || !market) return;
    busy = true;
    try { syncAll(); } finally { busy = false; }
  });
  return load().then(() => syncAll()).catch(() => 0); // no file (local copy, offline): nothing to do
}
