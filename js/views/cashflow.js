import * as store from '../store.js';
import { t, locale } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtMoney, fmtNum, fmtDate, segmented, selectHtml, signCls, empty } from '../ui.js';
import { typeLabel } from '../instruments.js';
import { CF_KINDS, toICS } from '../fund.js';
import { toCSV } from '../importer.js';
import * as charts from '../charts.js';
import { downloadBlob, slug } from '../util.js';

const ui = { kind: '' };
const KIND_COLOR = { coupon: 2, redemption: 0, fx_settle: 1, swap: 5, cds_premium: 7, option_expiry: 3, future_expiry: 6 };

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const { cf } = a;
    const base = p.baseCcy;
    const P = charts.palette();
    const kindLabel = k => t('cf.kind.' + k);
    const rows = cf.events.filter(e => !ui.kind || e.kind === ui.kind);
    const monthLabel = m => new Date(m + '-01T00:00:00Z').toLocaleDateString(locale(), { month: 'short', year: '2-digit', timeZone: 'UTC' });
    const cashKinds = CF_KINDS.filter(k => cf.buckets.some(b => b.byKind[k]));

    root.innerHTML = `
      ${pageHead(t('nav.cashflow'), esc(t('cf.sub')), `<button class="btn" data-act="csv">CSV</button><button class="btn btn-primary" data-act="ics">${esc(t('cf.ics'))}</button>`)}
      <div class="toolbar settings-strip">
        <span>${esc(t('cf.horizon'))}</span>${segmented('months', [[3, t('cf.m', { n: 3 })], [6, t('cf.m', { n: 6 })], [12, t('cf.m', { n: 12 })], [24, t('cf.m', { n: 24 })]], p.risk.cfMonths || 12)}
        <span class="muted small">${esc(t('cf.horizonHelp', { from: fmtDate(cf.start), to: fmtDate(cf.end) }))}</span>
      </div>
      <div class="kpi-grid">
        ${kpi(t('cf.cashNow'), fmtMoney(cf.cashNow, base, { compact: true }), { sub: t('cf.cashNowSub') })}
        ${kpi(t('cf.next30'), `<span class="${signCls(cf.next30)}">${fmtMoney(cf.next30, base, { compact: true })}</span>`, { sub: t('cf.netSub') })}
        ${kpi(t('cf.next90'), `<span class="${signCls(cf.next90)}">${fmtMoney(cf.next90, base, { compact: true })}</span>`, { sub: t('cf.netSub') })}
        ${kpi(t('cf.maturing'), fmtMoney(cf.maturing1y, base, { compact: true }), { sub: t('cf.maturingSub', { p: fmtNum(a.v.nav ? cf.maturing1y / a.v.nav * 100 : 0, 1) }) })}
        ${kpi(t('cf.optExp'), String(cf.optionExpiries30), { sub: t('cf.optExpSub'), tone: cf.optionExpiries30 ? 'warn' : '' })}
      </div>
      ${cf.events.length ? `
        ${card(t('cf.chart'), '<div id="chCf" class="chart"></div>', { sub: esc(t('cf.chartSub', { base })) })}
        ${card(t('cf.events'), `
          <div class="toolbar">${selectHtml('id="cfKind" aria-label="' + esc(t('cf.filter')) + '"', [['', t('cf.allKinds')], ...CF_KINDS.filter(k => cf.events.some(e => e.kind === k)).map(k => [k, kindLabel(k)])], ui.kind)}
            <span class="muted small">${esc(t('hold.showing', { n: rows.length, total: cf.events.length }))}</span></div>
          ${table([
            { key: 'd', label: t('cf.date'), fmt: e => `<span class="nowrap">${fmtDate(e.date)}</span>` },
            { key: 'k', label: t('cf.event'), fmt: e => `<span class="kind-dot" style="background:${P.series[KIND_COLOR[e.kind] % 8]}"></span>${esc(kindLabel(e.kind))}${e.estimate ? ` <span class="type-pill" title="${esc(t('cf.estimateHelp'))}">${esc(t('cf.estimate'))}</span>` : ''}${e.kind === 'option_expiry' ? ` <span class="chip ${e.itm ? 'chip-warn' : 'chip-ok'}">${e.itm ? 'ITM' : 'OTM'}</span>` : ''}` },
            { key: 'n', label: t('col.name'), fmt: e => `${esc(e.name)}<div class="cell-sub">${esc(typeLabel(e.type))}</div>` },
            { key: 'c', label: t('col.ccy'), fmt: e => esc(e.ccy || '') },
            { key: 'a', label: t('cf.amountLocal'), align: 'right', fmt: e => `<span class="${e.cash ? signCls(e.amount) : 'muted'}">${fmtNum(e.amount, 0)}</span>` },
            { key: 'b', label: t('cf.amountBase', { base }), align: 'right', fmt: e => `<span class="${e.cash ? signCls(e.amountBase) : 'muted'}">${fmtNum(e.amountBase, 0)}</span>` }
          ], rows, { dense: true, rowAttr: e => (e.cash ? '' : 'class="row-info"') })}
        `, { sub: esc(t('cf.eventsSub')) })}
      ` : empty(esc(t('cf.none')))}
      <p class="footnote">${esc(t('cf.method'))}</p>
    `;

    if (cf.events.length) {
      charts.render('chCf', charts.stackedBarSpec(cf.buckets.map(b => monthLabel(b.month)),
        cashKinds.map(k => ({ name: kindLabel(k), values: cf.buckets.map(b => b.byKind[k] || 0), color: P.series[KIND_COLOR[k] % 8] })),
        { line: { name: t('cf.projected'), values: cf.buckets.map(b => b.cashAfter) } }));
    }

    root.querySelector('#cfKind')?.addEventListener('change', e => { ui.kind = e.target.value; app.rerender(); });
    root.onclick = e => {
      const seg = e.target.closest('[data-seg="months"]');
      if (seg) { store.update(pp => { pp.risk.cfMonths = +seg.dataset.value; }, t('cf.horizon')); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'csv') {
        const head = ['date', 'event', 'estimate', 'moves_cash', 'instrument', 'type', 'ccy', 'amount', 'amount_' + base];
        const body = cf.events.map(x => [x.date, kindLabel(x.kind), x.estimate ? 'yes' : '', x.cash ? 'yes' : 'no', x.name, x.type, x.ccy, Math.round(x.amount * 100) / 100, Math.round(x.amountBase * 100) / 100]);
        downloadBlob('﻿' + toCSV([head, ...body], ','), 'text/csv;charset=utf-8', `${slug(p.name)}-cashflows.csv`);
      }
      if (act === 'ics') {
        const labels = Object.fromEntries(CF_KINDS.map(k => [k, kindLabel(k)]));
        downloadBlob(toICS(cf.events, { fundName: p.name, labels }), 'text/calendar;charset=utf-8', `${slug(p.name)}-calendar.ics`);
      }
    };
  }
};
