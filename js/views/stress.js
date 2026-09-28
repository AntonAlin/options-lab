import * as store from '../store.js';
import { t, L, lang } from '../i18n.js';
import { esc, card, pageHead, table, fmtMoney, fmtPct, fmtNum, signCls } from '../ui.js';
import { ASSET_CLASSES, typeLabel } from '../instruments.js';
import { runStress } from '../analytics.js';
import * as charts from '../charts.js';

const ui = { sel: null, custom: { eq: -15, rates: 50, cs: 75, fxAll: 5, cmd: -10, vol: 8 } };

const SHOCKS = [
  ['eq', 'stress.eq', '%', -60, 60, 1],
  ['rates', 'stress.rates', 'bp', -300, 300, 5],
  ['cs', 'stress.cs', 'bp', -200, 600, 5],
  ['fxAll', 'stress.fx', '%', -30, 30, 0.5],
  ['cmd', 'stress.cmd', '%', -60, 60, 1],
  ['vol', 'stress.vol', 'pts', -20, 60, 1]
];

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const { v, stress } = a;
    const base = p.baseCcy;
    const sorted = [...stress].sort((x, y) => x.total - y.total);
    if (!ui.sel || !stress.some(s => s.scenario.id === ui.sel)) ui.sel = sorted[0]?.scenario.id;
    const sel = stress.find(s => s.scenario.id === ui.sel);
    const scen = s => ({ id: 'custom', en: 'Custom', sv: 'Eget', eq: s.eq / 100, rates: s.rates, cs: s.cs, fxAll: s.fxAll / 100, cmd: s.cmd / 100, vol: s.vol });
    const custom = runStress(v, [scen(ui.custom)])[0];
    const shockText = s => [
      s.eq ? `${t('stress.eqShort')} ${fmtPct(s.eq, 0, { sign: true })}` : '', s.rates ? `${t('stress.ratesShort')} ${fmtNum(s.rates, 0)} bp` : '',
      s.cs ? `${t('stress.csShort')} ${fmtNum(s.cs, 0)} bp` : '', s.fxAll ? `FX ${fmtPct(s.fxAll, 0, { sign: true })}` : '',
      s.cmd ? `${t('stress.cmdShort')} ${fmtPct(s.cmd, 0, { sign: true })}` : '', s.vol ? `Vol ${s.vol > 0 ? '+' : ''}${s.vol}` : ''
    ].filter(Boolean).join(' · ');

    const breakdown = res => `
      <div class="grid-2 tight">
        <div><h3 class="h3">${esc(t('stress.byClass'))}</h3>${table([
          { key: 'k', label: t('exp.assetClass'), fmt: ([k]) => esc(L(ASSET_CLASSES[k] || { en: k })) },
          { key: 'v', label: t('col.pnl', { base }), align: 'right', fmt: ([, x]) => `<span class="${signCls(x)}">${fmtMoney(x, '', { compact: true })}</span>` },
          { key: 'p', label: '% NAV', align: 'right', fmt: ([, x]) => `<span class="${signCls(x)}">${fmtPct(v.nav ? x / v.nav : 0, 2, { sign: true })}</span>` }
        ], Object.entries(res.byClass).filter(([, x]) => Math.abs(x) > 0.5).sort((x, y) => x[1] - y[1]), { dense: true })}</div>
        <div><h3 class="h3">${esc(t('stress.worstPos'))}</h3>${table([
          { key: 'n', label: t('col.name'), fmt: q => `${esc(q.row.name)}<div class="cell-sub">${esc(typeLabel(q.row.pos.type, lang()))}</div>` },
          { key: 'v', label: t('col.pnl', { base }), align: 'right', fmt: q => `<span class="${signCls(q.pnl)}">${fmtMoney(q.pnl, '', { compact: true })}</span>` },
          { key: 'p', label: '% NAV', align: 'right', fmt: q => `<span class="${signCls(q.pnl)}">${fmtPct(v.nav ? q.pnl / v.nav : 0, 2, { sign: true })}</span>` }
        ], [...res.per.slice(0, 6), ...res.per.slice(-3).reverse().filter(q => q.pnl > 0)], { dense: true })}</div>
      </div>`;

    root.innerHTML = `
      ${pageHead(t('nav.stress'), esc(t('stress.sub')))}
      <div class="grid-2">
        ${card(t('stress.scenarios'), '<div id="chStress" class="chart"></div>' + table([
          { key: 's', label: t('col.scenario'), fmt: s => `<button class="linkish ${s.scenario.id === ui.sel ? 'strong' : ''}" data-sel="${s.scenario.id}">${esc(L(s.scenario))}</button><div class="cell-sub">${esc(shockText(s.scenario))}</div>` },
          { key: 'v', label: t('col.pnl', { base }), align: 'right', fmt: s => `<span class="${signCls(s.total)}">${fmtMoney(s.total, '', { compact: true })}</span>` },
          { key: 'p', label: '% NAV', align: 'right', fmt: s => `<strong class="${signCls(s.total)}">${fmtPct(s.pct, 2, { sign: true })}</strong>` }
        ], sorted, { dense: true, rowAttr: s => s.scenario.id === ui.sel ? 'class="row-sel"' : '' }), { sub: esc(t('stress.scenariosSub')) })}
        ${card(sel ? L(sel.scenario) : '', sel ? `<p class="big-number ${signCls(sel.total)}">${fmtPct(sel.pct, 2, { sign: true })} <small>${fmtMoney(sel.total, base, { compact: true })}</small></p>${breakdown(sel)}` : '')}
      </div>
      ${card(t('stress.custom'), `
        <div class="shock-grid">${SHOCKS.map(([k, key, unit, min, max, step]) => `
          <label class="shock"><span>${esc(t(key))} <output id="o_${k}">${ui.custom[k] > 0 ? '+' : ''}${ui.custom[k]} ${unit}</output></span>
            <input type="range" min="${min}" max="${max}" step="${step}" value="${ui.custom[k]}" data-shock="${k}" aria-label="${esc(t(key))}"></label>`).join('')}
        </div>
        <div id="customOut"><p class="big-number ${signCls(custom.total)}">${fmtPct(custom.pct, 2, { sign: true })} <small>${fmtMoney(custom.total, base, { compact: true })}</small></p>${breakdown(custom)}</div>
      `, { sub: esc(t('stress.customSub')) })}
      <p class="footnote">${esc(t('stress.method'))}</p>
    `;

    charts.render('chStress', charts.barHSpec(sorted.map(s => ({ label: L(s.scenario), value: s.pct, text: fmtPct(s.pct, 1, { sign: true }) })), { diverging: true }));

    root.onclick = e => { const b = e.target.closest('[data-sel]'); if (b) { ui.sel = b.dataset.sel; app.rerender(); } };
    root.querySelectorAll('[data-shock]').forEach(inp => inp.addEventListener('input', e => {
      const k = e.target.dataset.shock;
      ui.custom[k] = +e.target.value;
      const unit = SHOCKS.find(s => s[0] === k)[2];
      root.querySelector('#o_' + k).textContent = `${ui.custom[k] > 0 ? '+' : ''}${ui.custom[k]} ${unit}`;
      const res = runStress(v, [scen(ui.custom)])[0];
      root.querySelector('#customOut').innerHTML = `<p class="big-number ${signCls(res.total)}">${fmtPct(res.pct, 2, { sign: true })} <small>${fmtMoney(res.total, base, { compact: true })}</small></p>${breakdown(res)}`;
    }));
  }
};
