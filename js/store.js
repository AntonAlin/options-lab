// Workspace state: portfolios, settings, persistence in localStorage, a small undo stack and
// pub/sub so views re-render when data changes. Nothing ever leaves the browser.
import { uid, todayISO, isNum } from './util.js';

const KEY = 'nexus_portfolio_lab_v1';
const listeners = new Set();

// Approximate EUR crosses so a fresh workspace has something to convert with. They are placeholders:
// the Settings page says so and offers a one-click fetch of ECB reference rates.
export const FALLBACK_EUR_RATES = { EUR: 1, SEK: 11.2, NOK: 11.6, DKK: 7.46, USD: 1.12, GBP: 0.85, CHF: 0.94, JPY: 165, CAD: 1.55, AUD: 1.7, PLN: 4.3, CNY: 8.1, HKD: 8.75, SGD: 1.48, NZD: 1.85, ISK: 150 };
export const CURRENCIES = Object.keys(FALLBACK_EUR_RATES);

export const DEFAULT_CMA = {
  // Annualised, used by the parametric (factor) risk model when there is no price history.
  equityVol: 16, equitySpecificVol: 25, ratesVolBp: 90, creditVolBp: 70, fxVol: 9, commodityVol: 22, volOfVolPts: 6,
  // One equity factor per region (emerging markets with their own vol), IG and HY credit apart.
  equityVolEm: 20, corrEqRegion: 0.8, creditHyVolBp: 200, corrIgHy: 0.8,
  corrEqRates: 0.2, corrEqCredit: -0.6, corrEqFx: -0.3, corrEqCmd: 0.3, corrEqVol: -0.7, corrRatesCredit: -0.2,
  corrRatesRates: 0.75, corrFxFx: 0.55, corrCmdFx: -0.1,
  // Breakeven inflation: its own factor per currency, partly moving with nominal rates and commodities.
  inflationVolBp: 45, corrRatesInfl: 0.45, corrCmdInfl: 0.35
};

export const DEFAULT_RISK = { confidence: 0.99, horizonDays: 1, riskFree: 2.0, participation: 20, method: 'auto', cfMonths: 12, useReported: true, allocDim: 'auto' };

export const DEFAULT_LIMITS = {
  issuerMax: { on: true, value: 10 },
  issuer5_10_40: { on: true, value: 40 },
  govtIssuerMax: { on: true, value: 35 },
  bankDepositMax: { on: true, value: 20 },
  fundMax: { on: true, value: 20 },
  commitment: { on: true, value: 100 },
  otcCounterparty: { on: true, value: 10 },
  positionMax: { on: false, value: 7.5 },
  sectorMax: { on: false, value: 35 },
  highYieldMax: { on: false, value: 10 },
  liquidity7d: { on: true, value: 70 },
  cashMin: { on: false, value: 1 },
  illiquidMax: { on: true, value: 10 }
};

export function newPortfolio(o = {}) {
  return {
    id: uid('pf'), name: o.name || 'New portfolio', baseCcy: o.baseCcy || 'SEK', valDate: o.valDate || '',
    manager: o.manager || '', fundType: o.fundType || 'UCITS', nav: null,
    positions: o.positions || [],
    fxEur: { ...FALLBACK_EUR_RATES, ...(o.fxEur || {}) }, fxSource: o.fxSource || 'fallback', fxDate: o.fxDate || '',
    history: o.history || { dates: [], series: {} }, benchmark: o.benchmark || '',
    cma: { ...DEFAULT_CMA, ...(o.cma || {}) }, risk: { ...DEFAULT_RISK, ...(o.risk || {}) },
    limits: JSON.parse(JSON.stringify({ ...DEFAULT_LIMITS, ...(o.limits || {}) })),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), demo: !!o.demo
  };
}

function freshState() {
  return { version: 1, settings: { theme: 'auto', autoBackup: 'weekly', lastBackup: '' }, activeId: null, portfolios: {}, templates: [] };
}

