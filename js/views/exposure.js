import * as store from '../store.js';
import { t, L, lang } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtMoney, fmtPct, fmtNum, segmented } from '../ui.js';
import { ASSET_CLASSES, REGIONS, typeLabel } from '../instruments.js';
import * as charts from '../charts.js';

const ui = { dim: 'sector' };

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const { v, alloc, fx, conc } = a;
    const base = p.baseCcy;
    const classes = [...new Set([...alloc.assetClass, ...alloc.exposureByClass].filter(x => Math.abs(x.weight) >= 0.0005).map(x => x.key))];
    const mvW = k => alloc.assetClass.find(x => x.key === k)?.weight || 0;
    const exW = k => alloc.exposureByClass.find(x => x.key === k)?.weight || 0;
    const dimLabel = { sector: x => x, region: x => L(REGIONS[x] || { en: x }), country: x => x, type: x => typeLabel(x, lang()), issuer: x => x, strategy: x => x };

    root.innerHTML = `
      ${pageHead(t('nav.exposure'), esc(t('exp.sub')))}
      <div class="kpi-grid">
        ${kpi(t('exp.gross'), fmtPct(v.leverage, 1), { sub: fmtMoney(v.gross, base, { compact: true }), help: t('help.gross') })}
        ${kpi(t('exp.net'), fmtPct(v.nav ? v.netExposure / v.nav : 0, 1), { sub: fmtMoney(v.netExposure, base, { compact: true }), help: t('help.net') })}
        ${kpi(t('exp.cash'), fmtPct(v.nav ? v.cash / v.nav : 0, 1), { sub: fmtMoney(v.cash, base, { compact: true }) })}
        ${kpi(t('exp.top10'), fmtPct(conc.top10, 1), { sub: t('exp.hhi', { h: fmtNum(conc.hhi * 10000, 0) }) })}
        ${kpi(t('exp.effN'), fmtNum(conc.effectiveN, 1), { help: t('help.effN') })}
        ${kpi(t('exp.fxOpen'), fmtPct(fx.totalNetW, 1), { sub: t('kpi.fxOpenSub', { base }) })}
      </div>
      ${card(t('exp.byClass'), '<div id="chClass" class="chart"></div>', { sub: esc(t('exp.byClassSub')) })}
      <div class="grid-2">
        ${card(t('exp.breakdown'), `${segmented('dim', [['sector', t('exp.sector')], ['region', t('exp.region')], ['country', t('exp.country')], ['type', t('col.type')], ['issuer', t('exp.issuer')], ['strategy', t('exp.strategy')]], ui.dim)}<div id="chDim" class="chart"></div>${ui.dim === 'strategy' ? `<p class="muted small">${esc(t('exp.strategyNote'))}</p>` : ''}`)}
        ${card(t('exp.currency'), table([
          { key: 'ccy', label: t('col.ccy'), fmt: r => `<strong>${esc(r.ccy)}</strong>` },
          { key: 'gross', label: t('exp.ccyGross'), align: 'right', fmt: r => fmtPct(r.grossW, 1) },
          { key: 'hedge', label: t('exp.ccyHedge'), align: 'right', fmt: r => fmtPct(v.nav ? r.hedge / v.nav : 0, 1) },
          { key: 'net', label: t('exp.ccyNet'), align: 'right', fmt: r => `<strong>${fmtPct(r.netW, 1)}</strong>` },
          { key: 'ratio', label: t('exp.hedgeRatio'), align: 'right', fmt: r => r.gross ? fmtPct(r.hedgeRatio, 0) : '—' },
          { key: 'amt', label: t('exp.netAmount', { base }), align: 'right', fmt: r => fmtMoney(r.net, '', { compact: true }) }
        ], fx.rows, { dense: true }) + '<div id="chFx" class="chart"></div>', { sub: esc(t('exp.currencySub', { base })) })}
      </div>
      ${card(t('exp.classTable'), table([
        { key: 'k', label: t('exp.assetClass'), fmt: k => `<span class="swatch" style="background:${charts.classColor(k)}"></span>${esc(L(ASSET_CLASSES[k] || { en: k }))}` },
        { key: 'mv', label: t('exp.mvWeight'), align: 'right', fmt: k => fmtPct(mvW(k), 1) },
        { key: 'ex', label: t('exp.netWeight'), align: 'right', fmt: k => fmtPct(exW(k), 1) },
        { key: 'd', label: t('exp.derivOverlay'), align: 'right', fmt: k => fmtPct(exW(k) - mvW(k), 1, { sign: true }) }
      ], classes, { dense: true }))}
    `;

    charts.render('chClass', charts.barHGroupedSpec(classes.map(k => L(ASSET_CLASSES[k] || { en: k })), [
      { name: t('exp.mvWeight'), values: classes.map(mvW) },
      { name: t('exp.netWeight'), values: classes.map(exW) }
    ]));
    const dimData = alloc[ui.dim].slice(0, 15);
    charts.render('chDim', charts.barHSpec(dimData.map(x => ({ label: dimLabel[ui.dim](x.key), value: x.weight, text: fmtPct(x.weight, 1) }))));
    if (fx.rows.length) charts.render('chFx', charts.barHGroupedSpec(fx.rows.map(r => r.ccy), [
      { name: t('exp.ccyGross'), values: fx.rows.map(r => r.grossW) },
      { name: t('exp.ccyNet'), values: fx.rows.map(r => r.netW) }
    ], { height: Math.max(180, 34 * fx.rows.length + 70) }));

    root.onclick = e => { const s = e.target.closest('[data-seg="dim"]'); if (s) { ui.dim = s.dataset.value; app.rerender(); } };
  }
};
