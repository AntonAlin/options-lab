import * as store from '../store.js';
import { t, L } from '../i18n.js';
import { esc, kpi, card, pageHead, fmtMoney, fmtPct, fmtNum, table, statusChip, fmtDate } from '../ui.js';
import { ASSET_CLASSES, typeLabel } from '../instruments.js';
import * as charts from '../charts.js';
import * as filelink from '../filelink.js';
import { backupAge } from '../backup.js';
import { loadDemo, newPortfolioDialog } from '../app.js';
import * as source from '../sourcefile.js';
import { connectFlow } from './source-card.js';

function welcome(root) {
  root.innerHTML = `
    <section class="hero">
      <div class="hero-text">
        <p class="eyebrow">${esc(t('welcome.eyebrow'))}</p>
        <h1>${esc(t('welcome.title'))}</h1>
        <p class="lead">${esc(t('welcome.lead'))}</p>
        <div class="hero-actions">
          <button class="btn btn-primary btn-lg" data-act="demo">${esc(t('welcome.demo'))}</button>
          <button class="btn btn-lg" data-act="new">${esc(t('welcome.new'))}</button>
          <button class="btn btn-lg" data-act="import">${esc(t('welcome.import'))}</button>
          ${source.supported() ? `<button class="btn btn-lg" data-act="connect">${esc(t('welcome.connect'))}</button>` : ''}
        </div>
        <p class="hero-note">${esc(t('welcome.note'))} <a href="#/guide?s=privacy">${esc(t('privacy.more'))}</a> · <a href="#/guide">${esc(t('welcome.guide'))}</a></p>
      </div>
      <ul class="feature-grid">
        ${['instruments', 'upload', 'risk', 'compliance', 'pdf', 'private'].map(k => `
          <li class="feature"><h3>${esc(t('feature.' + k))}</h3><p>${esc(t('feature.' + k + '.body'))}</p></li>`).join('')}
      </ul>
    </section>`;
  root.addEventListener('click', e => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'demo') loadDemo();
    if (a === 'new') newPortfolioDialog();
    if (a === 'connect') connectFlow();
    if (a === 'import') { if (!store.active()) store.addPortfolio(store.newPortfolio({ name: t('pf.defaultName') })); location.hash = '#/import'; }
  });
}

