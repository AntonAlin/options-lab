import * as store from '../store.js';
import { t, L, lang } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtMoney, fmtNum, fmtPct, segmented, signCls } from '../ui.js';
import { OPTION_LABELS, typeLabel, DELTA_TOL } from '../instruments.js';
import * as charts from '../charts.js';
import { toCSV } from '../importer.js';
import { downloadBlob, slug } from '../util.js';

const ui = { filter: 'all' };
const undLabel = k => L(OPTION_LABELS[k] || { en: k });
const money = x => (x == null ? '<span class="muted">—</span>' : fmtMoney(x, '', { compact: true }));
const pair = (m, r) => `<span class="muted small">${esc(t('der.modelShort'))}</span> ${m}${r != null ? `<div class="cell-sub">${esc(t('der.repShort'))} <strong>${r}</strong></div>` : ''}`;
const delta = x => (x == null ? '<span class="muted">—</span>' : fmtNum(x, 3));

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const { db } = a;
    const base = p.baseCcy;
    const useRep = p.risk.useReported !== false;
    const rows = db.rows.filter(r => ui.filter === 'all' || (ui.filter === 'mismatch' ? r.mismatch : ui.filter === 'reported' ? r.hasReported : r.type === 'option'));
    const recon = db.rows.filter(r => r.hasReported && r.type !== 'fx_forward');

    root.innerHTML = `
      ${pageHead(t('nav.derivatives'), esc(t('der.sub')), db.count ? `<button class="btn" data-act="csv">CSV</button>` : '')}
      <div class="alert alert-info"><span>${esc(t('der.honest'))} <a href="#/import">${esc(t('nav.import'))} →</a></span></div>
      <div class="toolbar settings-strip">
        <label class="check-inline"><input type="checkbox" id="derUseRep" ${useRep ? 'checked' : ''}> ${esc(t('der.useReported'))}</label>
        <span class="muted small">${esc(t('der.useReportedHelp'))}</span>
      </div>
      ${!db.count ? `<div class="empty"><p>${esc(t('der.none'))}</p></div>` : `
      <div class="kpi-grid">
        ${kpi(t('der.count'), String(db.count), { sub: t('der.countSub', { n: db.rows.filter(r => r.type === 'option').length }) })}
        ${kpi(t('der.coverage'), `${db.withReported} / ${db.reportable}`, { sub: t('der.coverageSub', { n: db.usingReported }), tone: db.reportable && db.withReported < db.reportable ? 'warn' : db.reportable ? 'ok' : '' })}
        ${kpi(t('der.mismatches'), String(db.mismatches), { tone: db.mismatches ? 'warn' : db.withReported ? 'ok' : '', sub: t('der.mismatchSub', { d: fmtNum(DELTA_TOL, 2) }) })}
        ${kpi(t('der.grossNotional'), fmtPct(db.grossNotionalW, 1), { sub: fmtMoney(db.grossNotional, base, { compact: true }) })}
        ${kpi(t('der.commitment'), fmtPct(db.commitmentW, 1), { sub: t('der.commitmentSub'), help: t('help.gross') })}
        ${kpi(t('der.netDelta'), `<span class="${signCls(db.netDelta)}">${fmtPct(a.v.nav ? db.netDelta / a.v.nav : 0, 1, { sign: true })}</span>`, { sub: fmtMoney(db.netDelta, base, { compact: true }) })}
      </div>
      <div class="grid-2">
        ${card(t('der.byUnd'), `<div id="chDerUnd" class="chart"></div>${table([
          { key: 'k', label: t('der.underlying'), fmt: u => esc(undLabel(u.key)) },
          { key: 'n', label: t('der.n'), align: 'right', fmt: u => String(u.n) },
          { key: 'no', label: t('der.notional'), align: 'right', fmt: u => fmtPct(u.notionalW, 1, { sign: true }) },
          { key: 'd', label: t('der.deltaExp'), align: 'right', fmt: u => u.key === 'fx' ? '—' : `<span class="${signCls(u.deltaExp)}">${fmtPct(u.deltaW, 1, { sign: true })}</span>` },
          { key: 'c', label: t('der.commitmentCol'), align: 'right', fmt: u => fmtPct(u.commitW, 1) }
        ], db.byUnderlying, { dense: true })}`, { sub: esc(t('der.byUndSub')) })}
        ${card(t('der.recon'), recon.length ? '<div id="chDerRecon" class="chart"></div>' : `<p class="muted">${esc(t('der.noReported'))}</p>`, { sub: esc(t('der.reconSub', { base })) })}
      </div>
      ${card(t('der.table'), `
        <div class="toolbar">${segmented('derFilter', [['all', t('der.f.all')], ['option', t('der.f.option')], ['reported', t('der.f.reported')], ['mismatch', t('der.f.mismatch', { n: db.mismatches })]], ui.filter)}</div>
        ${table([
          { key: 'n', label: t('col.name'), fmt: r => `${esc(r.name)}<div class="cell-sub">${esc(typeLabel(r.type, lang()))} · ${esc(undLabel(r.und))}${r.type === 'option' ? ' · ' + esc(L(OPTION_LABELS[r.pos.optType] || { en: '' })) : ''}</div>` },
          { key: 'no', label: t('der.notional'), align: 'right', fmt: r => pair(money(r.modelNotional), r.repNotional != null ? money(r.repNotional) : null) },
          { key: 'd', label: t('der.deltaCol'), align: 'right', fmt: r => r.type !== 'option' ? '<span class="muted">1</span>' : pair(delta(r.modelDelta), (r.repDelta ?? r.impliedDelta) != null ? delta(r.repDelta ?? r.impliedDelta) : null) },
          { key: 'e', label: t('der.deltaExp'), align: 'right', fmt: r => r.type === 'fx_forward' ? '<span class="muted">—</span>' : pair(money(r.modelDeltaExp), r.repDeltaExp != null ? money(r.repDeltaExp) : null) },
          { key: 'df', label: t('der.diff'), align: 'right', fmt: r => r.diffExp == null ? '<span class="muted">—</span>' : `<span class="${r.mismatch ? 'neg strong' : 'muted'}">${fmtMoney(r.diffExp, '', { compact: true })}${r.diffPct != null ? ` <small>(${fmtPct(r.diffPct, 0, { sign: true })})</small>` : ''}</span>` },
          { key: 's', label: t('der.source'), fmt: r => `<span class="chip ${r.mismatch ? 'chip-warn' : r.used ? 'chip-ok' : ''}">${esc(r.mismatch ? t('der.check') : r.used ? t('der.src.reported') : t('der.src.model'))}</span>` }
        ], rows, { dense: true, rowAttr: r => r.mismatch ? 'class="row-error"' : '' })}`, { sub: esc(t('der.tableSub', { base })) })}
      `}
      <p class="footnote">${esc(t('der.method'))}</p>
    `;

    if (db.count) {
      const P = charts.palette();
      const u = db.byUnderlying;
      charts.render('chDerUnd', charts.barHGroupedSpec(u.map(x => undLabel(x.key)), [
        { name: t('der.notional'), values: u.map(x => x.notionalW) },
        { name: t('der.deltaExp'), values: u.map(x => x.deltaW) }
      ], { height: Math.max(190, 46 * u.length + 70) }));
      if (recon.length) {
        const spec = charts.barHGroupedSpec(recon.map(r => r.name), [
          { name: t('der.expModel'), values: recon.map(r => r.modelDeltaExp) },
          { name: t('der.expRep'), values: recon.map(r => r.repDeltaExp ?? r.modelDeltaExp) }
        ], { fmt: 'num', height: Math.max(190, 50 * recon.length + 70) });
        spec.layout.xaxis = { ...spec.layout.xaxis, tickformat: '~s', separatethousands: true };
        spec.data[1].marker = { color: charts.rgba(P.series[3], 0.85), line: { color: P.series[3], width: 1 } };
        charts.render('chDerRecon', spec);
      }
    }

    root.querySelector('#derUseRep')?.addEventListener('change', e => store.update(pp => { pp.risk.useReported = e.target.checked; }, t('der.useReported')));
    root.onclick = e => {
      const f = e.target.closest('[data-seg="derFilter"]');
      if (f) { ui.filter = f.dataset.value; app.rerender(); return; }
      if (e.target.closest('[data-act="csv"]')) {
        const r2 = x => (x == null ? '' : Math.round(x * 100) / 100);
        const d4 = x => (x == null ? '' : Math.round(x * 10000) / 10000);
        const head = ['name', 'type', 'underlying', 'notional_model_' + base, 'notional_reported_' + base, 'delta_model', 'delta_reported', 'delta_exposure_model_' + base, 'delta_exposure_reported_' + base, 'difference_' + base, 'source', 'check'];
        const body = db.rows.map(r => [r.name, r.type, r.und, r2(r.modelNotional), r2(r.repNotional), r.type === 'option' ? d4(r.modelDelta) : '', r.type === 'option' ? d4(r.repDelta ?? r.impliedDelta) : '', r2(r.modelDeltaExp), r2(r.repDeltaExp), r2(r.diffExp), r.used ? 'reported' : 'model', r.mismatch ? 'yes' : '']);
        downloadBlob('﻿' + toCSV([head, ...body], lang() === 'sv' ? ';' : ','), 'text/csv;charset=utf-8', `${slug(p.name)}-derivatives.csv`);
      }
    };
  }
};
