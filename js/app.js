// App shell: sidebar, top bar, hash router, theme and language. Views live in ./views/*.
import * as store from './store.js';
import { t, lang } from './i18n.js';
import { esc, toast, openModal, closeModal, confirmDialog, selectHtml } from './ui.js';
import { fullAnalysis } from './analytics.js';
import { purgeAll } from './charts.js';
import { buildDemo } from './demo.js';
import { todayISO, debounce } from './util.js';

import dashboard from './views/dashboard.js';
import holdings from './views/holdings.js';
import importView from './views/import.js';
import history from './views/history.js';
import exposure from './views/exposure.js';
import risk from './views/risk.js';
import fixedIncome from './views/fixed-income.js';
import performance from './views/performance.js';
import stress from './views/stress.js';
import liquidity from './views/liquidity.js';
import compliance from './views/compliance.js';
import report from './views/report.js';
import settings from './views/settings.js';

const VIEWS = { dashboard, holdings, import: importView, history, exposure, risk, 'fixed-income': fixedIncome, performance, stress, liquidity, compliance, report, settings };

const NAV = [
  { group: 'nav.g.overview', items: [['dashboard', 'nav.dashboard', 'M3 12l9-9 9 9M5 10v10h14V10']] },
  { group: 'nav.g.portfolio', items: [['holdings', 'nav.holdings', 'M4 6h16M4 12h16M4 18h10'], ['import', 'nav.import', 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3'], ['history', 'nav.history', 'M3 17l6-6 4 4 8-8']] },
  { group: 'nav.g.analytics', items: [['exposure', 'nav.exposure', 'M12 3v9l7 4M21 12a9 9 0 11-18 0 9 9 0 0118 0z'], ['risk', 'nav.risk', 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z'], ['fixed-income', 'nav.fi', 'M4 19h16M6 15l4-4 3 3 5-6'], ['performance', 'nav.performance', 'M3 3v18h18M7 14l4-4 4 4 5-6'], ['stress', 'nav.stress', 'M13 2L3 14h7l-1 8 10-12h-7l1-8z'], ['liquidity', 'nav.liquidity', 'M12 2.7C12 2.7 5 10 5 14.5a7 7 0 0014 0C19 10 12 2.7 12 2.7z'], ['compliance', 'nav.compliance', 'M9 12l2 2 4-4M12 3l7 3v6c0 4.5-3 8.3-7 9-4-.7-7-4.5-7-9V6l7-3z']] },
  { group: 'nav.g.output', items: [['report', 'nav.report', 'M7 3h7l5 5v13H7zM14 3v5h5M9 13h6M9 17h6']] },
  { group: 'nav.g.tools', items: [['options-lab', 'nav.optionslab', 'M4 20L20 4M8 4h12v12'], ['settings', 'nav.settings', 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 009 19.4a1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 004.6 15 1.7 1.7 0 003 14H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 009 4.6 1.7 1.7 0 0010 3V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z']] }
];

// ---- analysis cache -----------------------------------------------------------------------------------
let cache = { key: '', value: null };
export function analysis() {
  const p = store.active();
  if (!p) return null;
  const key = p.id + '|' + p.updatedAt + '|' + (p.valDate || todayISO());
  if (cache.key !== key) cache = { key, value: fullAnalysis(p) };
  return cache.value;
}

export const app = {
  analysis,
  navigate(route) { location.hash = '#/' + route; },
  rerender: () => renderRoute(),
  route: () => currentRoute()
};

// ---- theme -------------------------------------------------------------------------------------------
const mq = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const pref = store.settings().theme || 'auto';
  const resolved = pref === 'auto' ? (mq.matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = pref === 'auto' ? '' : pref;
  if (pref === 'auto') delete document.documentElement.dataset.theme;
  document.documentElement.dataset.resolvedTheme = resolved;
}
mq.addEventListener?.('change', () => { applyTheme(); renderRoute(); });

// ---- shell ---------------------------------------------------------------------------------------------
function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '').split('?')[0];
  return VIEWS[h] ? h : 'dashboard';
}

function icon(d) { return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`; }

function renderSidebar() {
  const route = currentRoute();
  const a = store.active() ? analysis() : null;
  const badge = { compliance: a && a.comp.breaches ? `<span class="nav-badge" title="${esc(t('nav.breaches'))}">${a.comp.breaches}</span>` : '', holdings: a && a.v.errorsCount ? `<span class="nav-badge warn">${a.v.errorsCount}</span>` : '' };
  document.getElementById('sidebar').innerHTML = `
    <a class="brand" href="#/dashboard">
      <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18l5-6 4 3 7-9"/></svg></span>
      <span><strong>Nexus</strong> Portfolio Lab<small>${esc(t('app.tagline'))}</small></span>
    </a>
    <nav aria-label="${esc(t('nav.main'))}">
      ${NAV.map(g => `<div class="nav-group"><div class="nav-group-label">${esc(t(g.group))}</div>
        ${g.items.map(([id, key, d]) => id === 'options-lab'
          ? `<a class="nav-item" href="options-lab.html">${icon(d)}<span>${esc(t(key))}</span><span class="nav-ext">SV ↗</span></a>`
          : `<a class="nav-item ${route === id ? 'active' : ''}" href="#/${id}" ${route === id ? 'aria-current="page"' : ''}>${icon(d)}<span>${esc(t(key))}</span>${badge[id] || ''}</a>`).join('')}
      </div>`).join('')}
    </nav>
    <div class="sidebar-foot">
      <div class="privacy-note">${icon('M12 11c1.7 0 3-1.3 3-3V6a3 3 0 10-6 0v2c0 1.7 1.3 3 3 3zM5 11h14v10H5z')}<span>${esc(t('app.privacy'))}</span></div>
      <div class="copyright">© 2026 Anton Ålin · <a href="#/settings">${esc(t('nav.settings'))}</a></div>
    </div>`;
}

function renderTopbar() {
  const p = store.active();
  const list = store.listPortfolios();
  document.getElementById('topbar').innerHTML = `
    <button class="icon-btn menu-btn" id="menuBtn" aria-label="${esc(t('nav.menu'))}">${icon('M4 6h16M4 12h16M4 18h16')}</button>
    <div class="pf-switch">
      ${list.length ? selectHtml('id="pfSelect" aria-label="' + esc(t('top.portfolio')) + '"', list.map(x => [x.id, x.name]), p?.id) : `<span class="muted">${esc(t('top.noPortfolio'))}</span>`}
      <button class="btn btn-sm" id="pfNew">${esc(t('top.new'))}</button>
      ${p ? `<button class="icon-btn" id="pfMenu" aria-label="${esc(t('top.more'))}" title="${esc(t('top.more'))}">${icon('M12 6h.01M12 12h.01M12 18h.01')}</button>` : ''}
    </div>
    <div class="top-right">
      ${p ? `<label class="valdate" title="${esc(t('top.valdateHelp'))}"><span>${esc(t('top.valdate'))}</span><input type="date" id="valDate" value="${esc(p.valDate || todayISO())}"></label>
        <span class="base-chip" title="${esc(t('top.base'))}">${esc(p.baseCcy)}</span>` : ''}
      <div class="seg lang-seg" role="group" aria-label="Language / Språk">
        <span class="lang-globe" aria-hidden="true">${icon('M12 21a9 9 0 100-18 9 9 0 000 18zM3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 010 18M12 3a15 15 0 000 18')}</span>
        <button data-lang="en" lang="en" class="${lang() === 'en' ? 'on' : ''}" aria-pressed="${lang() === 'en'}"><span class="long">English</span><span class="short">EN</span></button>
        <button data-lang="sv" lang="sv" class="${lang() === 'sv' ? 'on' : ''}" aria-pressed="${lang() === 'sv'}"><span class="long">Svenska</span><span class="short">SV</span></button>
      </div>
      <button class="icon-btn" id="themeBtn" aria-label="${esc(t('top.theme'))}" title="${esc(t('top.theme'))}: ${esc(t('theme.' + (store.settings().theme || 'auto')))}">${icon(document.documentElement.dataset.resolvedTheme === 'dark' ? 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z' : 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.4-6.4l-.7.7M6.3 17.7l-.7.7m12.8 0l-.7-.7M6.3 6.3l-.7-.7M16 12a4 4 0 11-8 0 4 4 0 018 0z')}</button>
    </div>`;
  const $ = id => document.getElementById(id);
  $('menuBtn').onclick = () => document.body.classList.toggle('nav-open');
  $('pfSelect')?.addEventListener('change', e => store.setActive(e.target.value));
  $('pfNew').onclick = newPortfolioDialog;
  $('pfMenu')?.addEventListener('click', portfolioMenu);
  $('valDate')?.addEventListener('change', e => {
    const v = e.target.value;
    store.update(pp => { pp.valDate = v === todayISO() ? '' : v; }, t('top.valdate'));
  });
  document.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => store.setSetting('lang', b.dataset.lang));
  $('themeBtn').onclick = () => {
    const order = ['auto', 'light', 'dark'];
    const cur = store.settings().theme || 'auto';
    store.setSetting('theme', order[(order.indexOf(cur) + 1) % 3]);
  };
}

export function newPortfolioDialog() {
  const m = openModal(`<div class="modal-head"><h2>${esc(t('pf.newTitle'))}</h2></div>
    <form class="modal-body form-grid" id="npForm">
      <label>${esc(t('pf.name'))}<input name="name" required value="${esc(t('pf.defaultName'))}"></label>
      <label>${esc(t('pf.base'))}${selectHtml('name="baseCcy"', store.CURRENCIES.map(c => [c, c]), 'SEK')}</label>
      <label>${esc(t('pf.manager'))}<input name="manager" placeholder="${esc(t('pf.managerPh'))}"></label>
      <label>${esc(t('pf.fundType'))}${selectHtml('name="fundType"', [['UCITS', 'UCITS'], ['AIF', 'AIF'], ['Mandate', t('pf.mandate')], ['Other', t('pf.other')]], 'UCITS')}</label>
    </form>
    <div class="modal-foot"><button class="btn" data-close>${esc(t('common.cancel'))}</button><button class="btn btn-primary" form="npForm" type="submit">${esc(t('common.create'))}</button></div>`);
  m.querySelector('#npForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    store.addPortfolio(store.newPortfolio(f));
    closeModal();
    app.navigate('holdings');
    toast(t('pf.created'));
  });
}

export function loadDemo() {
  const p = buildDemo(todayISO());
  p.name = t('demo.name');
  store.addPortfolio(p);
  app.navigate('dashboard');
  toast(t('demo.loaded'));
}

function portfolioMenu(e) {
  const p = store.active();
  const m = openModal(`<div class="modal-head"><h2>${esc(p.name)}</h2></div>
    <div class="modal-body menu-list">
      <button class="menu-item" data-act="rename">${esc(t('pf.rename'))}</button>
      <button class="menu-item" data-act="duplicate">${esc(t('pf.duplicate'))}</button>
      <button class="menu-item" data-act="export">${esc(t('pf.exportJson'))}</button>
      <button class="menu-item" data-act="demo">${esc(t('pf.loadDemo'))}</button>
      <button class="menu-item danger" data-act="delete">${esc(t('pf.delete'))}</button>
    </div>
    <div class="modal-foot"><button class="btn" data-close>${esc(t('common.close'))}</button></div>`);
  m.addEventListener('click', async ev => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    closeModal();
    if (act === 'rename') {
      const name = prompt(t('pf.name'), p.name);
      if (name && name.trim()) store.update(pp => { pp.name = name.trim(); }, t('pf.rename'));
    } else if (act === 'duplicate') {
      const copy = JSON.parse(JSON.stringify(p));
      copy.id = 'pf_' + Math.random().toString(36).slice(2, 10);
      copy.name = p.name + ' ' + t('pf.copySuffix');
      store.addPortfolio(copy);
      toast(t('pf.duplicated'));
    } else if (act === 'export') {
      const { downloadBlob, slug } = await import('./util.js');
      downloadBlob(JSON.stringify({ app: 'nexus-portfolio-lab', portfolios: { [p.id]: p } }, null, 2), 'application/json', slug(p.name) + '.json');
    } else if (act === 'demo') loadDemo();
    else if (act === 'delete') {
      if (await confirmDialog(t('pf.deleteConfirm', { name: esc(p.name) }), { ok: t('common.delete'), danger: true })) {
        store.deletePortfolio(p.id);
        toast(t('pf.deleted'));
      }
    }
  });
}

// ---- routing -------------------------------------------------------------------------------------------
let cleanup = null;
function renderRoute() {
  const main = document.getElementById('main');
  const route = currentRoute();
  document.documentElement.lang = lang();
  document.title = `${t('nav.' + (route === 'fixed-income' ? 'fi' : route))} · Nexus Portfolio Lab`;
  renderSidebar();
  renderTopbar();
  if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { /* view already gone */ } }
  cleanup = null;
  purgeAll(main);
  const view = VIEWS[route];
  const p = store.active();
  main.dataset.route = route;
  try {
    if (!p && !view.noPortfolio) {
      cleanup = dashboard.render(main, app);
    } else {
      cleanup = view.render(main, app);
    }
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="card"><div class="card-body"><h2>${esc(t('err.view'))}</h2><pre class="err">${esc(err.stack || err.message)}</pre></div></div>`;
  }
  document.body.classList.remove('nav-open');
}

function init() {
  // Share links from the old single-page options lab (#s=...) now live on options-lab.html.
  if (/^#s=/.test(location.hash) || /[#&]s=[A-Za-z0-9_-]{20,}/.test(location.hash)) {
    location.replace('options-lab.html' + location.hash);
    return;
  }
  store.load();
  applyTheme();
  store.subscribe(reason => {
    if (reason === 'settings') applyTheme();
    if (reason === 'storage_error') { toast(t('err.storage'), { tone: 'warn', ms: 8000 }); return; }
    renderRoute();
  });
  window.addEventListener('hashchange', () => {
    if (/^#s=/.test(location.hash)) { location.replace('options-lab.html' + location.hash); return; }
    renderRoute(); document.getElementById('main').focus({ preventScroll: true }); window.scrollTo(0, 0); });
  window.addEventListener('resize', debounce(() => document.querySelectorAll('.js-plotly-plot').forEach(el => window.Plotly?.Plots.resize(el)), 150));
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/input|textarea|select/i.test(e.target.tagName)) {
      const label = store.undo();
      if (label !== null) toast(t('common.undone', { what: label || '' }));
    }
  });
  if (!store.storageAvailable()) toast(t('err.storage'), { tone: 'warn', ms: 8000 });
  renderRoute();
  // Plotly is deferred; re-render once it lands so charts appear.
  if (!window.Plotly) {
    const s = document.getElementById('plotlyScript');
    s?.addEventListener('load', () => renderRoute(), { once: true });
  }
}

init();
