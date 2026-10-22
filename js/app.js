// App shell: sidebar, top bar, hash router and theme. Views live in ./views/*.
import * as store from './store.js';
import { t } from './i18n.js';
import { esc, toast, openModal, closeModal, confirmDialog, selectHtml } from './ui.js';
import { fullAnalysis } from './analytics.js';
import { fundAnalysis } from './fund.js';
import { allocationAnalysis, derivativesBook } from './allocation.js';
import { purgeAll } from './charts.js';
import { todayISO, debounce } from './util.js';
import * as filelink from './filelink.js';
import * as sources from './sources.js';
import { errorText as sourceError } from './views/source-card.js';
import { REPO_URL } from './guide.js';
import { backupAge, maybeAutoBackup, BACKUP_WARN_DAYS } from './backup.js';

import dashboard from './views/dashboard.js';
import holdings from './views/holdings.js';
import importView, { mappingPending } from './views/import.js';
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
import cashflow from './views/cashflow.js';
import navView from './views/nav.js';
import allocationView from './views/allocation.js';
import derivativesView from './views/derivatives.js';
import methodologyView from './views/methodology.js';
import guideView from './views/guide.js';
import changesView from './views/changes.js';
import whatifView from './views/whatif.js';
import attributionView from './views/attribution.js';
import * as marketsync from './marketsync.js';
import pnlView from './views/pnl.js';
import globalExposureView from './views/global-exposure.js';
import lmtView from './views/liquidity-tools.js';
import controlLogView from './views/control-log.js';
import setupView, { openDemo } from './views/setup.js';
import aboutView from './views/about.js';
import { unhandled } from './auditlog.js';
import { pnlAnalysis } from './pnl.js';

const VIEWS = { dashboard, holdings, import: importView, history, exposure, risk, 'fixed-income': fixedIncome, performance, stress, liquidity, compliance, report, settings, cashflow, nav: navView, allocation: allocationView, derivatives: derivativesView, methodology: methodologyView, pnl: pnlView, guide: guideView, changes: changesView, whatif: whatifView, attribution: attributionView, 'global-exposure': globalExposureView, 'liquidity-tools': lmtView, 'control-log': controlLogView, setup: setupView, about: aboutView };
// Pages that work without a connected data source: reading about the app, and connecting one.
const OPEN_ROUTES = new Set(['guide', 'methodology', 'setup', 'about']);