let state = freshState();
let undoStack = [];
let storageOk = true;

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.portfolios) {
        state = { ...freshState(), ...s, settings: { ...freshState().settings, ...(s.settings || {}) } };
        // Old saves predate newer defaults — merge so a new limit or CMA key shows up.
        for (const p of Object.values(state.portfolios)) upgradePortfolio(p);
      }
    }
  } catch (e) {
    storageOk = false;
    console.warn('Workspace could not be read from localStorage', e);
  }
  if (!state.activeId || !state.portfolios[state.activeId]) state.activeId = Object.keys(state.portfolios)[0] || null;
  return state;
}

// Types and models that were removed. A variance swap becomes an OTC position at counterparty
// value (it is held back until that value is filled in); an autocall keeps its market price.
function retire(x) {
  if (x.type === 'variance_swap') {
    const sign = x.direction === 'pay' ? -1 : 1;
    Object.assign(x, { type: 'otc', underlyingClass: 'volatility', vega: sign * Math.abs(Number(x.qty) || 0) });
    for (const k of ['direction', 'swapKind', 'strike', 'vol', 'realisedVol', 'startDate', 'rate']) delete x[k];
  }
  if (x.type === 'certificate' && x.certType === 'autocall') delete x.certType;
  for (const k of ['autocallLevel', 'protectionLevel']) delete x[k];
}

export function upgradePortfolio(p) {
  p.cma = { ...DEFAULT_CMA, ...(p.cma || {}) };
  p.risk = { ...DEFAULT_RISK, ...(p.risk || {}) };
  p.fund = { classes: [], liabilities: 0, receivables: 0, feeFrom: '', ...(p.fund || {}) };
  p.allocTargets = p.allocTargets && typeof p.allocTargets === 'object' ? p.allocTargets : {};
  p.transactions = Array.isArray(p.transactions) ? p.transactions : [];
  delete p.navControl;
  const lim = JSON.parse(JSON.stringify(DEFAULT_LIMITS));
  for (const [k, v] of Object.entries(p.limits || {})) if (lim[k]) lim[k] = { ...lim[k], ...v };
  p.limits = lim;
  p.fxEur = { ...FALLBACK_EUR_RATES, ...(p.fxEur || {}) };
  p.history = p.history && p.history.dates ? p.history : { dates: [], series: {} };
  p.positions = Array.isArray(p.positions) ? p.positions : [];
  p.positions.forEach(x => { if (!x.id) x.id = uid(); retire(x); });
  (Array.isArray(p.snapshots) ? p.snapshots : []).forEach(s => (s.positions || []).forEach(retire));
  return p;
}

let saveTimer = null;
export function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageOk = true;
    } catch (e) {
      storageOk = false;
      emit('storage_error');
    }
  }, 150);
}
export const storageAvailable = () => storageOk;

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => { if (e.key === KEY) { load(); emit('active'); } });
}
function emit(reason) { listeners.forEach(fn => { try { fn(reason); } catch (e) { console.error(e); } }); }

export const settings = () => state.settings;
export function setSetting(k, v) { state.settings[k] = v; persist(); emit('settings'); }

// Import mapping templates are shared by all portfolios in the workspace.
export const templates = () => (Array.isArray(state.templates) ? state.templates : []);
export function saveTemplate(t) {
  state.templates = [...templates().filter(x => x.id !== t.id), t].sort((a, b) => a.name.localeCompare(b.name));
  persist(); emit('templates');
}
export function deleteTemplate(id) {
  state.templates = templates().filter(x => x.id !== id);
  persist(); emit('templates');
}

export function active() { return state.portfolios[state.activeId] || null; }
export function listPortfolios() { return Object.values(state.portfolios).sort((a, b) => a.name.localeCompare(b.name)); }
export function setActive(id) { if (state.portfolios[id]) { state.activeId = id; undoStack = []; persist(); emit('active'); } }

