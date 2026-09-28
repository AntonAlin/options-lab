import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, table, fmtPct, fmtNum, fmtDate, selectHtml, empty } from '../ui.js';
import { SRRI_BANDS, MRM_BANDS } from '../fund.js';
import * as charts from '../charts.js';

// The 1–7 scale as it appears in a KID: seven boxes, the fund's class highlighted.
export function scaleHtml(cls, label) {
  return `<div class="sri-scale" role="img" aria-label="${esc(label)}: ${cls} / 7">
    ${[1, 2, 3, 4, 5, 6, 7].map(i => `<span class="sri-box ${i === cls ? 'on' : ''} lvl${i}">${i}</span>`).join('')}
  </div><div class="sri-ends"><span>${esc(t('ri.lower'))}</span><span>${esc(t('ri.higher'))}</span></div>`;
}

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const ri = a.ri;
    const series = Object.keys(p.history?.series || {});
    const srcOpts = [['', t('ri.srcPortfolio')], ...series.map(k => [k, k])];
    const bandsTable = (bands, cls) => [1, 2, 3, 4, 5, 6, 7].map(i => ({
      i, lo: i === 1 ? 0 : bands[i - 2], hi: i === 7 ? null : bands[i - 1], on: i === cls
    }));

    root.innerHTML = `
      ${pageHead(t('nav.riskClass'), esc(t('ri.sub')))}
      <div class="toolbar wrap settings-strip">
        <label class="inline">${esc(t('ri.source'))} ${selectHtml('id="riSrc"', srcOpts, p.risk.sriSource || '')}</label>
        <label class="inline">${esc(t('ri.rhp'))} <input id="riRhp" type="number" min="1" max="20" step="1" value="${p.risk.rhp || 5}" class="w-80"> ${esc(t('ri.years'))}</label>
        <label class="inline">${esc(t('ri.crm'))} ${selectHtml('id="riCrm"', [1, 2, 3, 4, 5, 6].map(i => [i, String(i)]), p.risk.crm || 1)}</label>
        <span class="muted small">${esc(t('ri.srcHelp'))}</span>
      </div>
      ${!ri ? empty(esc(t('ri.none')), `<a class="btn btn-primary" href="#/history">${esc(t('nav.history'))}</a>`) : `
      ${(!ri.srriFull || !ri.sriEnough) ? `<div class="alert alert-warn"><span>${esc(t('ri.short', { y: fmtNum(ri.yearsAvail, 1) }))}</span></div>` : ''}
      ${!p.risk.sriSource ? `<div class="alert alert-info"><span>${esc(t('ri.backcastNote'))}</span></div>` : ''}
      <div class="grid-2">
        ${card(t('ri.sri'), `${scaleHtml(ri.sri, 'SRI')}
          <div class="kpi-grid small mt">
            <div class="kpi"><div class="kpi-label">${esc(t('ri.vev'))}</div><div class="kpi-value">${fmtPct(ri.vev, 1)}</div><div class="kpi-sub">MRM ${ri.mrm} · CRM ${ri.crm}</div></div>
            <div class="kpi"><div class="kpi-label">${esc(t('ri.var975'))}</div><div class="kpi-value">${fmtPct(Math.exp(ri.varReturn) - 1, 1)}</div><div class="kpi-sub">${esc(t('ri.atRhp', { n: ri.rhpYears }))}</div></div>
          </div>`, { sub: esc(t('ri.sriSub')) })}
        ${card(t('ri.srri'), `${scaleHtml(ri.srri, 'SRRI')}
          <div class="kpi-grid small mt">
            <div class="kpi"><div class="kpi-label">${esc(t('ri.weeklyVol'))}</div><div class="kpi-value">${fmtPct(ri.srriVol, 1)}</div><div class="kpi-sub">${esc(t('ri.weeks', { n: ri.weeks }))}</div></div>
            <div class="kpi"><div class="kpi-label">${esc(t('ri.period'))}</div><div class="kpi-value sm">${fmtDate(ri.from)} – ${fmtDate(ri.to)}</div><div class="kpi-sub">${esc(t('ri.yearsAvail', { y: fmtNum(ri.yearsAvail, 1) }))}</div></div>
          </div>`, { sub: esc(t('ri.srriSub')) })}
      </div>
      ${card(t('ri.rolling'), '<div id="chRi" class="chart"></div>', { sub: esc(t('ri.rollingSub')) })}
      <div class="grid-2">
        ${card(t('ri.bandsSri'), table([
          { key: 'i', label: t('ri.class'), fmt: r => `<strong>${r.i}</strong>${r.on ? ' ◀' : ''}` },
          { key: 'r', label: 'VEV', align: 'right', fmt: r => r.hi == null ? `≥ ${fmtPct(r.lo, 1)}` : `${fmtPct(r.lo, 1)} – ${fmtPct(r.hi, 1)}` }
        ], bandsTable(MRM_BANDS, ri.mrm), { dense: true, rowAttr: r => r.on ? 'class="row-sel"' : '' }), { sub: esc(t('ri.bandsSriSub')) })}
        ${card(t('ri.bandsSrri'), table([
          { key: 'i', label: t('ri.class'), fmt: r => `<strong>${r.i}</strong>${r.on ? ' ◀' : ''}` },
          { key: 'r', label: t('ri.weeklyVol'), align: 'right', fmt: r => r.hi == null ? `≥ ${fmtPct(r.lo, 1)}` : `${fmtPct(r.lo, 1)} – ${fmtPct(r.hi, 1)}` }
        ], bandsTable(SRRI_BANDS, ri.srri), { dense: true, rowAttr: r => r.on ? 'class="row-sel"' : '' }))}
      </div>
      ${card(t('ri.inputs'), table([
        { key: 'k', label: '', fmt: r => esc(r[0]) }, { key: 'v', label: '', align: 'right', fmt: r => r[1] }
      ], [
        [t('ri.dailyObs'), fmtNum(ri.dailyObs)], [t('ri.skew'), fmtNum(ri.skew, 3)], [t('ri.kurt'), fmtNum(ri.kurt, 3)],
        [t('ri.varRet'), fmtNum(ri.varReturn, 4)], [t('ri.vev'), fmtPct(ri.vev, 2)], ['SRRI ' + t('ri.weeklyVol'), fmtPct(ri.srriVol, 2)]
      ], { dense: true }))}
      `}
      <p class="footnote">${esc(t('ri.method'))}</p>
    `;

    if (ri) {
      const P = charts.palette();
      const d = ri.rolling.filter(x => x[1] != null);
      const spec = charts.lineSpec(d.map(x => x[0]), [{ name: t('ri.rollingName'), y: d.map(x => x[1]), color: P.series[0] }], { height: 300, area: true });
      const top = Math.max(0.3, ...d.map(x => x[1])) * 1.1;
      spec.layout.yaxis = { ...spec.layout.yaxis, range: [0, top] };
      const edges = [0, ...SRRI_BANDS, top];
      spec.layout.shapes = edges.slice(0, -1).map((lo, i) => ({ type: 'rect', xref: 'paper', x0: 0, x1: 1, y0: lo, y1: edges[i + 1], fillcolor: i % 2 ? 'rgba(127,127,127,0.06)' : 'rgba(0,0,0,0)', line: { width: 0 }, layer: 'below' }));
      spec.layout.annotations = edges.slice(0, -1).map((lo, i) => ({ xref: 'paper', x: 1, xanchor: 'right', y: (lo + Math.min(edges[i + 1], top)) / 2, text: 'SRRI ' + (i + 1), showarrow: false, font: { size: 10, color: P.muted }, _h: Math.min(edges[i + 1], top) - lo })).filter(an => an.y < top && an._h > top * 0.06).map(({ _h, ...an }) => an);
      charts.render('chRi', spec);
    }

    const save = (k, v) => store.update(pp => { pp.risk[k] = v; }, t('nav.riskClass'));
    root.querySelector('#riSrc')?.addEventListener('change', e => save('sriSource', e.target.value));
    root.querySelector('#riCrm')?.addEventListener('change', e => save('crm', +e.target.value));
    root.querySelector('#riRhp')?.addEventListener('change', e => { const x = Math.round(+e.target.value); if (x >= 1 && x <= 20) save('rhp', x); });
  }
};
