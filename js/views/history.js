import * as store from '../store.js';
import { t, lang } from '../i18n.js';
import { esc, card, pageHead, table, toast, selectHtml, fmtNum, fmtPct, fmtDate, empty, confirmDialog } from '../ui.js';
import { readFile, parseHistory, mergeHistory, parseText, toCSV } from '../importer.js';
import { seriesKeyFor } from '../analytics.js';
import { typeLabel } from '../instruments.js';
import { downloadBlob, loadScript, slug, isNum } from '../util.js';

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const h = p.history || { dates: [], series: {} };
    const keys = Object.keys(h.series);
    const hp = a.risk.hp;
    const matchable = a.v.valid.filter(x => !['cash', 'fx_forward', 'irs', 'cds'].includes(x.pos.type));
    const usedBy = new Map();
    matchable.forEach(x => { const k = seriesKeyFor(x.pos, h); if (k) (usedBy.get(k) || usedBy.set(k, []).get(k)).push(x.name); });
    const fxKeys = new Set([...new Set(a.v.valid.map(x => x.pos.ccy).filter(c => c && c !== p.baseCcy))].map(c => c + p.baseCcy));

    const seriesRows = keys.map(k => {
      const s = h.series[k];
      const firstI = s.findIndex(isNum), lastI = s.length - 1 - [...s].reverse().findIndex(isNum);
      return { key: k, obs: s.filter(isNum).length, first: h.dates[firstI], last: h.dates[lastI], px: s[lastI], used: usedBy.get(k) || [], fx: fxKeys.has(k), bench: p.benchmark === k };
    });

    root.innerHTML = `
      ${pageHead(t('nav.history'), esc(t('hist.sub')))}
      <div class="grid-2">
        ${card(t('hist.upload'), `
          <div class="drop" id="hdrop" tabindex="0" role="button"><p><strong>${esc(t('imp.drop'))}</strong></p><p class="muted small">${esc(t('hist.formats'))}</p><input type="file" id="hfile" accept=".csv,.txt,.tsv,.xlsx,.xls,.ods" hidden></div>
          <details class="paste"><summary>${esc(t('imp.paste'))}</summary><textarea id="hpaste" rows="5" placeholder="Date;OMXS30;VOLV B&#10;2026-09-25;2650,1;262,0"></textarea><button class="btn btn-sm" data-act="paste">${esc(t('imp.parsePaste'))}</button></details>
          <label class="inline"><input type="checkbox" id="hreplace"> ${esc(t('hist.replace'))}</label>
        `)}
        ${card(t('hist.howto'), `
          <ul class="bullets">
            <li>${esc(t('hist.how1'))}</li><li>${esc(t('hist.how2'))}</li><li>${esc(t('hist.how3', { base: p.baseCcy }))}</li><li>${esc(t('hist.how4'))}</li>
          </ul>
          <button class="btn btn-sm" data-act="tpl">${esc(t('hist.template'))}</button>`)}
      </div>
      ${keys.length ? `
      <div class="kpi-grid small">
        <div class="kpi"><div class="kpi-label">${esc(t('hist.range'))}</div><div class="kpi-value sm">${fmtDate(h.dates[0])} – ${fmtDate(h.dates[h.dates.length - 1])}</div></div>
        <div class="kpi"><div class="kpi-label">${esc(t('hist.series'))}</div><div class="kpi-value">${keys.length}</div></div>
        <div class="kpi"><div class="kpi-label">${esc(t('hist.coverage'))}</div><div class="kpi-value">${hp ? fmtPct(hp.coverage, 0) : '—'}</div><div class="kpi-sub">${esc(t('hist.coverageSub'))}</div></div>
        <div class="kpi"><div class="kpi-label">${esc(t('hist.benchmark'))}</div><div class="kpi-value sm">${selectHtml('id="benchSel"', [['', t('hist.noBench')], ...keys.map(k => [k, k])], p.benchmark)}</div></div>
      </div>
      <div class="grid-2">
        ${card(t('hist.seriesTitle'), table([
          { key: 'key', label: t('hist.key'), fmt: r => `<strong>${esc(r.key)}</strong>${r.bench ? ` <span class="type-pill">${esc(t('hist.benchmark'))}</span>` : ''}${r.fx ? ' <span class="type-pill">FX</span>' : ''}` },
          { key: 'obs', label: t('hist.obs'), align: 'right', fmt: r => fmtNum(r.obs) },
          { key: 'last', label: t('hist.last'), fmt: r => fmtDate(r.last) },
          { key: 'px', label: t('col.price'), align: 'right', fmt: r => fmtNum(r.px, 2) },
          { key: 'used', label: t('hist.usedBy'), fmt: r => r.used.length ? esc(r.used.slice(0, 2).join(', ') + (r.used.length > 2 ? ' +' + (r.used.length - 2) : '')) : (r.fx || r.bench ? '' : `<span class="muted">${esc(t('hist.unused'))}</span>`) },
          { key: 'del', label: '', fmt: r => `<button class="icon-btn sm" data-delkey="${esc(r.key)}" aria-label="${esc(t('common.delete'))}">✕</button>` }
        ], seriesRows, { dense: true }), { actions: `<button class="btn btn-sm btn-danger" data-act="clear">${esc(t('hist.clear'))}</button>` })}
        ${card(t('hist.matching'), `<p class="muted small">${esc(t('hist.matchingHelp'))}</p>` + table([
          { key: 'name', label: t('col.name'), fmt: x => `${esc(x.name)}<div class="cell-sub">${esc(typeLabel(x.pos.type, lang()))}</div>` },
          { key: 'k', label: t('hist.key'), fmt: x => selectHtml(`data-match="${x.pos.id}"`, [['', '— ' + t('hist.none') + ' —'], ...keys.map(k => [k, k])], seriesKeyFor(x.pos, h) || '') }
        ], [...matchable].sort((x, y) => (seriesKeyFor(x.pos, h) ? 1 : 0) - (seriesKeyFor(y.pos, h) ? 1 : 0) || Math.abs(y.r.mv) - Math.abs(x.r.mv)), { dense: true }))}
      </div>` : empty(esc(t('hist.empty')))}
    `;

    const handle = async (name, parsed) => {
      try {
        const rows = parsed.sheets.find(s => s.rows.length > 2)?.rows || [];
        const hist = parseHistory(rows, parsed.decimal);
        const replace = root.querySelector('#hreplace')?.checked;
        store.update(pp => { pp.history = replace ? hist : mergeHistory(pp.history, hist); if (!pp.benchmark || !pp.history.series[pp.benchmark]) pp.benchmark = ''; }, t('nav.history'));
        toast(t('hist.loaded', { n: Object.keys(hist.series).length, d: hist.dates.length }));
      } catch (e) {
        console.error(e);
        toast(t('hist.error'), { tone: 'warn' });
      }
    };
    const drop = root.querySelector('#hdrop'), fin = root.querySelector('#hfile');
    drop.onclick = () => fin.click();
    drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fin.click(); } };
    fin.onchange = async () => { const f = fin.files[0]; if (f) handle(f.name, await readFile(f, loadScript)); };
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = async e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) handle(f.name, await readFile(f, loadScript)); };
    root.querySelector('#benchSel')?.addEventListener('change', e => store.update(pp => { pp.benchmark = e.target.value; }, t('hist.benchmark')));
    root.querySelectorAll('[data-match]').forEach(s => s.addEventListener('change', e => {
      store.update(pp => { const pos = pp.positions.find(x => x.id === e.target.dataset.match); if (e.target.value) pos.seriesKey = e.target.value; else { delete pos.seriesKey; } }, t('hist.matching'));
    }));
    root.onclick = async e => {
      const del = e.target.closest('[data-delkey]')?.dataset.delkey;
      if (del) { store.update(pp => { delete pp.history.series[del]; if (pp.benchmark === del) pp.benchmark = ''; }, t('common.delete')); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'paste') { const txt = root.querySelector('#hpaste').value; if (txt.trim()) handle('paste', parseText(txt)); }
      if (act === 'clear' && await confirmDialog(t('hist.clearConfirm'), { danger: true, ok: t('common.delete') })) store.update(pp => { pp.history = { dates: [], series: {} }; pp.benchmark = ''; }, t('hist.clear'));
      if (act === 'tpl') {
        const cols = ['Date', ...new Set(matchable.map(x => x.pos.ticker || x.pos.isin || x.name)), ...fxKeys];
        downloadBlob('﻿' + toCSV([cols, [h.dates[h.dates.length - 1] || new Date().toISOString().slice(0, 10), ...cols.slice(1).map(() => '')]], lang() === 'sv' ? ';' : ','), 'text/csv;charset=utf-8', slug(p.name) + '-history-template.csv');
      }
    };
  }
};