export function addPortfolio(p) {
  upgradePortfolio(p);
  state.portfolios[p.id] = p;
  state.activeId = p.id;
  undoStack = [];
  persist(); emit('active');
  return p;
}
// Add a portfolio without necessarily switching to it (a connected file can bring in several).
export function upsertPortfolio(p, { activate = false } = {}) {
  upgradePortfolio(p);
  state.portfolios[p.id] = p;
  if (activate || !state.activeId) { state.activeId = p.id; undoStack = []; }
  persist(); emit('active');
  return p;
}
// Change any portfolio, not only the active one. Not undoable: used when a connected file
// refreshes, and the undo snapshots taken before that would bring back stale holdings.
export function mutatePortfolio(id, fn, { silent = false } = {}) {
  const p = state.portfolios[id];
  if (!p) return;
  fn(p);
  p.updatedAt = new Date().toISOString();
  if (id === state.activeId) undoStack = [];
  persist();
  if (!silent) emit('data');
}
export function deletePortfolio(id) {
  delete state.portfolios[id];
  if (state.activeId === id) state.activeId = Object.keys(state.portfolios)[0] || null;
  undoStack = [];
  persist(); emit('active');
}

// Mutate the active portfolio. `label` goes on the undo stack so the toast can say what it undid.
export function update(fn, label = '') {
  const p = active();
  if (!p) return;
  undoStack.push({ label, snap: JSON.stringify(p) });
  if (undoStack.length > 30) undoStack.shift();
  fn(p);
  p.updatedAt = new Date().toISOString();
  persist(); emit('data');
}
export function undo() {
  const last = undoStack.pop();
  if (!last) return null;
  const p = JSON.parse(last.snap);
  state.portfolios[p.id] = p;
  persist(); emit('data');
  return last.label;
}

export function valuationDate(p = active()) { return (p && p.valDate) || todayISO(); }

// Base-currency value of one unit of `ccy`. Undefined when we have no rate — callers flag it.
export function fxFn(p = active()) {
  const eur = p.fxEur || FALLBACK_EUR_RATES;
  const b = eur[p.baseCcy];
  return ccy => {
    const minor = { GBX: 'GBP', ZAC: 'ZAR', ILA: 'ILS' }[ccy]; // quoted in 1/100 of the currency
    if (minor) { const f = fxFn(p)(minor); return isNum(f) ? f / 100 : undefined; }
    if (!ccy || ccy === p.baseCcy) return 1;
    const c = eur[ccy];
    return isNum(c) && isNum(b) && c > 0 ? b / c : undefined;
  };
}

export function exportWorkspace(extra = {}) { return JSON.stringify({ app: 'nexus-portfolio-lab', exportedAt: new Date().toISOString(), ...extra, ...state }, null, 2); }
export function importWorkspace(obj, { merge = true } = {}) {
  if (!obj || typeof obj !== 'object') throw new Error('invalid');
  // Accept a whole workspace or a single exported portfolio.
  const incoming = obj.portfolios ? Object.values(obj.portfolios) : obj.positions ? [obj] : null;
  if (!incoming) throw new Error('invalid');
  if (!merge) state.portfolios = {};
  for (const p of incoming) {
    const copy = upgradePortfolio({ ...newPortfolio(), ...p });
    if (state.portfolios[copy.id]) copy.id = uid('pf');
    state.portfolios[copy.id] = copy;
    state.activeId = copy.id;
  }
  if (obj.settings && !merge) state.settings = { ...state.settings, ...obj.settings };
  if (Array.isArray(obj.templates)) {
    const byId = new Map(templates().map(t => [t.id, t]));
    obj.templates.forEach(t => { if (t && t.id && t.mapping) byId.set(t.id, t); });
    state.templates = [...byId.values()];
  }
  undoStack = [];
  persist(); emit('active');
  return incoming.length;
}
export function resetWorkspace() {
  const s = state.settings;
  state = freshState();
  state.settings = s;
  undoStack = [];
  persist(); emit('active');
}
