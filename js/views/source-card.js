// The "Data sources" card, shown on the setup page, the Bulk upload page and in Settings: every
// connected file and API, what it feeds, whether changes are reaching it, and the buttons to add,
// fix or remove one. The connections themselves live in js/sources.js.
import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, toast, confirmDialog, fmtDate, privacyCallout, openModal, closeModal, selectHtml } from '../ui.js';
import * as sources from '../sources.js';
import * as filelink from '../filelink.js';
import { API_FORMATS, WRITE_METHODS } from '../connectors.js';

const ERRS = ['no_date', 'no_header', 'no_fields', 'no_rows', 'same_file', 'permission', 'not_found', 'unsupported', 'kind', 'network', 'auth', 'http', 'conflict', 'bad_url', 'read_only_format', 'no_records'];
export const errorText = (code, status = 0) => t('src.err.' + (ERRS.includes(code) ? code : 'other'), { err: code, status });
const time = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function statusLine(s) {
  const st = s.status;
  if (st.state === 'init') return t('src.checking');
  if (st.state === 'needs-permission') return t('src.needsPermission');
  if (st.state === 'error' || st.error) return errorText(st.error, st.status);
  return t('src.status', { t: st.lastRead ? time(st.lastRead) : '—', p: st.portfolios, d: st.dates });
}
function writeLine(s) {
  const st = s.status;
  if (s.access === 'read') return `<div class="cell-sub">${esc(t(st.localEdits ? 'src.readOnlyEdits' : 'src.readOnlyNote'))}</div>`;
  if (st.write === 'blocked') return `<div class="cell-sub warn-text">${esc(t('src.writeBlocked', { n: st.queued, err: st.writeError }))}</div>`;
  if (st.write === 'pending' || st.write === 'writing') return `<div class="cell-sub">${esc(t('src.writing'))}</div>`;
  return st.lastWrite ? `<div class="cell-sub">${esc(t('src.writtenAt', { t: time(st.lastWrite) }))}</div>` : '';
}
const kindPill = s => `<span class="type-pill">${esc(s.kind === 'api' ? 'API' : (/\.([a-z0-9]+)$/i.exec(s.name)?.[1] || 'file').toUpperCase())}</span> <span class="type-pill">${esc(t(s.access === 'read' ? 'src.readOnly' : 'src.readWrite'))}</span>`;

function sourceHtml(s) {
  const st = s.status;
  const pfs = sources.sourced(s.id);
  const bad = st.state !== 'linked' || st.error || st.write === 'blocked';
  return `<div class="file-status ${bad ? (st.state === 'needs-permission' ? 'needs-permission' : 'error') : 'linked'}">
      <div><strong>${esc(s.name)}</strong> ${kindPill(s)}
        ${s.kind === 'api' ? `<div class="cell-sub">${esc(s.url)}</div>` : ''}
        <div class="cell-sub">${esc(statusLine(s))}</div>
        ${st.state === 'linked' ? writeLine(s) : ''}
        ${st.template ? `<div class="cell-sub">${esc(t('src.template', { name: st.template }))}</div>` : ''}
        ${st.history ? `<div class="cell-sub">${esc(t('src.historySheet'))}</div>` : ''}
        ${st.skipped ? `<div class="cell-sub">${esc(t('src.skipped', { n: st.skipped }))}</div>` : ''}
      </div>
      <div class="btn-row">
        ${st.state === 'needs-permission' ? `<button class="btn btn-sm btn-primary" data-src="reconnect" data-id="${esc(s.id)}">${esc(t('src.reconnect'))}</button>` : `<button class="btn btn-sm" data-src="refresh" data-id="${esc(s.id)}">${esc(t('src.refresh'))}</button>`}
        ${st.write === 'blocked' ? `<button class="btn btn-sm" data-src="flush" data-id="${esc(s.id)}">${esc(t('src.retry'))}</button><button class="btn btn-sm" data-src="discard" data-id="${esc(s.id)}">${esc(t('src.discard'))}</button>` : ''}
        ${s.kind === 'api' ? `<button class="btn btn-sm" data-src="edit" data-id="${esc(s.id)}">${esc(t('src.edit'))}</button>` : ''}
        <button class="btn btn-sm" data-src="disconnect" data-id="${esc(s.id)}">${esc(t('src.disconnect'))}</button>
        <button class="btn btn-sm btn-danger" data-src="remove" data-id="${esc(s.id)}">${esc(t('src.remove'))}</button>
      </div>
    </div>
    ${pfs.length ? `<ul class="tpl-list">${pfs.map(p => `<li>
        <div><strong>${esc(p.name)}</strong><div class="small muted">${esc((p.source.dates || []).length ? t('src.pfLine', { n: p.positions.length, d: fmtDate(p.source.shown || p.valDate), k: (p.source.dates || []).length }) : t('src.pfNew'))}${p.source.date ? ' · ' + esc(t('src.pinned')) : ''}${p.source.missing ? ' · ' + esc(t('src.missing')) : ''}</div></div>
        <div class="row-actions">${store.active()?.id === p.id ? `<span class="chip chip-ok">${esc(t('src.active'))}</span>` : `<button class="btn btn-sm" data-src-open="${esc(p.id)}">${esc(t('src.open'))}</button>`}</div>
      </li>`).join('')}</ul>` : ''}`;
}

