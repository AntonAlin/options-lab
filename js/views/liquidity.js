import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtMoney, fmtPct, fmtNum, selectHtml, segmented, numIn } from '../ui.js';
import { liquidityStress, LST_REDEMPTIONS } from '../insights.js';

const lst = { horizon: 7, stressed: true, custom: '' };
import { typeLabel } from '../instruments.js';
import * as charts from '../charts.js';
import { debounce } from '../util.js';

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const { liq, liqStressed } = a;
    const base = p.baseCcy;
    const label = h => h === 1 ? t('liq.1d') : h === 365 ? t('liq.1y') : t('liq.nd', { n: h });
    const b = h => liq.buckets.find(x => x.h === h);
    const bs = h => liqStressed.buckets.find(x => x.h === h);

    root.innerHTML = `
      ${pageHead(t('nav.liquidity'), esc(t('liq.sub')))}
      <div class="kpi-grid">
        ${kpi(t('liq.1d'), fmtPct(b(1).pct, 0), { sub: t('liq.stressedVal', { p: fmtPct(bs(1).pct, 0) }) })}
        ${kpi(t('liq.nd', { n: 7 }), fmtPct(b(7).pct, 0), { sub: t('liq.stressedVal', { p: fmtPct(bs(7).pct, 0) }) })}
        ${kpi(t('liq.nd', { n: 30 }), fmtPct(b(30).pct, 0), { sub: t('liq.stressedVal', { p: fmtPct(bs(30).pct, 0) }) })}
        ${kpi(t('liq.illiquid'), fmtPct(liq.illiquidPct, 1), { sub: fmtMoney(liq.illiquid, base, { compact: true }), help: t('help.illiquid') })}
      </div>
      <div class="toolbar settings-strip">
        <label class="inline">${esc(t('liq.participation'))} <input type="number" id="part" min="1" max="100" step="1" value="${fmtNum(p.risk.participation, 0).replace(/\s/g, '')}" class="w-80"> %</label>
        <span class="muted small">${esc(t('liq.participationHelp'))}</span>
      </div>
      ${card(t('liq.profile'), '<div id="chLiq" class="chart"></div>', { sub: esc(t('liq.profileSub')) })}
      ${card(t('liq.table'), table([
        { key: 'n', label: t('col.name'), fmt: q => `${esc(q.row.name)}<div class="cell-sub">${esc(typeLabel(q.row.pos.type))}</div>` },
        { key: 'w', label: t('col.weight'), align: 'right', fmt: q => fmtPct(q.row.weight, 2) },
        { key: 'adv', label: t('liq.adv'), align: 'right', fmt: q => q.row.pos.adv ? fmtNum(q.row.pos.adv, 0) : '—' },
        { key: 'd', label: t('liq.days'), align: 'right', fmt: q => `<strong>${fmtNum(q.days, q.days < 10 && q.days % 1 ? 1 : 0)}</strong>` },
        { key: 'b', label: t('liq.basis'), fmt: q => esc(t('liq.basis.' + q.basis)) }
      ], liq.rows, { dense: true, maxRows: 40 }), { sub: esc(t('liq.tableSub')) })}
      ${lstCard(p)}
      <p class="footnote">${esc(t('liq.method'))}</p>
    `;
    charts.render('chLiq', charts.barHGroupedSpec(liq.buckets.map(x => label(x.h)), [
      { name: t('liq.normal'), values: liq.buckets.map(x => x.pct) },
      { name: t('liq.stressed'), values: liqStressed.buckets.map(x => x.pct) }
    ]));
    root.querySelector('#lstH').addEventListener('change', e => { lst.horizon = +e.target.value; app.rerender(); });
    root.querySelector('#lstR').addEventListener('change', e => { lst.custom = e.target.value; app.rerender(); });
    root.onclick = e => { const s = e.target.closest('[data-seg="lstMode"]'); if (s) { lst.stressed = s.dataset.value === 'stressed'; app.rerender(); } };
    root.querySelector('#part').addEventListener('change', debounce(e => {
      const x = +e.target.value;
      if (x > 0 && x <= 100) store.update(pp => { pp.risk.participation = x; }, t('liq.participation'));
    }, 0));
  }
};

