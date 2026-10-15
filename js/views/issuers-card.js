// Settings → Issuers and LEIs: the issuer register. Every issuer and counterparty in the workspace's
// holdings, with the LEI the holdings carry and the one entered here. The register is used wherever a
// holding has no LEI of its own (the TPT's fields 47/48). Import and export as CSV (Issuer;LEI).
import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, toast } from '../ui.js';
import { isLei } from '../instruments.js';
import { toCSV } from '../importer.js';
import { parseIssuerCsv } from '../issuers.js';
import { downloadBlob, todayISO } from '../util.js';
import * as leisync from '../leisync.js';

const MAX_ROWS = 500;

// [{ key, name, n, held: Set of LEIs the holdings carry, gleif: Set found for their ISINs, lei: register LEI }]
export function issuerRows() {
  const m = new Map();
  const gl = store.isinLei().map;
  const row = name => { const k = store.issuerKey(name); if (!m.has(k)) m.set(k, { key: k, name: String(name).trim(), n: 0, held: new Set(), gleif: new Set(), lei: '' }); return m.get(k); };
  for (const p of store.listPortfolios()) for (const pos of p.positions || []) {
    if (!String(pos.issuer || '').trim()) continue;
    const r = row(pos.issuer);
    r.n++;
    if (pos.issuerLei) r.held.add(String(pos.issuerLei).toUpperCase());
    else if (pos.isin) { const g = gl[String(pos.isin).toUpperCase()]; if (g) r.gleif.add(g); }
  }
  for (const [k, x] of Object.entries(store.issuers())) { const r = m.get(k) || row(x.name || k); r.lei = x.lei || ''; }
  // Invalid first, then missing, then the rest: what needs fixing sits at the top.
  const rank = r => { const lei = best(r); return !lei ? 1 : isLei(lei) ? 0 : 2; };
  return [...m.values()].sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
}

const best = r => r.lei || [...r.held][0] || [...r.gleif][0] || '';
const chip = r => {
  const lei = best(r);
  if (!lei) return `<span class="chip chip-warn">${esc(t('iss.none'))}</span>`;
  if (!isLei(lei)) return `<span class="chip chip-breach">✕ ${esc(t('iss.invalid'))}</span>`;
  if (r.lei && r.held.size && ![...r.held].every(x => x === r.lei)) return `<span class="chip chip-warn">${esc(t('iss.differs'))}</span>`;
  if (!r.lei && !r.held.size) return `<span class="chip chip-ok" title="${esc(t('iss.gleifTitle'))}">✓ GLEIF</span>`;
  return `<span class="chip chip-ok">✓</span>`;
};

