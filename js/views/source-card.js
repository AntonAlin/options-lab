// The "connected file" card, shown on the Bulk upload page and in Settings. The file is read, never
// written; see js/sourcefile.js.
import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, toast, confirmDialog, fmtDate, privacyCallout } from '../ui.js';
import * as source from '../sourcefile.js';
import * as filelink from '../filelink.js';

export const errorText = code => t('src.err.' + (['no_date', 'no_header', 'no_fields', 'no_rows', 'same_file', 'permission', 'not_found', 'unsupported'].includes(code) ? code : 'other'), { err: code });

function bodyHtml() {
  const s = source.getStatus();
  if (s.state === 'unsupported') return `${privacyCallout(t('src.privacy'))}<div class="alert alert-warn"><span>${esc(t('src.unsupported'))}</span></div>`;
  const on = s.state !== 'none';
  const time = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const pfs = source.sourced();
  return `
    ${privacyCallout(t('src.privacy'))}
    ${on ? `<div class="file-status ${s.state === 'linked' && !s.error ? 'linked' : s.state === 'linked' ? 'error' : s.state}">
        <div><strong>${esc(s.name)}</strong> <span class="type-pill">${esc(t('src.readOnly'))}</span>
          <div class="cell-sub">${esc(s.state === 'needs-permission' ? t('src.needsPermission') : s.state === 'error' || s.error ? errorText(s.error) : t('src.status', { t: s.lastRead ? time(s.lastRead) : '—', p: s.portfolios, d: s.dates }))}</div>
          ${s.template ? `<div class="cell-sub">${esc(t('src.template', { name: s.template }))}</div>` : ''}
          ${s.skipped ? `<div class="cell-sub">${esc(t('src.skipped', { n: s.skipped }))}</div>` : ''}
        </div>
        <div class="btn-row">
          ${s.state === 'needs-permission' ? `<button class="btn btn-sm btn-primary" data-src="reconnect">${esc(t('src.reconnect'))}</button>` : `<button class="btn btn-sm" data-src="refresh">${esc(t('src.refresh'))}</button>`}
          <button class="btn btn-sm" data-src="disconnect">${esc(t('src.disconnect'))}</button>
        </div>
      </div>
      ${pfs.length ? `<ul class="tpl-list">${pfs.map(p => `<li>
          <div><strong>${esc(p.name)}</strong><div class="small muted">${esc(t('src.pfLine', { n: p.positions.length, d: fmtDate(p.source.shown || p.valDate), k: (p.source.dates || []).length }))}${p.source.date ? ' · ' + esc(t('src.pinned')) : ''}${p.source.missing ? ' · ' + esc(t('src.missing')) : ''}</div></div>
          <div class="row-actions">${store.active()?.id === p.id ? `<span class="chip chip-ok">${esc(t('src.active'))}</span>` : `<button class="btn btn-sm" data-src-open="${esc(p.id)}">${esc(t('src.open'))}</button>`}</div>
        </li>`).join('')}</ul>` : ''}` : ''}
    <p class="muted small">${esc(t('src.body'))}</p>
    <ol class="steps">
      <li><strong>${esc(t('src.step1'))}</strong><span>${esc(t('src.step1b'))}</span></li>
      <li><strong>${esc(t('src.step2'))}</strong><span>${esc(t('src.step2b'))}</span></li>
      <li><strong>${esc(t('src.step3'))}</strong><span>${esc(t('src.step3b'))}</span></li>
    </ol>
    <div class="btn-row"><button class="btn ${on ? '' : 'btn-primary'}" data-src="connect">${esc(on ? t('src.connectOther') : t('src.connect'))}</button></div>`;
}

export function sourceCardHtml() {
  return card(t('src.title'), bodyHtml(), { sub: esc(t('src.sub')), id: 'srcCard' });
}

export async function connectFlow() {
  try {
    const fs = filelink.getStatus();
    const r = await source.connect({ sameAs: fs.state !== 'none' && fs.kind !== 'json' ? filelink.handle() : null });
    toast(t('src.connected', { name: source.getStatus().name, p: r.portfolios, d: r.dates }), { ms: 5000 });
    return true;
  } catch (err) {
    if (err && err.name === 'AbortError') return false; // picker closed
    console.error(err);
    toast(errorText(err.code || err.message), { tone: 'warn', ms: 9000 });
    return false;
  }
}

// Wire the card inside `root`; returns a cleanup for the view.
export function bindSourceCard(root) {
  const off = source.onChange(() => { const body = root.querySelector('#srcCard .card-body'); if (body) body.innerHTML = bodyHtml(); });
  const onClick = async e => {
    const open = e.target.closest('[data-src-open]')?.dataset.srcOpen;
    if (open) { store.setActive(open); return; }
    const act = e.target.closest('[data-src]')?.dataset.src;
    if (!act) return;
    e.stopPropagation();
    try {
      if (act === 'connect') await connectFlow();
      if (act === 'refresh') { await source.refresh({ force: true }); toast(source.getStatus().error ? errorText(source.getStatus().error) : t('src.refreshed'), { tone: source.getStatus().error ? 'warn' : '' }); }
      if (act === 'reconnect') await source.reconnect();
      if (act === 'disconnect' && await confirmDialog(t('src.disconnectConfirm'))) { await source.disconnect(); toast(t('src.disconnected')); }
    } catch (err) { console.error(err); toast(t('src.err.other', { err: err.message || '' }), { tone: 'warn' }); }
  };
  root.addEventListener('click', onClick);
  return () => { off(); root.removeEventListener('click', onClick); };
}