function bodyHtml({ steps = true } = {}) {
  const all = sources.list();
  const linked = all.some(s => s.status.state === 'linked');
  const local = linked ? store.listPortfolios().filter(p => !sources.isSourced(p)) : [];
  const targets = sources.writableSources();
  const mode = store.settings().srcWriteMode || 'inplace';
  const def = sources.defaultTarget();
  return `
    ${privacyCallout(t('src.privacy'))}
    ${all.map(sourceHtml).join('')}
    ${local.length && targets.length ? `<p class="muted small">${esc(t('src.localPortfolios'))}</p><ul class="tpl-list">${local.map(p => `<li>
        <div><strong>${esc(p.name)}</strong><div class="small muted">${esc(t('src.localLine', { n: p.positions.length }))}</div></div>
        <div class="row-actions"><button class="btn btn-sm" data-src-adopt="${esc(p.id)}">${esc(t('src.adopt', { name: targets.find(x => x.id === def)?.name || targets[0].name }))}</button></div>
      </li>`).join('')}</ul>` : ''}
    ${targets.length ? `<div class="toolbar wrap settings-strip"><span>${esc(t('src.writeMode'))}</span>
      <div class="seg" role="radiogroup">${sources.WRITE_MODES.map(m => `<button type="button" role="radio" class="${mode === m ? 'on' : ''}" data-src-mode="${m}" aria-checked="${mode === m}">${esc(t('src.mode.' + m))}</button>`).join('')}</div></div>
      <p class="muted small">${esc(t('src.modeHelp.' + mode))}</p>
      ${targets.length > 1 ? `<label class="inline">${esc(t('src.defaultTarget'))} ${selectHtml('id="srcDefault"', targets.map(x => [x.id, x.name]), def)}</label><p class="muted small">${esc(t('src.defaultTargetHelp'))}</p>` : ''}` : ''}
    ${steps ? `<p class="muted small">${esc(t('src.body'))}</p>
    <ol class="steps">
      <li><strong>${esc(t('src.step1'))}</strong><span>${esc(t('src.step1b'))}</span></li>
      <li><strong>${esc(t('src.step2'))}</strong><span>${esc(t('src.step2b'))}</span></li>
      <li><strong>${esc(t('src.step3'))}</strong><span>${esc(t('src.step3b'))}</span></li>
    </ol>` : ''}
    ${sources.fileSupported() ? '' : `<div class="alert alert-warn"><span>${esc(t('src.unsupported'))}</span></div>`}
    <div class="btn-row">
      ${sources.fileSupported() ? `<button class="btn ${all.length ? '' : 'btn-primary btn-lg'}" data-src="connect-file">${esc(all.length ? t('src.addFile') : t('src.connect'))}</button>` : ''}
      <button class="btn ${all.length || sources.fileSupported() ? '' : 'btn-primary btn-lg'}" data-src="connect-api">${esc(all.length ? t('src.addApi') : t('src.connectApi'))}</button>
    </div>
    <p class="muted small">${esc(t('src.formats'))}</p>`;
}

export function sourceCardHtml(opts = {}) {
  return card(t('src.title'), bodyHtml(opts), { sub: esc(t('src.sub')), id: 'srcCard' });
}