// ESMA-style liquidity stress test: redemption shocks against what can be sold in the horizon.
function lstCard(p) {
  const custom = numIn(lst.custom);
  const reds = [...new Set([...LST_REDEMPTIONS, ...(custom > 0 && custom < 100 ? [custom / 100] : [])])].sort((a, b) => a - b);
  const r = liquidityStress(p, { redemptions: reds, horizon: lst.horizon, stressed: lst.stressed });
  const base = p.baseCcy;
  const newB = (after) => after.breaches.filter(id => !r.breachesBefore.includes(id));
  const chips = ids => ids.length ? ids.map(id => `<span class="chip chip-breach">${esc(t('limit.' + id))}</span>`).join(' ') : `<span class="muted">—</span>`;
  return card(t('lst.title'), `
    <div class="toolbar wrap">
      <label class="inline">${esc(t('lst.horizon'))} ${selectHtml('id="lstH"', [1, 3, 5, 7, 30].map(h => [h, t('liq.nd', { n: h })]), lst.horizon)}</label>
      ${segmented('lstMode', [['stressed', t('liq.stressed')], ['normal', t('liq.normal')]], lst.stressed ? 'stressed' : 'normal')}
      <label class="inline">${esc(t('lst.custom'))} <input id="lstR" inputmode="decimal" class="w-80" value="${esc(lst.custom)}" placeholder="15"> %</label>
    </div>
    <div class="kpi-grid">
      ${kpi(t('lst.max'), fmtPct(r.maxRedemption, 1), { sub: t('lst.maxSub', { h: lst.horizon, v: fmtMoney(r.liquid, base, { compact: true }) }), tone: r.maxRedemption < 0.1 ? 'breach' : r.maxRedemption < 0.2 ? 'warn' : 'ok' })}
    </div>
    ${table([
      { key: 'R', label: t('lst.redemption'), fmt: s => `<strong>${fmtPct(s.R, 0)}</strong><div class="cell-sub">${fmtMoney(s.amount, base, { compact: true })}</div>` },
      { key: 'c', label: t('lst.coverage'), align: 'right', fmt: s => `${isFinite(s.coverage) ? fmtNum(s.coverage, 2) + '×' : '∞'}` },
      { key: 'p', label: t('lst.result'), fmt: s => s.pass ? `<span class="chip chip-ok">✓ ${esc(t('lst.pass'))}</span>` : `<span class="chip chip-breach">✕ ${esc(t('lst.fail', { v: fmtMoney(s.shortfall, base, { compact: true }) }))}</span>` },
      { key: 'd', label: t('lst.days'), align: 'right', fmt: s => isFinite(s.daysNeeded) ? fmtNum(s.daysNeeded, s.daysNeeded % 1 ? 1 : 0) : '—' },
      { key: 'wi', label: t('lst.wIlliquid'), align: 'right', fmt: s => fmtPct(s.waterfall.illiquid, 1) },
      { key: 'wc', label: t('lst.wCash'), align: 'right', fmt: s => fmtPct(s.waterfall.cash, 1) },
      { key: 'wm', label: t('lst.wCommit'), align: 'right', fmt: s => fmtPct(s.waterfall.commitment, 1) },
      { key: 'wb', label: t('lst.wBreaches'), fmt: s => chips(newB(s.waterfall)) },
      { key: 'vb', label: t('lst.vBreaches'), fmt: s => chips(newB(s.vertical)) }
    ], r.scenarios, { dense: true })}
    <p class="muted small">${esc(t('lst.help'))}</p>`, { sub: esc(t('lst.sub')), id: 'lst' });
}
