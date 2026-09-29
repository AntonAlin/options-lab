import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtMoney, fmtPct, fmtNum, segmented } from '../ui.js';
import { typeLabel, ASSET_CLASSES, REGIONS } from '../instruments.js';
import { L } from '../i18n.js';
import { correlationMatrix } from '../analytics.js';
import * as charts from '../charts.js';

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const { v, risk } = a;
    const base = p.baseCcy;
    const P = risk.param, Hs = risk.hist, H = risk.headline;
    const opts = v.valid.filter(x => x.r.option);
    const greeks = {
      delta: opts.reduce((s, x) => s + x.r.net, 0),
      gamma: opts.reduce((s, x) => s + x.r.gamma * 0.01, 0),
      vega: opts.reduce((s, x) => s + x.r.vega, 0),
      theta: opts.reduce((s, x) => s + x.r.option.theta, 0)
    };
    const corr = correlationMatrix(risk.hp);
    const E = risk.ewma, D = risk.drivers;
    // Contributions follow the headline method; the parametric model also gives stand-alone figures.
    const useHist = H !== P;
    const contrib = (useHist ? H : P).byPosition.slice(0, 15);
    const groups = Object.entries(P.byFactorGroup).filter(([, x]) => Math.abs(x) > 1e-9).sort((x, y) => y[1] - x[1]);
    const model = useHist ? H : P;
    const classes = model.byAssetClass.filter(c => Math.abs(c.total) > 1e-9);
    const clsLabel = k => L(ASSET_CLASSES[k] || { en: k });
    const share = x => (model.sigmaAnnual ? x / model.sigmaAnnual : 0);

    root.innerHTML = `
      ${pageHead(t('nav.risk'), esc(t('risk.sub')))}
      <div class="toolbar wrap settings-strip">
        <span>${esc(t('risk.confidence'))}</span>${segmented('conf', [['0.95', '95 %'], ['0.975', '97.5 %'], ['0.99', '99 %']], String(p.risk.confidence))}
        <span>${esc(t('risk.horizon'))}</span>${segmented('hor', [['1', t('risk.1d')], ['10', t('risk.10d')], ['21', t('risk.1m')]], String(p.risk.horizonDays))}
        <span>${esc(t('risk.method'))}</span>${segmented('meth', [['auto', t('method.auto')], ['parametric', t('method.parametric')], ['historical', t('method.historical')], ['ewma', t('method.ewma')]], p.risk.method)}
      </div>
      ${P.unratedAsHy ? `<div class="alert alert-info">${esc(t('risk.unratedHy', { n: P.unratedAsHy }))}</div>` : ''}
      ${['historical', 'ewma'].includes(p.risk.method) && !Hs ? `<div class="alert alert-warn">${esc(t('risk.noHist'))} <a href="#/history">${esc(t('nav.history'))} →</a></div>` : ''}
      <div class="kpi-grid">
        ${kpi(t('risk.varHeadline'), fmtPct(H.varPct, 2), { sub: `${fmtMoney(H.var, base, { compact: true })} · ${esc(t('method.' + H.method))}`, help: t('help.var') })}
        ${kpi(t('risk.es'), fmtPct(H.esPct, 2), { sub: fmtMoney(H.es, base, { compact: true }), help: t('help.es') })}
        ${kpi(t('risk.paramVar'), fmtPct(P.varPct, 2), { sub: t('risk.paramSub') })}
        ${kpi(t('risk.histVar'), Hs ? fmtPct(Hs.varPct, 2) : '—', { sub: Hs ? t('risk.histSub', { n: Hs.obs, c: fmtPct(Hs.coverage, 0) }) : t('risk.noHistShort') })}
        ${kpi(t('risk.ewmaVar'), E ? fmtPct(E.varPct, 2) : '—', { sub: E ? t('risk.ewmaSub', { h: fmtNum(E.halfLife, 0), r: E.vsLongRun ? fmtNum(E.vsLongRun, 2) : '—' }) : t('risk.noHistShort'), help: t('help.ewma') })}
        ${kpi(t('kpi.vol'), fmtPct(H.volPct, 1), { sub: t('kpi.volSub') })}
        ${kpi(t('risk.divBenefit'), fmtPct(P.sigmaAnnual ? P.diversification / (P.sigmaAnnual + P.diversification) : 0, 0), { sub: t('risk.divSub'), help: t('help.div') })}
      </div>
      <div class="grid-2">
        ${card(t('risk.byClass'), '<div id="chClass" class="chart"></div>' + table([
          { key: 'g', label: t('exp.assetClass'), fmt: c => `<span class="swatch" style="background:${charts.classColor(c.key)}"></span>${esc(clsLabel(c.key))}` },
          { key: 'sec', label: t('risk.securities'), align: 'right', fmt: c => fmtPct(v.nav ? c.securities / v.nav : 0, 2) },
          { key: 'der', label: t('risk.derivativesCol'), align: 'right', fmt: c => c.derivatives ? `<span class="${c.derivatives < 0 ? 'pos' : ''}">${fmtPct(v.nav ? c.derivatives / v.nav : 0, 2)}</span>` : '—' },
          { key: 'c', label: t('risk.contribution'), align: 'right', fmt: c => `<strong>${fmtPct(v.nav ? c.total / v.nav : 0, 2)}</strong>` },
          { key: 'p', label: t('risk.share'), align: 'right', fmt: c => fmtPct(share(c.total), 0) },
          ...(useHist ? [] : [{ key: 's', label: t('risk.standalone'), align: 'right', fmt: c => fmtPct(v.nav ? c.standalone / v.nav : 0, 2) }])
        ], classes, { dense: true }) + `<details class="factor-detail"><summary>${esc(t('risk.factorDetail'))}</summary>` + table([
          { key: 'g', label: t('risk.factor'), fmt: ([g]) => esc(t('factor.' + g)) },
          { key: 's', label: t('risk.standalone'), align: 'right', fmt: ([g]) => fmtPct(v.nav ? (P.standalone[g] || 0) / v.nav : 0, 2) },
          { key: 'c', label: t('risk.contribution'), align: 'right', fmt: ([, c]) => fmtPct(v.nav ? c / v.nav : 0, 2) },
          { key: 'p', label: t('risk.share'), align: 'right', fmt: ([, c]) => fmtPct(P.sigmaAnnual ? c / P.sigmaAnnual : 0, 0) }
        ], groups, { dense: true }) + '</details>', { sub: esc(t('risk.byClassSub', { m: t('method.' + model.method) })) })}
        ${card(t('risk.topContrib'), table([
          { key: 'n', label: t('col.name'), fmt: x => `${esc(x.row.name)}<div class="cell-sub">${esc(typeLabel(x.row.pos.type))}</div>` },
          { key: 'w', label: t('col.weight'), align: 'right', fmt: x => fmtPct(x.row.weight, 1) },
          { key: 'c', label: t('risk.contribVol'), align: 'right', fmt: x => fmtPct(v.nav ? x.contrib / v.nav : 0, 2) },
          { key: 'p', label: t('risk.share'), align: 'right', fmt: x => `<span class="${x.pct < 0 ? 'pos' : ''}">${fmtPct(x.pct, 1)}</span>` }
        ], contrib, { dense: true }), { sub: esc(t('risk.topContribSub', { m: t('method.' + model.method) })) })}
      </div>
      <div class="grid-2">
        ${card(t('risk.exposures'), table([
          { key: 'f', label: t('risk.factor'), fmt: ([f]) => esc(factorName(f)) },
          { key: 'e', label: t('risk.sensitivity'), align: 'right', fmt: ([f, e]) => `${fmtMoney(e, base, { compact: true })}<div class="cell-sub">${esc(t('risk.unit.' + f.id.split(':')[0]))}</div>` }
        ], P.factors.map((f, i) => [f, P.exposures[i]]).filter(([, e]) => Math.abs(e) > 1e-6), { dense: true }), { sub: esc(t('risk.exposuresSub')) })}
        ${card(t('risk.options'), opts.length ? `<div class="kpi-grid small">
            ${kpi(t('risk.deltaCash'), fmtMoney(greeks.delta, base, { compact: true }))}
            ${kpi(t('risk.gamma1'), fmtMoney(greeks.gamma, base, { compact: true }), { help: t('help.gamma') })}
            ${kpi(t('risk.vega1'), fmtMoney(greeks.vega, base, { compact: true }))}
            ${kpi(t('risk.theta'), fmtMoney(greeks.theta, base, { compact: true }))}
          </div>` : `<p class="muted">${esc(t('risk.noOptions'))}</p>`)}
      </div>
      ${D ? card(t('risk.drivers'), `<div class="kpi-grid small">
          ${kpi(t('risk.driversTop'), fmtPct(D.top1, 0), { sub: t('risk.driversTopSub') })}
          ${kpi(t('risk.drivers80'), fmtNum(D.n80, 0), { sub: t('risk.drivers80Sub', { n: D.n }) })}
          ${kpi(t('risk.driversEff'), fmtNum(D.effective, 1), { help: t('help.driversEff') })}
          ${kpi(t('risk.driversShrink'), fmtPct(D.shrink, 0), { sub: t('risk.driversObs', { n: D.obs }), help: t('help.shrink') })}
        </div>` + table([
          { key: 'k', label: t('risk.driver'), fmt: c => 'PC' + c.k },
          { key: 's', label: t('risk.driverShare'), align: 'right', fmt: c => `<strong>${fmtPct(c.share, 1)}</strong>` },
          { key: 't', label: t('risk.driverTop'), fmt: c => c.top.map(l => `${esc(l.row.name)} <span class="muted">${l.w < 0 ? '−' : '+'}</span>`).join(', ') }
        ], D.components.slice(0, 5), { dense: true }), { sub: esc(t('risk.driversSub')) }) : ''}
      ${corr && corr.labels.length > 1 ? card(t('risk.corr'), '<div id="chCorr" class="chart"></div>', { sub: esc(t('risk.corrSub')) }) : ''}
      ${card(t('risk.assumptions'), `<p class="muted small">${esc(t('risk.assumptionsBody'))}</p><a class="btn btn-sm" href="#/settings">${esc(t('risk.editAssumptions'))}</a>`)}
    `;

    charts.render('chClass', charts.barHGroupedSpec(classes.map(c => clsLabel(c.key)), [
      { name: t('risk.securities'), values: classes.map(c => share(c.securities)) },
      { name: t('risk.derivativesCol'), values: classes.map(c => share(c.derivatives)) }
    ], { height: Math.max(200, 44 * classes.length + 80) }));
    if (corr && corr.labels.length > 1) charts.render('chCorr', charts.heatmapSpec(corr.labels, corr.matrix));

    root.onclick = e => {
      const s = e.target.closest('[data-seg]');
      if (!s) return;
      const key = { conf: 'confidence', hor: 'horizonDays', meth: 'method' }[s.dataset.seg];
      const val = s.dataset.seg === 'meth' ? s.dataset.value : +s.dataset.value;
      store.update(pp => { pp.risk[key] = val; }, t('nav.risk'));
    };
  }
};

function factorName(f) {
  const [kind, ccy] = f.id.split(':');
  if (kind === 'IR') return t('factor.rates') + ' ' + ccy;
  if (kind === 'FX') return ccy;
  if (kind === 'INF') return t('factor.inflation') + ' ' + ccy;
  if (kind === 'EQ') return t('factor.equity') + ' · ' + L(REGIONS[f.region] || { en: f.region });
  if (kind === 'CS') return t('factor.credit') + ' · ' + t('factor.cs.' + f.bucket);
  return t('factor.' + f.group);
}
