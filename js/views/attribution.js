import * as store from '../store.js';
import { t, L, lang } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtPct, fmtNum, fmtDate, empty, signCls, selectHtml, toast } from '../ui.js';
import { ASSET_CLASSES, REGIONS, normKey } from '../instruments.js';
import { parseText, readFile, parseNumber } from '../importer.js';
import { brinson, portfolioSegments, parseBenchmark, SEGMENT_DIMS } from '../insights.js';
import { snapshots } from '../snapshots.js';
import * as charts from '../charts.js';
import { downloadBlob, loadScript, slug } from '../util.js';

const ui = { pf: '', from: '', to: '' };

// Label in the current language, and every name a benchmark file might use for the same segment.
const labelOf = (dim, k) => dim === 'assetClass' ? L(ASSET_CLASSES[k] || { en: k }) : dim === 'region' ? L(REGIONS[k] || { en: k }) : k;
// Names index factsheets commonly use for the same asset class.
const CLASS_SYNONYMS = {
  equity: ['equities', 'stocks', 'shares', 'aktie', 'aktiefonder'],
  fixed_income: ['bonds', 'fixed income', 'räntor', 'ränta', 'obligationer', 'räntefonder', 'credit', 'kredit'],
  money_market: ['money market', 'penningmarknad', 'korta räntor', 'kortränta'],
  cash: ['kassa', 'likviditet', 'bank', 'cash and equivalents', 'likvida medel'],
  commodity: ['commodity', 'råvara'],
  alternative: ['alternative', 'alternativa investeringar', 'hedge funds', 'hedgefonder'],
  mixed: ['mixed', 'balanced', 'blandfonder']
};
const aliasesOf = (dim, k) => {
  const src = dim === 'assetClass' ? ASSET_CLASSES[k] : dim === 'region' ? REGIONS[k] : null;
  return [k, ...(src ? [src.en, src.sv] : []), ...(dim === 'assetClass' ? CLASS_SYNONYMS[k] || [] : [])].map(normKey);
};
// Plain numbers for the text box: 60 not 60.0000, with the language's decimal sign.
const plain = x => String(+(+x).toPrecision(8)).replace('.', lang() === 'sv' ? ',' : '.');