// Five groups, collapsible, the first open. Every route is here; the group of the page being shown
// is always open, whatever was stored, so the active link is never hidden.
const NAV = [
  { group: 'nav.g.overview', items: [['dashboard', 'nav.dashboard', 'M3 12l9-9 9 9M5 10v10h14V10'], ['risk', 'nav.risk', 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z'], ['stress', 'nav.stress', 'M13 2L3 14h7l-1 8 10-12h-7l1-8z'], ['performance', 'nav.performance', 'M3 3v18h18M7 14l4-4 4 4 5-6'], ['report', 'nav.report', 'M7 3h7l5 5v13H7zM14 3v5h5M9 13h6M9 17h6']] },
  { group: 'nav.g.portfolio', items: [['holdings', 'nav.holdings', 'M4 6h16M4 12h16M4 18h10'], ['pnl', 'nav.pnl', 'M4 19h16M6 15l4-6 4 3 4-7M17 5h3v3'], ['changes', 'nav.changes', 'M4 7h13l-3-3M20 17H7l3 3'], ['control-log', 'nav.controlLog', 'M9 4h6v3H9zM7 5H5v16h14V5h-2M8 12l2 2 4-4M8 18h8'], ['whatif', 'nav.whatif', 'M9 7h6M12 4v6M5 14h14v6H5zM9 17h6'], ['import', 'nav.import', 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3'], ['history', 'nav.history', 'M3 17l6-6 4 4 8-8'], ['nav', 'nav.nav', 'M4 19h16M6 16V9m4 7V5m4 11v-5m4 5V8']] },
  { group: 'nav.g.analytics', items: [['allocation', 'nav.allocation', 'M12 3a9 9 0 109 9h-9zM15 3.5A9 9 0 0120.5 9H15z'], ['exposure', 'nav.exposure', 'M12 3v9l7 4M21 12a9 9 0 11-18 0 9 9 0 0118 0z'], ['derivatives', 'nav.derivatives', 'M3 12c3-8 6-8 9 0s6 8 9 0'], ['global-exposure', 'nav.globalExposure', 'M4 12h4l2-6 4 12 2-6h4'], ['fixed-income', 'nav.fi', 'M4 19h16M6 15l4-4 3 3 5-6'], ['attribution', 'nav.attribution', 'M4 20V10M10 20V4M16 20v-7M22 20H2']] },
  { group: 'nav.g.liquidity', items: [['liquidity', 'nav.liquidity', 'M12 2.7C12 2.7 5 10 5 14.5a7 7 0 0014 0C19 10 12 2.7 12 2.7z'], ['liquidity-tools', 'nav.lmt', 'M6 3h12M6 21h12M8 3v4l4 5-4 5v4M16 3v4l-4 5 4 5v4'], ['cashflow', 'nav.cashflow', 'M8 3v3m8-3v3M4 8h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM8 12h3v3H8z'], ['compliance', 'nav.compliance', 'M9 12l2 2 4-4M12 3l7 3v6c0 4.5-3 8.3-7 9-4-.7-7-4.5-7-9V6l7-3z']] },
  { group: 'nav.g.help', items: [['guide', 'nav.guide', 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 21V5M8 7h7M8 11h7'], ['methodology', 'nav.methodology', 'M4 5h16v14H4zM8 9h8M8 13h5M4 5l3-2h10l3 2'], ['about', 'nav.about', 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01'], ['settings', 'nav.settings', 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 009 19.4a1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 004.6 15 1.7 1.7 0 003 14H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 009 4.6 1.7 1.7 0 0010 3V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z']] }
];

// ---- analysis cache -----------------------------------------------------------------------------------
let cache = { key: '', value: null };
export function analysis() {
  const p = store.active();
  if (!p) return null;
  const key = p.id + '|' + p.updatedAt + '|' + (p.valDate || todayISO());
  if (cache.key !== key) { const a = fullAnalysis(p); Object.assign(a, fundAnalysis(p, a), { aa: allocationAnalysis(a.v, p), db: derivativesBook(a.v), pnl: pnlAnalysis(a.v, p), pnlFor: from => pnlAnalysis(a.v, p, { from }) }); cache = { key, value: a }; }
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
  // Breaches today without a case (the full list, with the history, is on the page itself).
  const todo = a ? unhandled({ current: a.comp.rules.filter(r => r.status === 'breach'), log: store.active().controlLog, valDate: store.valuationDate() }).length : 0;
  if (todo) badge['control-log'] = `<span class="nav-badge" title="${esc(t('cl.todo'))}">${todo}</span>`;
  document.getElementById('sidebar').innerHTML = `
    <a class="brand" href="#/dashboard">
      <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18l5-6 4 3 7-9"/></svg></span>
      <span><strong>Nexus</strong> Portfolio Lab<small>${esc(t('app.tagline'))}</small></span>
    </a>
    <nav aria-label="${esc(t('nav.main'))}">
      ${NAV.map((g, gi) => {
        const open = navGroupOpen(g, gi, route);
        const flagged = !open && g.items.some(([id]) => badge[id]);
        return `<div class="nav-group ${open ? 'open' : ''}">
        <button type="button" class="nav-group-label" data-nav-group="${g.group}" aria-expanded="${open}" aria-controls="ng-${gi}">
          <span>${esc(t(g.group))}</span>${flagged ? `<span class="nav-dot" title="${esc(t('nav.flagged'))}"></span>` : ''}<svg class="nav-chev" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        </button>
        <div class="nav-items" id="ng-${gi}" ${open ? '' : 'hidden'}>
        ${g.items.map(([id, key, d]) => { const label = t(key); return `<a class="nav-item ${route === id ? 'active' : ''}" href="#/${id}" aria-label="${esc(label)}" title="${esc(label)}" ${route === id ? 'aria-current="page"' : ''}>${icon(d)}<span>${esc(label)}</span>${badge[id] || ''}</a>`; }).join('')}
        </div>
      </div>`;
      }).join('')}
    </nav>
    <div class="sidebar-foot">
      <a class="privacy-note" href="#/guide?s=privacy" title="${esc(t('privacy.more'))}">${icon('M12 11c1.7 0 3-1.3 3-3V6a3 3 0 10-6 0v2c0 1.7 1.3 3 3 3zM5 11h14v10H5z')}<span>${esc(t('app.privacy'))}</span></a>
      ${sourcesStatusHtml()}
      ${dataStatusHtml()}
      <div class="built-by">${esc(t('about.builtBy'))} <a href="#/about">Anton Ålin</a></div>
      <div class="copyright">© 2026 Anton Ålin · <a href="#/settings">${esc(t('nav.settings'))}</a> · <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">${esc(t('app.source'))}</a> · <a href="${REPO_URL}/issues/new/choose" target="_blank" rel="noopener noreferrer">${esc(t('app.report'))}</a></div>
    </div>`;
}

// Which nav groups are open: stored per browser, the first group open by default, and always the
// group of the page being shown. Storage may be blocked (private mode); the defaults then apply.
const NAV_KEY = 'nexus_nav_groups';
function navState() { try { return JSON.parse(localStorage.getItem(NAV_KEY) || '{}') || {}; } catch (e) { return {}; } }
function navGroupOpen(g, gi, route) {
  if (g.items.some(([id]) => id === route)) return true;
  const s = navState();
  return g.group in s ? !!s[g.group] : gi === 0;
}
function toggleNavGroup(btn) {
  const open = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', String(open));
  btn.parentElement.classList.toggle('open', open);
  document.getElementById(btn.getAttribute('aria-controls')).hidden = !open;
  try { localStorage.setItem(NAV_KEY, JSON.stringify({ ...navState(), [btn.dataset.navGroup]: open })); } catch (e) { /* not remembered, still works */ }
}

// The drawer (narrow screens): Escape closes it, Tab stays inside it while it is open, and focus
// goes back to the menu button when it closes.
function setDrawer(open) {
  document.body.classList.toggle('nav-open', open);
  const btn = document.getElementById('menuBtn');
  btn?.setAttribute('aria-expanded', String(open));
  if (open) document.querySelector('#sidebar .nav-item.active, #sidebar a, #sidebar button')?.focus();
  else if (btn && document.getElementById('sidebar').contains(document.activeElement)) btn.focus();
}
// Only a drawer below 900 px (css/app.css); on a desktop the sidebar is just there.
const drawerOpen = () => document.body.classList.contains('nav-open') && window.matchMedia('(max-width: 900px)').matches;
document.addEventListener('keydown', e => {
  if (!drawerOpen()) return;
  if (e.key === 'Escape') { e.preventDefault(); setDrawer(false); return; }
  if (e.key !== 'Tab') return;
  const items = [...document.querySelectorAll('#sidebar a[href], #sidebar button')].filter(el => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (!document.getElementById('sidebar').contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
document.addEventListener('click', e => {
  const g = e.target.closest('[data-nav-group]');
  if (g) { toggleNavGroup(g); return; }
  // A tap on the dimmed page beside the open drawer closes it.
  if (drawerOpen() && !e.target.closest('#sidebar, #menuBtn')) setDrawer(false);
});

// Where the data lives right now: a linked file (and whether it is saved) or, failing that, how
// old the last manual backup is. Sits in the sidebar so it is always in view.
function dataStatusHtml() {
  const fs = filelink.getStatus();
  const time = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (fs.state === 'linked' || fs.state === 'needs-permission' || fs.state === 'error') {
    const tone = fs.state === 'linked' ? (fs.pending ? 'pending' : 'ok') : 'warn';
    const text = fs.state === 'linked' ? (fs.pending ? t('file.saving') : fs.lastSaved ? t('file.savedAt', { t: time(fs.lastSaved) }) : t('file.notYetSaved'))
      : fs.state === 'needs-permission' ? t('file.needsPermission') : t('file.error');
    return `<a class="data-status ${tone}" href="#/settings" title="${esc(fs.name)}">${icon('M4 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2z')}<span><strong>${esc(fs.name)}</strong><br>${esc(text)}</span></a>`;
  }
  const has = store.listPortfolios().some(p => p.positions.length && !p.demo);
  if (!has) return '';
  const age = backupAge();
  const tone = age == null || age > BACKUP_WARN_DAYS ? 'warn' : 'ok';
  const text = age == null ? t('backup.never') : age < 1 ? t('backup.today') : t('backup.daysAgo', { n: Math.floor(age) });
  return `<a class="data-status ${tone}" href="#/settings">${icon('M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3')}<span><strong>${esc(t('backup.label'))}</strong><br>${esc(text)}</span></a>`;
}

// The connected data sources: read, written, or waiting.
function sourcesStatusHtml() {
  const time = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return sources.list().map(s => {
    const st = s.status;
    const bad = st.state !== 'linked' || !!st.error || st.write === 'blocked';
    const busy = st.write === 'pending' || st.write === 'writing';
    const text = s.kind === 'memory' && st.state === 'linked' ? t('mem.status') : st.state === 'init' ? t('src.checking') : st.state === 'needs-permission' ? t('src.needsPermission') : st.state !== 'linked' || st.error ? sourceError(st.error, st.status)
      : st.write === 'blocked' ? t('src.writeBlockedShort', { n: st.queued }) : busy ? t('src.writing') : st.lastWrite ? t('src.writtenAt', { t: time(st.lastWrite) }) : t('src.readAt', { t: st.lastRead ? time(st.lastRead) : '—' });
    const d = s.kind === 'api' ? 'M4 12h4m8 0h4M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14' : 'M4 4h10l6 6v10H4zM14 4v6h6M8 14l3 3 5-6';
    return `<a class="data-status ${bad ? 'warn' : busy ? 'pending' : 'ok'}" href="#/import" title="${esc(s.kind === 'api' ? s.url : s.name)}">${icon(d)}<span><strong>${esc(s.name)}</strong><br>${esc(text)}</span></a>`;
  }).join('');
}

// Banner above the page: the linked file needs a click to reconnect, or holds newer data.
function renderBanner() {
  const el = document.getElementById('banner');
  if (!el) return;
  const fs = filelink.getStatus();
  let html = '';
  // A data source that needs a click comes first; the linked-file banner shows once that is sorted.
  const all = sources.list();
  const blocked = all.find(s => s.status.state === 'linked' && s.status.write === 'blocked');
  const perm = all.find(s => s.status.state === 'needs-permission');
  const failed = all.find(s => s.status.state === 'error' || (s.status.state === 'linked' && s.status.error));
  // The demo, or a file opened read only: always say that nothing is kept, with the way out.
  const mem = all.find(s => s.kind === 'memory' && s.status.state === 'linked');
  if (blocked) html = `<div class="alert alert-warn"><span>${esc(t('src.bannerWriteBlocked', { name: blocked.name, n: blocked.status.queued, err: blocked.status.writeError }))}</span><span class="btn-row"><button class="btn btn-sm btn-primary" data-file="src-flush" data-id="${esc(blocked.id)}">${esc(t('src.retry'))}</button><button class="btn btn-sm" data-file="src-discard" data-id="${esc(blocked.id)}">${esc(t('src.discard'))}</button></span></div>`;
  else if (perm) html = `<div class="alert alert-warn"><span>${esc(t('src.bannerPermission', { name: perm.name }))}</span><span class="btn-row"><button class="btn btn-sm btn-primary" data-file="src-reconnect" data-id="${esc(perm.id)}">${esc(t('src.reconnect'))}</button><button class="btn btn-sm" data-file="src-disconnect" data-id="${esc(perm.id)}">${esc(t('src.disconnect'))}</button></span></div>`;
  else if (failed) html = `<div class="alert alert-breach"><span>${esc(t('src.bannerError', { name: failed.name, err: sourceError(failed.status.error, failed.status.status) }))}</span><span class="btn-row"><a class="btn btn-sm" href="#/import">${esc(t('src.open'))}</a><button class="btn btn-sm" data-file="src-disconnect" data-id="${esc(failed.id)}">${esc(t('src.disconnect'))}</button></span></div>`;
  else if (mem) html = mem.demo
    ? `<div class="alert alert-info demo-banner"><span>${esc(t('demo.banner'))}</span><span class="btn-row"><a class="btn btn-sm btn-primary" href="#/setup">${esc(t('demo.connect'))}</a><button class="btn btn-sm" data-file="mem-close" data-id="${esc(mem.id)}">${esc(t('demo.leave'))}</button></span></div>`
    : `<div class="alert alert-info"><span>${esc(t('mem.banner', { name: mem.name }))}</span><span class="btn-row"><button class="btn btn-sm" data-file="mem-close" data-id="${esc(mem.id)}">${esc(t('mem.close'))}</button></span></div>`;
  if (html) { /* shown */ }
  else if (fs.state === 'needs-permission') html = `<div class="alert alert-warn"><span>${esc(t('file.bannerPermission', { name: fs.name }))}</span><span class="btn-row"><button class="btn btn-sm btn-primary" data-file="reconnect">${esc(t('file.reconnect'))}</button><button class="btn btn-sm" data-file="unlink">${esc(t('file.unlink'))}</button></span></div>`;
  else if (fs.state === 'error') html = `<div class="alert alert-breach"><span>${esc(t('file.bannerError', { name: fs.name, err: fs.error }))}</span><span class="btn-row"><button class="btn btn-sm" data-file="retry">${esc(t('file.retry'))}</button><button class="btn btn-sm" data-file="unlink">${esc(t('file.unlink'))}</button></span></div>`;
  else if (fs.conflict) html = `<div class="alert alert-info"><span>${esc(fs.conflict.empty ? t('file.bannerLoad', { name: fs.name, n: fs.conflict.n }) : t('file.bannerNewer', { name: fs.name, n: fs.conflict.n, d: fs.conflict.fileAt ? new Date(fs.conflict.fileAt).toLocaleString('en-GB') : '' }))}</span><span class="btn-row"><button class="btn btn-sm btn-primary" data-file="load">${esc(t('file.loadFromFile'))}</button><button class="btn btn-sm" data-file="keep">${esc(t('file.keepLocal'))}</button></span></div>`;
  el.innerHTML = html;
  el.hidden = !html;
  el.onclick = async e => {
    const b = e.target.closest('[data-file]');
    const act = b?.dataset.file, id = b?.dataset.id;
    if (!act) return;
    try {
      if (act === 'mem-close') { const s = sources.get(id); await sources.closeMemory(id); toast(s?.demo ? t('demo.left') : t('mem.closed', { name: s?.name || '' })); if (s?.demo) location.hash = '#/setup'; }
      if (act === 'src-reconnect') await sources.reconnect(id);
      if (act === 'src-flush' && !(await sources.flush(id))) toast(t('src.writeBlockedShort', { n: sources.queued(id) }), { tone: 'warn' });
      if (act === 'src-discard' && await confirmDialog(t('src.discardConfirm', { n: sources.queued(id) }), { danger: true, ok: t('src.discard') })) await sources.discardPending(id);
      if (act === 'src-disconnect' && await confirmDialog(t('src.disconnectConfirm'))) await sources.disconnect(id);
      if (act === 'reconnect') await filelink.reconnect();
      if (act === 'retry') await filelink.save();
      if (act === 'unlink' && await confirmDialog(t('file.unlinkConfirm'))) await filelink.unlink();
      if (act === 'load') { const n = await filelink.loadFromFile(); toast(t('file.loaded', { n })); }
      if (act === 'keep') { filelink.dismissConflict(); await filelink.save(); }
    } catch (err) { console.error(err); toast(t('file.failed'), { tone: 'warn' }); }
  };
}

function renderTopbar() {
  const p = store.active();
  const list = store.listPortfolios();
  document.getElementById('topbar').innerHTML = `
    <button class="icon-btn menu-btn" id="menuBtn" aria-label="${esc(t('nav.menu'))}" title="${esc(t('nav.menu'))}" aria-controls="sidebar" aria-expanded="${drawerOpen()}">${icon('M4 6h16M4 12h16M4 18h16')}</button>
    <div class="pf-switch">
      ${list.length ? selectHtml('id="pfSelect" aria-label="' + esc(t('top.portfolio')) + '"', list.map(x => [x.id, x.name]), p?.id) : `<span class="muted">${esc(t('top.noPortfolio'))}</span>`}
      <button class="btn btn-sm" id="pfNew" aria-label="${esc(t('top.newLabel'))}" title="${esc(t('top.newLabel'))}">${esc(t('top.new'))}</button>
      ${p ? `<button class="icon-btn" id="pfMenu" aria-label="${esc(t('top.more'))}" title="${esc(t('top.more'))}">${icon('M12 6h.01M12 12h.01M12 18h.01')}</button>` : ''}
    </div>
    <div class="top-right">
      ${p && p.source && p.source.file && (p.source.dates || []).length ? snapshotSelect(p) : p ? `<label class="valdate" title="${esc(t('top.valdateHelp'))}"><span>${esc(t('top.valdate'))}</span><input type="date" id="valDate" value="${esc(p.valDate || todayISO())}"></label>` : ''}
      ${p ? `
        <span class="base-chip" title="${esc(t('top.base'))}">${esc(p.baseCcy)}</span>` : ''}
      <button class="icon-btn" id="themeBtn" aria-label="${esc(t('top.theme'))}" title="${esc(t('top.theme'))}: ${esc(t('theme.' + (store.settings().theme || 'auto')))}">${icon(document.documentElement.dataset.resolvedTheme === 'dark' ? 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z' : 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.4-6.4l-.7.7M6.3 17.7l-.7.7m12.8 0l-.7-.7M6.3 6.3l-.7-.7M16 12a4 4 0 11-8 0 4 4 0 018 0z')}</button>
    </div>`;
  const $ = id => document.getElementById(id);
  $('menuBtn').onclick = () => setDrawer(!drawerOpen());
  $('pfSelect')?.addEventListener('change', e => store.setActive(e.target.value));
  $('pfNew').onclick = newPortfolioDialog;
  $('pfMenu')?.addEventListener('click', portfolioMenu);
  $('srcDate')?.addEventListener('change', e => { sources.setDate(p.id, e.target.value).catch(err => { console.error(err); toast(t('src.err.other', { err: err.message || '' }), { tone: 'warn' }); }); });
  $('valDate')?.addEventListener('change', e => {
    const v = e.target.value;
    store.update(pp => { pp.valDate = v === todayISO() ? '' : v; }, t('top.valdate'));
  });
  $('themeBtn').onclick = () => {
    const order = ['auto', 'light', 'dark'];
    const cur = store.settings().theme || 'auto';
    store.setSetting('theme', order[(order.indexOf(cur) + 1) % 3]);
  };
}

// A portfolio fed by the connected file picks a snapshot date from the file instead of a free date.
function snapshotSelect(p) {
  const dates = sources.datesFor(p).slice().reverse();
  const latest = dates[0] || p.source.shown || p.valDate;
  const opts = [['', t('src.latest', { d: latest || '—' })], ...dates.slice(1).map(d => [d, d])];
  return `<label class="valdate" title="${esc(t('src.dateHelp'))}"><span>${esc(t('src.date'))}</span>${selectHtml('id="srcDate"', opts, p.source.date || '')}</label>`;
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
    // With a writable source connected, the portfolio is a new value in its Portfolio column: rows
    // appear with the first holding.
    const p = store.addPortfolio(sources.attachNew(store.newPortfolio(f)));
    closeModal();
    app.navigate('holdings');
    toast(p.source ? t('pf.createdInSource', { name: p.source.fileName }) : t('pf.createdLocal'), { ms: 5000 });
  });
}

function portfolioMenu(e) {
  const p = store.active();
  const m = openModal(`<div class="modal-head"><h2>${esc(p.name)}</h2></div>
    <div class="modal-body menu-list">
      <button class="menu-item" data-act="rename">${esc(t('pf.rename'))}</button>
      <button class="menu-item" data-act="duplicate">${esc(t('pf.duplicate'))}</button>
      <button class="menu-item" data-act="export">${esc(t('pf.exportJson'))}</button>
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
      // A copy of a portfolio from a source is a new portfolio in a source: its own rows, its own name.
      copy.demo = false; copy.controlLog = []; delete copy.source;
      store.addPortfolio(copy);
      sources.adoptPortfolio(copy.id);
      toast(t('pf.duplicated'));
    } else if (act === 'export') {
      const { downloadBlob, slug } = await import('./util.js');
      downloadBlob(JSON.stringify({ app: 'nexus-portfolio-lab', portfolios: { [p.id]: p } }, null, 2), 'application/json', slug(p.name) + '.json');
    } else if (act === 'delete') {
      const inSource = sources.isSourced(p) && sources.canWrite(sources.connOf(p));
      if (await confirmDialog(t(inSource ? 'pf.deleteConfirmSource' : 'pf.deleteConfirm', { name: esc(p.name), source: esc(sources.sourceName(p)) }), { ok: t('common.delete'), danger: true })) {
        sources.removePortfolio(p.id);
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
  document.title = `${t('nav.' + ({ 'fixed-income': 'fi', 'global-exposure': 'globalExposure', 'liquidity-tools': 'lmt', 'control-log': 'controlLog' }[route] || route))} · Nexus Portfolio Lab`;
  renderSidebar();
  renderTopbar();
  renderBanner();
  if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { /* view already gone */ } }
  cleanup = null;
  purgeAll(main);
  const view = VIEWS[route];
  const p = store.active();
  main.dataset.route = route;
  try {
    // Until a data source is connected, every portfolio page is the setup page.
    // The mapper (a source whose layout needs mapping once) is the one portfolio page open before a source is connected.
    const mapping = route === 'import' && mappingPending();
    const gated = !sources.ready() && !OPEN_ROUTES.has(route) && !mapping;
    cleanup = (gated ? setupView : !p && !view.noPortfolio && !mapping ? dashboard : view).render(main, app);
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="card"><div class="card-body"><h2>${esc(t('err.view'))}</h2><pre class="err">${esc(err.stack || err.message)}</pre></div></div>`;
  }
  if (drawerOpen()) setDrawer(false);
}

// Several store changes in one tick (import, then select) render once, after the tick: Plotly
// throws if a plot is replaced while its first draw is still measuring margins.
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => { renderQueued = false; renderRoute(); });
}

// #/dashboard?demo=1 (the link to share): open the one-click demo straight away, then drop the
// parameter so a later reload or "Leave demo" does not bring it back.
async function openDemoFromLink() {
  const [path, query = ''] = location.hash.split('?');
  const params = new URLSearchParams(query);
  if (params.get('demo') !== '1') return;
  params.delete('demo');
  const rest = params.toString();
  window.history.replaceState(null, '', location.pathname + location.search + (path || '#/dashboard') + (rest ? '?' + rest : ''));
  await openDemo({ go: null });
}

async function init() {
  await store.init();
  applyTheme();
  store.subscribe(reason => {
    if (reason === 'settings') applyTheme();
    if (reason === 'storage_error') { toast(t('err.storage'), { tone: 'warn', ms: 8000 }); return; }
    if (['data', 'active', 'templates', 'log', 'issuers'].includes(reason)) filelink.markDirty();
    scheduleRender();
  });
  // The data sources decide what can be shown: until one is connected every portfolio page is the setup page.
  let wasReady = false;
  sources.onChange(() => { renderBanner(); if (document.querySelector('.sidebar-foot')) renderSidebar(); if (sources.ready() !== wasReady) { wasReady = sources.ready(); scheduleRender(); } });
  sources.init().then(openDemoFromLink).then(() => { wasReady = sources.ready(); renderRoute(); }).catch(err => { console.error(err); renderRoute(); });
  filelink.onChange(() => { renderBanner(); const sb = document.querySelector('.sidebar-foot'); if (sb) renderSidebar(); });
  // Only the sidebar and banner depend on the file status, so no second full render (Plotly
  // dislikes being re-run while its first draw is still settling).
  filelink.init().then(() => { renderSidebar(); renderBanner(); maybeAutoBackup(); }).catch(err => console.error(err));
  // ECB rates and curve published with the site; a local copy without the file just skips this.
  marketsync.init();
  window.addEventListener('hashchange', () => {
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