function bodyHtml() {
  const rows = issuerRows();
  const missing = rows.filter(r => !best(r)).length;
  const st = leisync.getStatus(), cache = store.isinLei();
  const auto = leisync.enabled();
  const gleifLine = !auto ? t('iss.gleifOff') : st.state === 'unavailable' ? t('iss.gleifNone') : st.state === 'running' ? t('iss.gleifRunning') : st.state === 'error' ? t('iss.gleifError', { err: st.error }) : t('iss.gleifDone', { d: cache.date || st.date || '—', n: Object.values(cache.map).filter(Boolean).length });
  return `
    <p class="muted small">${esc(t('iss.body'))}</p>
    <div class="toolbar wrap"><label class="check"><input type="checkbox" id="leiAuto" ${auto ? 'checked' : ''}> <span>${esc(t('iss.gleifAuto'))}</span></label><button class="btn btn-sm" data-iss="gleif" ${auto ? '' : 'disabled'}>${esc(t('iss.gleifNow'))}</button></div>
    <p class="small muted">${esc(gleifLine)}</p>
    <p class="small">${esc(t('iss.summary', { n: rows.length, m: missing }))}</p>
    ${rows.length ? `<div class="table-wrap"><table class="tbl dense">
      <thead><tr><th>${esc(t('iss.issuer'))}</th><th class="num">${esc(t('iss.holdings'))}</th><th>${esc(t('iss.inHoldings'))}</th><th>${esc(t('iss.lei'))}</th><th></th></tr></thead>
      <tbody>${rows.slice(0, MAX_ROWS).map(r => `<tr>
        <td>${esc(r.name)}</td><td class="num">${r.n}</td>
        <td class="small mono">${esc([...r.held].join(', ') || '')}${r.gleif.size && !r.held.size ? `<span title="${esc(t('iss.gleifTitle'))}">${esc(r.gleif.size === 1 ? [...r.gleif][0] : t('iss.gleifMany', { n: r.gleif.size }))} <span class="muted">(GLEIF)</span></span>` : ''}${!r.held.size && !r.gleif.size ? '—' : ''}</td>
        <td><input data-lei="${esc(r.name)}" value="${esc(r.lei)}" maxlength="20" class="upper mono" placeholder="${esc(r.held.size || r.gleif.size ? t('iss.fromHoldings') : t('iss.ph'))}" aria-label="${esc(t('iss.lei') + ' ' + r.name)}" autocomplete="off" spellcheck="false"></td>
        <td>${chip(r)}</td></tr>`).join('')}</tbody></table></div>
      ${rows.length > MAX_ROWS ? `<p class="muted small">${esc(t('iss.capped', { n: MAX_ROWS }))}</p>` : ''}` : `<p class="muted small">${esc(t('iss.empty'))}</p>`}
    <div class="btn-row">
      <button class="btn btn-sm" data-iss="export">${esc(t('iss.export'))}</button>
      <button class="btn btn-sm" data-iss="import">${esc(t('iss.import'))}</button>
      <input type="file" id="issFile" accept=".csv,.txt,.tsv" hidden>
    </div>`;
}

export const issuersCardHtml = () => card(t('iss.title'), bodyHtml(), { sub: esc(t('iss.sub')), id: 'issuersCard' });

export function bindIssuersCard(root) {
  const el = () => root.querySelector('#issuersCard');
  const redraw = () => { const b = el()?.querySelector('.card-body'); if (b) b.innerHTML = bodyHtml(); };
  const off = store.subscribe(r => { if (r === 'issuers') redraw(); });
  const offSync = leisync.onStatus(redraw);
  const onChange = async e => {
    const inp = e.target.closest('[data-lei]');
    if (inp) {
      const v = inp.value.replace(/\s/g, '').toUpperCase();
      if (v && !isLei(v)) toast(t('iss.invalidToast', { lei: v }), { tone: 'warn' });
      store.setIssuer(inp.dataset.lei, { lei: v });
      return;
    }
    if (e.target.id === 'leiAuto') { store.setSetting('leiAuto', e.target.checked); if (e.target.checked) leisync.sync(); return; }
    if (e.target.id === 'issFile') {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const list = parseIssuerCsv(await f.text());
        let bad = 0;
        for (const x of list) { if (x.lei && !isLei(x.lei)) bad++; store.setIssuer(x.name, { lei: x.lei }); }
        toast(t('iss.imported', { n: list.length }) + (bad ? ' ' + t('iss.importedBad', { n: bad }) : ''), { tone: bad ? 'warn' : '' });
      } catch (err) { console.error(err); toast(t('imp.readError'), { tone: 'warn' }); }
    }
  };
  const onClick = e => {
    const act = e.target.closest('[data-iss]')?.dataset.iss;
    if (act === 'import') el()?.querySelector('#issFile').click();
    if (act === 'gleif') leisync.sync({ force: true }).then(res => toast(res ? t('iss.gleifFound', { n: Object.keys(res.found).length, m: res.missing.length }) : t(leisync.getStatus().state === 'unavailable' ? 'iss.gleifNone' : 'iss.gleifUpToDate')));
    if (act === 'export') {
      const rows = issuerRows().map(r => [r.name, best(r)]);
      downloadBlob('﻿' + toCSV([['Issuer', 'LEI'], ...rows], ';'), 'text/csv;charset=utf-8', `issuers-lei-${todayISO()}.csv`);
    }
  };
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  if (new URLSearchParams(location.hash.split('?')[1] || '').get('s') === 'issuers') requestAnimationFrame(() => el()?.scrollIntoView({ block: 'start' }));
  return () => { off(); offSync(); root.removeEventListener('change', onChange); root.removeEventListener('click', onClick); };
}