export default {
  render(root, app) {
    const p = store.active();
    if (ui.pf !== p.id) Object.assign(ui, { pf: p.id, from: '', to: '' });
    const cfg = { dim: 'assetClass', rows: [], name: '', unit: 'percent', ...(p.attribution || {}) };
    if (cfg.unit !== 'fraction') cfg.unit = 'percent';
    const shown = r => (cfg.unit === 'percent' ? r * 100 : r);
    const snaps = snapshots(p);
    const useSnaps = snaps.length >= 2;
    const h = p.history;
    const dates = useSnaps ? snaps.map(s => s.date) : (h?.dates || []);
    if (!dates.includes(ui.to)) ui.to = dates[dates.length - 1] || '';
    if (!dates.includes(ui.from) || ui.from >= ui.to) ui.from = useSnaps ? dates[Math.max(0, dates.indexOf(ui.to) - 1)] : dates[Math.max(0, dates.length - 22)] || '';
    const port = dates.length >= 2 ? portfolioSegments(p, cfg.dim, { from: ui.from, to: ui.to, snaps: useSnaps ? snaps : null }) : null;

    // Put benchmark segments on the portfolio's keys where the names match (Aktier = Equity = equity).
    const alias = new Map();
    (port?.rows || []).forEach(r => aliasesOf(cfg.dim, r.segment).forEach(a => alias.set(a, r.segment)));
    const bench = cfg.rows.map(r => ({ ...r, segment: alias.get(normKey(r.segment)) || r.segment }));
    const res = port && bench.length ? brinson(port.rows, bench) : null;
    const unmatched = res ? res.rows.filter(r => !r.inPortfolio || !r.inBenchmark) : [];
    const dateOpts = [...dates].reverse().map(d => [d, d]);

    root.innerHTML = `
      ${pageHead(t('nav.attribution'), esc(t('att.sub')))}
      <div class="grid-2">
        ${card(t('att.benchmark'), `
          <div class="toolbar wrap">
            <label class="inline">${esc(t('att.dim'))} ${selectHtml('id="attDim"', SEGMENT_DIMS.map(d => [d, t('att.dim.' + d)]), cfg.dim)}</label>
            <label class="inline">${esc(t('att.unit'))} ${selectHtml('id="attUnit"', [['percent', t('att.unit.percent')], ['fraction', t('att.unit.fraction')]], cfg.unit)}</label>
          </div>
          <textarea id="attPaste" rows="6" placeholder="${esc(t('att.pastePh'))}">${esc(cfg.rows.map(r => [r.segment, plain(r.weight), plain(shown(r.ret))].join('\t')).join('\n'))}</textarea>
          <div class="btn-row">
            <button class="btn btn-sm btn-primary" data-act="parse">${esc(t('att.use'))}</button>
            <button class="btn btn-sm" data-act="file">${esc(t('att.upload'))}</button><input type="file" id="attFile" accept=".csv,.txt,.tsv,.xlsx,.xls" hidden>
            <button class="btn btn-sm" data-act="template" ${port ? '' : 'disabled'}>${esc(t('att.template'))}</button>
            ${cfg.rows.length ? `<button class="btn btn-sm" data-act="clear">${esc(t('att.clear'))}</button>` : ''}
          </div>
          <p class="muted small">${esc(t('att.benchHelp'))}</p>`, { sub: esc(cfg.rows.length ? t('att.benchLoaded', { n: cfg.rows.length }) : t('att.benchNone')) })}
        ${card(t('att.period'), dates.length >= 2 ? `
          <div class="toolbar wrap">
            <label class="inline">${esc(t('chg.from'))} ${selectHtml('id="attFrom"', dateOpts.filter(([d]) => d < ui.to), ui.from)}</label>
            <label class="inline">${esc(t('chg.to'))} ${selectHtml('id="attTo"', dateOpts.filter(([d]) => d > dates[0]), ui.to)}</label>
          </div>
          <p class="muted small">${esc(t(useSnaps ? 'att.basisSnaps' : 'att.basisHistory', { c: fmtPct(port?.coverage ?? 0, 0) }))}</p>
          <div class="alert alert-warn"><span>${esc(t('att.samePeriod', { a: fmtDate(ui.from), b: fmtDate(ui.to) }))}</span></div>`
          : empty(esc(t('att.noPeriod')), `<div class="btn-row"><a class="btn" href="#/changes">${esc(t('nav.changes'))}</a><a class="btn" href="#/history">${esc(t('nav.history'))}</a></div>`))}
      </div>
      ${res ? `
        <div class="kpi-grid">
          ${kpi(t('att.rp'), fmtPct(res.Rp + (port.residual || 0), 2), { sub: port.residual ? t('att.residualSub', { r: fmtPct(port.residual, 2) }) : '' })}
          ${kpi(t('att.rb'), fmtPct(res.Rb, 2), { sub: esc(cfg.name || '') })}
          ${kpi(t('att.active'), fmtPct(res.active + (port.residual || 0), 2), { tone: res.active + (port.residual || 0) < 0 ? 'breach' : 'ok' })}
          ${kpi(t('att.allocation'), fmtPct(res.allocation, 2), { help: t('att.allocationHelp') })}
          ${kpi(t('att.selection'), fmtPct(res.selection, 2), { help: t('att.selectionHelp') })}
          ${kpi(t('att.interaction'), fmtPct(res.interaction, 2), { help: t('att.interactionHelp') })}
        </div>
        ${card(t('att.bySegment'), '<div id="chAtt" class="chart"></div>')}
        ${card(t('att.table'), table([
          { key: 's', label: t('att.dim.' + cfg.dim), fmt: r => `${esc(labelOf(cfg.dim, r.segment))}${!r.inBenchmark ? ` <span class="chip chip-warn">${esc(t('att.notInBench'))}</span>` : !r.inPortfolio ? ` <span class="chip">${esc(t('att.notHeld'))}</span>` : ''}` },
          { key: 'wp', label: t('att.wp'), align: 'right', fmt: r => fmtPct(r.wp, 1) },
          { key: 'wb', label: t('att.wb'), align: 'right', fmt: r => fmtPct(r.wb, 1) },
          { key: 'rp', label: t('att.rpSeg'), align: 'right', fmt: r => r.rp == null ? '—' : fmtPct(r.rp, 2) },
          { key: 'rb', label: t('att.rbSeg'), align: 'right', fmt: r => r.rb == null ? '—' : fmtPct(r.rb, 2) },
          { key: 'a', label: t('att.allocation'), align: 'right', fmt: r => `<span class="${signCls(r.allocation)}">${fmtPct(r.allocation, 2)}</span>` },
          { key: 'se', label: t('att.selection'), align: 'right', fmt: r => `<span class="${signCls(r.selection)}">${fmtPct(r.selection, 2)}</span>` },
          { key: 'i', label: t('att.interaction'), align: 'right', fmt: r => `<span class="${signCls(r.interaction)}">${fmtPct(r.interaction, 2)}</span>` },
          { key: 't', label: t('att.total'), align: 'right', fmt: r => `<strong class="${signCls(r.total)}">${fmtPct(r.total, 2)}</strong>` }
        ], res.rows, { dense: true, foot: [esc(t('att.total')), fmtPct(1, 0), fmtPct(1, 0), fmtPct(res.Rp, 2), fmtPct(res.Rb, 2), fmtPct(res.allocation, 2), fmtPct(res.selection, 2), fmtPct(res.interaction, 2), `<strong>${fmtPct(res.active, 2)}</strong>`] }),
          { sub: esc(unmatched.length ? t('att.unmatched', { n: unmatched.length }) : t('att.tableSub')) })}` : port && !bench.length ? `<div class="alert alert-info"><span>${esc(t('att.needBench'))}</span></div>` : ''}
      <p class="footnote">${esc(t('att.method'))}</p>
    `;

    if (res) {
      const rows = [...res.rows].reverse();
      charts.render('chAtt', charts.barHGroupedSpec(rows.map(r => labelOf(cfg.dim, r.segment)), [
        { name: t('att.allocation'), values: rows.map(r => r.allocation) },
        { name: t('att.selection'), values: rows.map(r => r.selection) },
        { name: t('att.interaction'), values: rows.map(r => r.interaction) }
      ]));
    }

    const save = patch => store.update(pp => { pp.attribution = { ...cfg, ...patch }; }, t('nav.attribution'));
    const useRows = (rows, decimal, name = cfg.name) => {
      const r = parseBenchmark(rows, { decimal, unit: cfg.unit, parseNumber, normKey });
      if (r.error) { toast(t('att.parseError'), { tone: 'warn' }); return; }
      save({ rows: r.rows, name });
      toast(t('att.loaded', { n: r.rows.length }));
    };
    root.querySelector('#attDim').addEventListener('change', e => save({ dim: e.target.value }));
    root.querySelector('#attUnit').addEventListener('change', e => save({ unit: e.target.value }));
    root.querySelector('#attFrom')?.addEventListener('change', e => { ui.from = e.target.value; app.rerender(); });
    root.querySelector('#attTo')?.addEventListener('change', e => { ui.to = e.target.value; app.rerender(); });
    root.querySelector('#attFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try { const r = await readFile(f, loadScript); useRows(r.sheets.find(s => s.rows.length > 1)?.rows || [], r.decimal, f.name.replace(/\.[a-z0-9]+$/i, '')); }
      catch (err) { toast(t('att.parseError'), { tone: 'warn' }); }
    });
    root.onclick = e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'parse') {
        const txt = root.querySelector('#attPaste').value;
        if (!txt.trim()) return;
        const parsed = parseText(txt);
        useRows(parsed.sheets[0].rows, parsed.decimal);
      }
      if (act === 'file') root.querySelector('#attFile').click();
      if (act === 'clear') save({ rows: [] });
      if (act === 'template' && port) {
        const lines = [[t('att.dim.' + cfg.dim), t('att.wb'), t('att.rbSeg') + ' %'], ...port.rows.map(r => [labelOf(cfg.dim, r.segment), '', ''])];
        downloadBlob('﻿' + lines.map(l => l.join(';')).join('\n'), 'text/csv;charset=utf-8', `benchmark-${slug(cfg.dim)}.csv`);
      }
    };
  }
};