export default {
  noPortfolio: true,
  render(root, app) {
    const p = store.active();
    if (!p) return welcome(root);
    const a = app.analysis();
    const { v, fi, fx, risk, liq, comp, stress, conc, perf, alloc } = a;
    const base = p.baseCcy;
    const H = risk.headline;
    const worst = [...stress].sort((x, y) => x.total - y.total)[0];
    const liq7 = liq.buckets.find(b => b.h === 7);

    const alerts = [];
    if (p.demo) alerts.push(['info', t('dash.alert.demo')]);
    if (!v.valid.length) alerts.push(['info', t('dash.alert.empty')]);
    if (v.errorsCount) alerts.push(['warn', t('dash.alert.errors', { n: v.errorsCount }), 'holdings']);
    if (v.fxMissing.length) alerts.push(['warn', t('dash.alert.fx', { list: v.fxMissing.join(', ') }), 'settings']);
    if (p.fxSource === 'fallback' && v.valid.some(x => x.pos.ccy && x.pos.ccy !== base)) alerts.push(['info', t('dash.alert.fxFallback'), 'settings']);
    if (comp.breaches) alerts.push(['breach', t('dash.alert.breaches', { n: comp.breaches }), 'compliance']);

    root.innerHTML = `
      ${pageHead(p.name, `${esc(t('dash.sub', { date: fmtDate(v.ctx.valDate), n: v.rows.length }))}${p.manager ? ' · ' + esc(p.manager) : ''}`,
        `<a class="btn" href="#/import">${esc(t('nav.import'))}</a><a class="btn btn-primary" href="#/report">${esc(t('dash.exportPdf'))}</a>`)}
      ${alerts.length ? `<div class="alerts">${alerts.map(([tone, msg, link]) => `<div class="alert alert-${tone}"><span>${esc(msg)}</span>${link ? `<a href="#/${link}">${esc(t('common.fix'))} →</a>` : ''}</div>`).join('')}</div>` : ''}
            ${dataAlert(p)}
<div class="kpi-grid">
        ${kpi(t('kpi.nav'), fmtMoney(v.nav, base, { compact: true }), { sub: t('kpi.navSub', { n: v.valid.length }) })}
        ${kpi(t('kpi.var', { c: fmtNum(H.confidence * 100, 0), h: H.horizonDays }), fmtPct(H.varPct, 2), { sub: `${fmtMoney(H.var, base, { compact: true })} · ${esc(t('method.' + H.method))}`, help: t('help.var') })}
        ${kpi(t('kpi.vol'), fmtPct(H.volPct, 1), { sub: t('kpi.volSub'), help: t('help.vol') })}
        ${kpi(t('kpi.commitment'), fmtPct(v.nav ? v.derivCommit / v.nav : 0, 1), { sub: t('kpi.grossSub', { g: fmtPct(v.leverage, 0) }), help: t('help.commitment') })}
        ${kpi(t('kpi.duration'), fmtNum(fi.portfolioDuration, 2), { sub: `${esc(t('kpi.ytm'))} ${fmtPct(fi.ytm, 2)}`, help: t('help.duration') })}
        ${kpi(t('kpi.fxOpen'), fmtPct(fx.totalNetW, 1), { sub: t('kpi.fxOpenSub', { base }), help: t('help.fxOpen') })}
        ${kpi(t('kpi.liq7'), fmtPct(liq7 && liq.assets ? liq7.value / liq.assets : 0, 0), { sub: t('kpi.liq7Sub'), tone: liq7 && liq.assets && liq7.value / liq.assets < 0.7 ? 'warn' : '' })}
        ${kpi(t('kpi.compliance'), comp.breaches ? `<span class="neg">${comp.breaches} ${esc(t('kpi.breaches'))}</span>` : comp.warnings ? `${comp.warnings} ${esc(t('kpi.warnings'))}` : esc(t('kpi.allClear')), { sub: t('kpi.rulesChecked', { n: comp.rules.length }), tone: comp.breaches ? 'breach' : comp.warnings ? 'warn' : 'ok' })}
        ${a.pnl.covered.length ? kpi(t('kpi.unrealised'), `<span class="${a.pnl.tot.unrealised < 0 ? 'neg' : 'pos'}">${fmtMoney(a.pnl.tot.unrealised, base, { compact: true })}</span>`, { sub: `${fmtPct(a.pnl.tot.unrealisedPct, 1, { sign: true })} · ${esc(t('kpi.unrealisedSub', { n: a.pnl.covered.length, total: a.pnl.eligible }))}` }) : ''}
        ${kpi(t('kpi.cf90'), `<span class="${a.cf.next90 < 0 ? 'neg' : ''}">${fmtMoney(a.cf.next90, base, { compact: true })}</span>`, { sub: t('kpi.cf90Sub') })}
        ${a.nav.ok ? kpi(t('kpi.navUnit', { name: a.nav.classes[0].name || a.nav.classes[0].ccy }), `${fmtNum(a.nav.classes[0].navPerUnit, 2)} <small>${esc(a.nav.classes[0].ccy)}</small>`, { sub: a.nav.classes[0].vsLast != null ? `${fmtPct(a.nav.classes[0].vsLast, 2, { sign: true })} ${esc(t('kpi.navUnitSub'))}` : esc(t('kpi.navUnitIndicative')) }) : ''}
      </div>
      <div class="grid-2">
        ${card(t('dash.alloc'), '<div id="chAlloc" class="chart"></div>', { actions: `<a href="#/exposure" class="link">${esc(t('common.details'))} →</a>` })}
        ${card(t('dash.riskContrib'), '<div id="chRisk" class="chart"></div>', { sub: esc(t('dash.riskContribSub')), actions: `<a href="#/risk" class="link">${esc(t('common.details'))} →</a>` })}
      </div>
      <div class="grid-2">
        ${card(t('dash.top10'), table([
          { key: 'name', label: t('col.name'), fmt: x => `<div class="cell-name">${esc(x.name)}</div><div class="cell-sub">${esc(typeLabel(x.pos.type, store.settings().lang))}</div>` },
          { key: 'mv', label: t('col.mv', { base }), align: 'right', fmt: x => fmtMoney(x.r.mv, '', { compact: true }) },
          { key: 'w', label: t('col.weight'), align: 'right', fmt: x => fmtPct(x.weight, 1) }
        ], conc.top10Rows, { dense: true }), { sub: esc(t('dash.top10Sub', { top: fmtPct(conc.top10, 1), n: fmtNum(conc.effectiveN, 1) })) })}
        ${card(t('dash.stress'), table([
          { key: 's', label: t('col.scenario'), fmt: x => esc(L(x.scenario)) },
          { key: 'pnl', label: t('col.pnl', { base }), align: 'right', fmt: x => `<span class="${x.total < 0 ? 'neg' : 'pos'}">${fmtMoney(x.total, '', { compact: true })}</span>` },
          { key: 'pct', label: '% NAV', align: 'right', fmt: x => `<span class="${x.total < 0 ? 'neg' : 'pos'}">${fmtPct(x.pct, 1, { sign: true })}</span>` }
        ], [...stress].sort((x, y) => x.total - y.total).slice(0, 6), { dense: true }), { sub: worst ? esc(t('dash.stressSub', { s: L(worst.scenario), p: fmtPct(worst.pct, 1) })) : '', actions: `<a href="#/stress" class="link">${esc(t('common.details'))} →</a>` })}
      </div>
      ${perf ? card(t('dash.perf'), '<div id="chPerf" class="chart"></div>', { sub: esc(t('dash.perfSub', { r: fmtPct(perf.cagr, 1), v: fmtPct(perf.vol, 1), s: fmtNum(perf.sharpe, 2) })), actions: `<a href="#/performance" class="link">${esc(t('common.details'))} →</a>` })
        : card(t('dash.perf'), `<div class="empty"><p>${esc(t('dash.noHistory'))}</p><a class="btn" href="#/history">${esc(t('nav.history'))}</a></div>`)}
      ${card(t('dash.compliance'), `<ul class="rule-list">${comp.rules.map(r => `<li>${statusChip(r.status)}<span>${esc(t('limit.' + r.id))}</span><span class="num">${fmtNum(r.value, 1)} % / ${r.dir === 'max' ? '≤' : '≥'} ${fmtNum(r.limit, 1)} %</span></li>`).join('')}</ul>`, { actions: `<a href="#/compliance" class="link">${esc(t('common.details'))} →</a>` })}
    `;

    // Donut for the headline allocation (long positions only — a donut cannot show negatives).
    const allocItems = alloc.assetClass.filter(x => x.weight >= 0.0005);
    charts.render('chAlloc', charts.donutSpec(allocItems.map(x => ({ label: `${L(ASSET_CLASSES[x.key] || { en: x.key })}  ${fmtPct(x.weight, 1)}`, value: x.value, color: charts.classColor(x.key) })),
      { center: fmtMoney(v.nav, '', { compact: true }), centerSub: `${t('kpi.nav')} · ${base}`, height: 290 }));
    const rm = risk.headline.byAssetClass ? risk.headline : risk.param;
    const classes = rm.byAssetClass.filter(c => Math.abs(c.total) > 1e-9);
    charts.render('chRisk', charts.barHSpec(classes.map(c => ({ label: L(ASSET_CLASSES[c.key] || { en: c.key }), value: rm.sigmaAnnual ? c.total / rm.sigmaAnnual : 0, text: fmtPct(rm.sigmaAnnual ? c.total / rm.sigmaAnnual : 0, 0), color: charts.classColor(c.key) })), { diverging: true }));
    if (perf) {
      const dates = risk.hp.dates;
      const series = [{ name: p.name, y: perf.nav.map(x => x - 1) }];
      if (a.bench && perf.bench) {
        let g = 1;
        series.push({ name: p.benchmark, y: [0, ...a.bench.slice(1).map(r => (g *= 1 + (Number.isFinite(r) ? r : 0)) - 1)] });
      }
      charts.render('chPerf', charts.lineSpec(dates.slice(dates.length - series[0].y.length), series, { height: 280, zero: true, area: true, rangeButtons: true }));
    }
  }
};

// One line on where the data lives until a file is linked or a fresh backup exists.
function dataAlert(p) {
  if (p.demo || !p.positions.length) return '';
  const fs = filelink.getStatus();
  if (fs.state === 'linked') return '';
  const age = backupAge();
  if (age != null && age < 7) return '';
  return `<div class="alert alert-info"><span>${esc(fs.state === 'unsupported' ? t('dash.dataUnsupported') : t('dash.dataWhere'))}</span><a class="btn btn-sm btn-primary" href="#/settings">${esc(t('nav.settings'))} →</a></div>`;
}