export async function connectFlow() {
  try {
    const fs = filelink.getStatus();
    const r = await sources.connectFile({ sameAs: fs.state !== 'none' && fs.state !== 'unsupported' ? [filelink.handle()] : [] });
    toast(t(r.portfolios ? 'src.connected' : 'src.connectedEmpty', { name: sources.get(r.id)?.name || '', p: r.portfolios, d: r.dates }) + (r.access === 'read' ? ' ' + t('src.connectedReadOnly') : ''), { ms: 6000 });
    return true;
  } catch (err) {
    if (err && err.name === 'AbortError') return false; // picker closed
    if (await openMapper(err)) return false; // read fine, layout to be mapped: not an error
    console.error(err);
    toast(errorText(err.code || err.message, err.status), { tone: 'warn', ms: 9000 });
    return false;
  }
}

// A source that was read but whose layout was not recognised goes to the mapper (the bulk-upload
// page in mapping mode): map it once, save the template, and it connects. Loaded on demand, since
// the import page itself uses this card.
async function openMapper(err) {
  if (!err?.mapping) return false;
  const { startMapping } = await import('./import.js');
  startMapping(err.mapping);
  toast(t('map.needed', { name: err.mapping.name }), { ms: 7000 });
  if (location.hash === '#/import') window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = '#/import';
  return true;
}

// The API form: address, format, headers (an API key or token), polling, and how to write back.
export function apiDialog(id = null) {
  const cur = id ? sources.get(id) : null;
  const headers = cur?.headers?.length ? cur.headers : [['', '']];
  const row = ([k, v], i) => `<div class="form-row"><input name="hk${i}" placeholder="${esc(t('api.headerName'))}" value="${esc(k)}"><input name="hv${i}" placeholder="${esc(t('api.headerValue'))}" value="${esc(v)}" autocomplete="off"></div>`;
  const m = openModal(`<div class="modal-head"><h2>${esc(t(cur ? 'api.editTitle' : 'api.title'))}</h2></div>
    <form class="modal-body form-grid" id="apiForm">
      <p class="muted small span-2">${esc(t('api.intro'))}</p>
      <label class="span-2">${esc(t('api.url'))}<input name="url" type="url" required placeholder="https://pms.example.internal/api/holdings" value="${esc(cur?.url || '')}"></label>
      <label>${esc(t('api.name'))}<input name="name" value="${esc(cur?.name || '')}" placeholder="${esc(t('api.namePh'))}"></label>
      <label>${esc(t('api.format'))}${selectHtml('name="format"', API_FORMATS.map(f => [f, t('api.format.' + f)]), cur?.format || 'auto')}</label>
      <label>${esc(t('api.poll'))}<input name="pollSec" type="number" min="15" step="5" value="${esc(String(cur?.pollSec || 60))}"></label>
      <label>${esc(t('api.write'))}${selectHtml('name="writeMethod"', WRITE_METHODS.map(w => [w, t('api.write.' + w)]), cur?.writeMethod || 'none')}</label>
      <label class="span-2">${esc(t('api.writeUrl'))}<input name="writeUrl" type="url" placeholder="${esc(t('api.writeUrlPh'))}" value="${esc(cur?.writeUrl || '')}"></label>
      <fieldset class="span-2"><legend>${esc(t('api.headers'))}</legend><div id="apiHeaders">${headers.map(row).join('')}</div>
        <button type="button" class="btn btn-sm" id="apiAddHeader">${esc(t('api.addHeader'))}</button>
        <p class="muted small">${esc(t('api.headersHelp'))}</p></fieldset>
      <label class="check span-2"><input type="checkbox" name="withCredentials" ${cur?.withCredentials ? 'checked' : ''}> <span>${esc(t('api.cookies'))}</span></label>
      <p class="muted small span-2">${esc(t('api.contract'))}</p>
    </form>
    <div class="modal-foot"><button class="btn" data-close>${esc(t('common.cancel'))}</button><button class="btn btn-primary" form="apiForm" type="submit">${esc(t(cur ? 'common.save' : 'api.connect'))}</button></div>`, { wide: true });
  let n = headers.length;
  m.querySelector('#apiAddHeader').addEventListener('click', () => { m.querySelector('#apiHeaders').insertAdjacentHTML('beforeend', row(['', ''], n++)); });
  m.querySelector('#apiForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const cfg = { url: f.url, name: f.name, format: f.format, pollSec: +f.pollSec, writeMethod: f.writeMethod, writeUrl: f.writeUrl, withCredentials: f.withCredentials === 'on', headers: [] };
    for (let i = 0; i < n; i++) if (String(f['hk' + i] || '').trim()) cfg.headers.push([f['hk' + i].trim(), f['hv' + i] ?? '']);
    const btn = m.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (cur) { await sources.updateApi(id, cfg); toast(t('api.saved')); }
      else { const r = await sources.connectApi(cfg); toast(t(r.portfolios ? 'src.connected' : 'src.connectedEmpty', { name: sources.get(r.id)?.name || '', p: r.portfolios, d: r.dates }) + (r.access === 'read' ? ' ' + t('src.connectedReadOnly') : ''), { ms: 6000 }); }
      closeModal();
    } catch (err) {
      if (await openMapper(err)) { closeModal(); return; }
      console.error(err);
      btn.disabled = false;
      toast(errorText(err.code || err.message, err.status), { tone: 'warn', ms: 9000 });
    }
  });
}

