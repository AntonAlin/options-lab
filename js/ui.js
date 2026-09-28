// Tiny UI toolkit: formatting, KPI tiles, tables, modals, toasts. Plain template strings; the
// views wire events with delegation so re-rendering is just innerHTML.
import { t, L, locale, lang } from './i18n.js';
import { escapeHtml, isNum } from './util.js';

export { escapeHtml as esc };
const esc = escapeHtml;

// ---- number formatting ---------------------------------------------------------------------------
const nf = new Map();
function numberFormat(opts) {
  const k = locale() + JSON.stringify(opts);
  if (!nf.has(k)) nf.set(k, new Intl.NumberFormat(locale(), opts));
  return nf.get(k);
}
export function fmtNum(x, d = 0) {
  if (!isNum(x)) return '—';
  return numberFormat({ minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
}
// 1 234 567 → "1.23m" / "1,23 mn" — for tiles and axis-ish places.
export function fmtCompact(x, d = 1) {
  if (!isNum(x)) return '—';
  const a = Math.abs(x);
  const sv = lang() === 'sv';
  const units = sv ? [[1e9, ' mdr'], [1e6, ' mn'], [1e3, ' tn']] : [[1e9, 'bn'], [1e6, 'm'], [1e3, 'k']];
  for (const [v, u] of units) if (a >= v) return fmtNum(x / v, d) + u;
  return fmtNum(x, a < 10 ? 2 : 0);
}
export function fmtMoney(x, ccy = '', { compact = false, d = 0 } = {}) {
  if (!isNum(x)) return '—';
  const s = compact ? fmtCompact(x) : fmtNum(x, d);
  return ccy ? `${s} ${ccy}` : s;
}
export function fmtPct(x, d = 1, { sign = false } = {}) {
  if (!isNum(x)) return '—';
  const s = fmtNum(x * 100, d) + (lang() === 'sv' ? ' %' : '%');
  return sign && x > 0 ? '+' + s : s;
}
export function fmtSigned(x, d = 0) { return isNum(x) ? (x > 0 ? '+' : '') + fmtNum(x, d) : '—'; }
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00Z');
  return isNaN(d) ? iso : d.toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export const signCls = x => (!isNum(x) || Math.abs(x) < 1e-12 ? '' : x > 0 ? 'pos' : 'neg');

// ---- building blocks -------------------------------------------------------------------------------
export function kpi(label, value, { sub = '', tone = '', help = '', id = '' } = {}) {
  return `<div class="kpi ${tone ? 'kpi-' + tone : ''}" ${id ? `id="${id}"` : ''}>
    <div class="kpi-label">${esc(label)}${help ? ` <span class="help" tabindex="0" data-tip="${esc(help)}">?</span>` : ''}</div>
    <div class="kpi-value">${value}</div>
    ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
  </div>`;
}

export function card(title, body, { actions = '', sub = '', cls = '', id = '' } = {}) {
  return `<section class="card ${cls}" ${id ? `id="${id}"` : ''}>
    ${title ? `<header class="card-head"><div><h2>${esc(title)}</h2>${sub ? `<p class="card-sub">${sub}</p>` : ''}</div>${actions ? `<div class="card-actions">${actions}</div>` : ''}</header>` : ''}
    <div class="card-body">${body}</div>
  </section>`;
}

export function pageHead(title, sub = '', actions = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}

export function empty(msg, action = '') {
  return `<div class="empty"><p>${msg}</p>${action}</div>`;
}

// cols: [{ key, label, align, fmt(row) → html, sort(row) → value, cls }]
export function table(cols, rows, { id = '', foot = null, sortKey = null, sortDir = -1, dense = false, rowAttr = null, maxRows = 0 } = {}) {
  const shown = maxRows ? rows.slice(0, maxRows) : rows;
  return `<div class="table-wrap"><table class="tbl ${dense ? 'dense' : ''}" ${id ? `id="${id}"` : ''}>
    <thead><tr>${cols.map(c => `<th class="${c.align === 'right' ? 'r' : ''} ${c.sort ? 'sortable' : ''} ${sortKey === c.key ? 'sorted' : ''}" ${c.sort ? `data-sort="${c.key}"` : ''} scope="col">${esc(c.label)}${sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody>${shown.map(r => `<tr ${rowAttr ? rowAttr(r) : ''}>${cols.map(c => `<td class="${c.align === 'right' ? 'r num' : ''} ${c.cls ? (typeof c.cls === 'function' ? c.cls(r) : c.cls) : ''}">${c.fmt ? c.fmt(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody>
    ${foot ? `<tfoot><tr>${foot.map((f, i) => `<td class="${cols[i]?.align === 'right' ? 'r num' : ''}">${f ?? ''}</td>`).join('')}</tr></tfoot>` : ''}
  </table></div>`;
}

export function statusChip(status) {
  const map = { ok: ['ok', '✓', t('status.ok')], warn: ['warn', '!', t('status.warn')], breach: ['breach', '✕', t('status.breach')] };
  const [cls, icon, label] = map[status] || map.ok;
  return `<span class="chip chip-${cls}"><span aria-hidden="true">${icon}</span> ${esc(label)}</span>`;
}

export function segmented(name, options, value) {
  return `<div class="seg" role="radiogroup">${options.map(([v, label]) => `<button type="button" role="radio" aria-checked="${String(v) === String(value)}" class="${String(v) === String(value) ? 'on' : ''}" data-seg="${name}" data-value="${esc(v)}">${esc(label)}</button>`).join('')}</div>`;
}

export function selectHtml(attrs, options, value) {
  return `<select ${attrs}>${options.map(([v, label]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
}

// ---- modal ------------------------------------------------------------------------------------------
let modalEl = null;
export function openModal(html, { wide = false, onClose = null } = {}) {
  closeModal();
  modalEl = document.createElement('div');
  modalEl.className = 'modal-bg';
  modalEl.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(modalEl);
  const prev = document.activeElement;
  modalEl.addEventListener('mousedown', e => { if (e.target === modalEl) closeModal(); });
  modalEl.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
  modalEl._onClose = () => { onClose?.(); prev?.focus?.(); };
  setTimeout(() => modalEl?.querySelector('input:not([type=hidden]),select,textarea,button')?.focus(), 30);
  return modalEl.querySelector('.modal');
}
export function closeModal() {
  if (!modalEl) return;
  const m = modalEl;
  modalEl = null;
  m.remove();
  m._onClose?.();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalEl) closeModal(); });

export function confirmDialog(message, { ok = t('common.ok'), danger = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal(`<div class="modal-body"><p>${message}</p></div>
      <div class="modal-foot"><button class="btn" data-close>${esc(t('common.cancel'))}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(ok)}</button></div>`,
      { onClose: () => { if (!done) resolve(false); } });
    m.querySelector('[data-ok]').addEventListener('click', () => { done = true; closeModal(); resolve(true); });
  });
}

let toastTimer;
export function toast(msg, { action = null, actionLabel = '', ms = 3500, tone = '' } = {}) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.className = 'toast show ' + tone;
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn">${esc(actionLabel)}</button>` : ''}`;
  if (action) el.querySelector('.toast-btn').onclick = () => { action(); el.classList.remove('show'); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? Math.max(ms, 6000) : ms);
}

export { t, L };
