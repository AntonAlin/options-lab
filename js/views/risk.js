import * as store from '../store.js';
import { t, lang } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtMoney, fmtPct, fmtNum, segmented } from '../ui.js';
import { typeLabel } from '../instruments.js';
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
    const contrib = (Hs && H === Hs ? Hs.byPosition : P.byPosition).slice(0, 15);
    const groups = Object.entries(P.byFactorGroup).filter(([, x]) => Math.abs(x) > 1e-9).sort((x, y) => y[1] - x[1]);

    root.innerHTML = `
      ${pageHead(t('nav.risk'), esc(t('risk.sub')))}
      <div class="toolbar wrap settings-strip">
        <span>${esc(t('risk.confidence'))}</span>${segmented('conf', [['0.95', '95 %'], ['0.975', '97.5 %'], ['0.99', '99 %']], String(p.risk.confidence))}
        <span>${esc(t('risk.horizon'))}</span>${segmented('hor', [['1', t('risk.1d')], ['10', t('risk.10d')], ['21', t('risk.1m')]], String(p.risk.horizonDays))}
        <span>${esc(t('risk.method'))}</span>${segmented('meth', [['auto', t('method.auto')], ['parametric', t('method.parametric')], ['historical', t('method.historical')]], p.risk.method)}
      </div>
      ${p.risk.method === 'historical' && !Hs ? `<div class="alert alert-warn">${esc(t('risk.noHist'))} <a href="#/history">${esc(t('nav.history'))} →</a></div>` : ''}
      <div class="kpi-grid">
        ${kpi(t('risk.varHeadline'), fmtPct(H.varPct, 2), { sub: `${fmtMoney(H.var, base, { compact: true })} · ${esc(t('method.' + H.method))}`, help: t('help.var') })}
        ${kpi(t('risk.es'), fmtPct(H.esPct, 2), { sub: fmtMoney(H.es, base, { compact: true }), help: t('help.es') })}
        ${kpi(t('risk.paramVar'), fmtPct(P.varPct, 2), { sub: t('risk.paramSub') })}
        ${kpi(t('risk.histVar'), Hs ? fmtPct(Hs.varPct, 2) : '—', { sub: Hs ? t('risk.histSub', { n: Hs.obs, c: fmtPct(Hs.coverage, 0) }) : t('risk.noHistShort') })}
        ${kpi(t('kpi.vol'), fmtPct(H.volPct, 1), { sub: t('kpi.volSub') })}
        ${kpi(t('risk.divBenefit'), fmtPct(P.sigmaAnnual ? P.diversification / (P.sigmaAnnual + P.diversification) : 0, 0), { sub: t('risk.divSub'), help: t('help.div') })}
      </div>
      <div class="grid-2">
        ${card(t('risk.byFactor'), '<div id="chFactor" class="chart"></div>' + table([
          { key: 'g', label: t('risk.factor'), fmt: ([g]) => esc(t('factor.' + g)) },
          { key: 's', label: t('risk.standalone'), align: 'right', fmt: ([g]) => fmtPct(v.nav ? (P.standalone[g] || 0) / v.nav : 0, 2) },
          { key: 'c', label: t('risk.contribution'), align: 'right', fmt: ([, c]) => fmtPct(v.nav ? c / v.nav : 0, 2) },
          { key: 'p', label: t('risk.share'), align: 'right', fmt: ([, c]) => fmtPct(P.sigmaAnnual ? c / P.sigmaAnnual : 0, 0) }
        ], groups, { dense: true }), { sub: esc(t('risk.byFactorSub')) })}
        ${card(t('risk.topContrib'), table([
          { key: 'n', label: t('col.name'), fmt: x => `${esc(x.row.name)}<div class="cell-sub">${esc(typeLabel(x.row.pos.type, lang()))}</div>` },
          { key: 'w', label: t('col.weight'), align: 'right', fmt: x => fmtPct(x.row.weight, 1) },
          { key: 'c', label: t('risk.contribVol'), align: 'right', fmt: x => fmtPct(v.nav ? x.contrib / v.nav : 0, 2) },
          { key: 'p', label: t('risk.share'), align: 'right', fmt: x => `<span class="${x.pct < 0 ? 'pos' : ''}">${fmtPct(x.pct, 1)}</span>` }
        ], contrib, { dense: true }), { sub: esc(t('risk.topContribSub', { m: t('method.' + (Hs && H === Hs ? 'historical' : 'parametric')) })) })}
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
          </div>` : `<p class="muted">${esc(t('risk.noOptions'))}</p>`, { sub: `<a class="link" href="options-lab.html">${esc(t('risk.openLab'))} ↗</a>` })}
      </div>
      ${corr && corr.labels.length > 1 ? card(t('risk.corr'), '<div id="chCorr" class="chart"></div>', { sub: esc(t('risk.corrSub')) }) : ''}
      ${card(t('risk.assumptions'), `<p class="muted small">${esc(t('risk.assumptionsBody'))}</p><a class="btn btn-sm" href="#/settings">${esc(t('risk.editAssumptions'))}</a>`)}
    `;

    charts.render('chFactor', charts.barHSpec(groups.map(([g, c]) => ({ label: t('factor.' + g), value: P.sigmaAnnual ? c / P.sigmaAnnual : 0, text: fmtPct(P.sigmaAnnual ? c / P.sigmaAnnual : 0, 0) })), { diverging: true }));
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
  return t('factor.' + f.group);
}