// Take a source out of the app, with its portfolios; their control logs go to the archive.
export async function removeFlow(id) {
  const s = sources.get(id);
  if (!s) return false;
  const n = sources.sourced(id).length, q = sources.queued(id);
  if (!await confirmDialog(t('src.removeConfirm', { name: esc(s.name), n }) + (q ? ' ' + t('src.removePending', { n: q }) : ''), { danger: true, ok: t('src.remove') })) return false;
  if (q) await sources.flush(id);
  const removed = await sources.removeSource(id);
  toast(t('src.removed', { n: removed }), { ms: 6000 });
  return true;
}

// Wire the card inside `root`; returns a cleanup for the view.
export function bindSourceCard(root, opts = {}) {
  const redraw = () => { const body = root.querySelector('#srcCard .card-body'); if (body) body.innerHTML = bodyHtml(opts); };
  const off = sources.onChange(redraw);
  const offStore = store.subscribe(r => { if (r === 'active' || r === 'settings') redraw(); });
  const onChange = e => { if (e.target.id === 'srcDefault') store.setSetting('srcDefault', e.target.value); };
  const onClick = async e => {
    const open = e.target.closest('[data-src-open]')?.dataset.srcOpen;
    if (open) { store.setActive(open); return; }
    const adopt = e.target.closest('[data-src-adopt]')?.dataset.srcAdopt;
    if (adopt) { if (sources.adoptPortfolio(adopt)) toast(t('src.adopted')); redraw(); return; }
    const mode = e.target.closest('[data-src-mode]')?.dataset.srcMode;
    if (mode) { store.setSetting('srcWriteMode', mode); return; }
    const b = e.target.closest('[data-src]');
    if (!b) return;
    const act = b.dataset.src, id = b.dataset.id;
    e.stopPropagation();
    try {
      if (act === 'connect-file') await connectFlow();
      if (act === 'connect-api') apiDialog();
      if (act === 'edit') apiDialog(id);
      if (act === 'refresh') { await sources.refresh(id, { force: true }); const st = sources.get(id)?.status; toast(st?.error ? errorText(st.error, st.status) : t('src.refreshed'), { tone: st?.error ? 'warn' : '' }); }
      if (act === 'flush' && !(await sources.flush(id))) toast(t('src.writeBlockedShort', { n: sources.queued(id) }), { tone: 'warn' });
      if (act === 'discard' && await confirmDialog(t('src.discardConfirm', { n: sources.queued(id) }), { danger: true, ok: t('src.discard') })) await sources.discardPending(id);
      if (act === 'reconnect') await sources.reconnect(id);
      if (act === 'disconnect' && await confirmDialog(t('src.disconnectConfirm') + (sources.queued(id) ? ' ' + t('src.removePending', { n: sources.queued(id) }) : ''))) { await sources.disconnect(id); toast(t('src.disconnected')); }
      if (act === 'remove') await removeFlow(id);
    } catch (err) { console.error(err); toast(errorText(err.code || err.message, err.status), { tone: 'warn' }); }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  return () => { off(); offStore(); root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); };
}
