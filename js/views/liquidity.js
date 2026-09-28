import * as store from '../store.js';
import { t, lang } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtMoney, fmtPct, fmtNum } from '../ui.js';
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
        { key: 'n', label: t('col.name'), fmt: q => `${esc(q.row.name)}<div class="cell-sub">${esc(typeLabel(q.row.pos.type, lang()))}</div>` },
        { key: 'w', label: t('col.weight'), align: 'right', fmt: q => fmtPct(q.row.weight, 2) },
        { key: 'adv', label: t('liq.adv'), align: 'right', fmt: q => q.row.pos.adv ? fmtNum(q.row.pos.adv, 0) : '—' },
        { key: 'd', label: t('liq.days'), align: 'right', fmt: q => `<strong>${fmtNum(q.days, q.days < 10 && q.days % 1 ? 1 : 0)}</strong>` },
        { key: 'b', label: t('liq.basis'), fmt: q => esc(t('liq.basis.' + q.basis)) }
      ], liq.rows, { dense: true, maxRows: 40 }), { sub: esc(t('liq.tableSub')) })}
      <p class="footnote">${esc(t('liq.method'))}</p>
    `;
    charts.render('chLiq', charts.barHGroupedSpec(liq.buckets.map(x => label(x.h)), [
      { name: t('liq.normal'), values: liq.buckets.map(x => x.pct) },
      { name: t('liq.stressed'), values: liqStressed.buckets.map(x => x.pct) }
    ]));
    root.querySelector('#part').addEventListener('change', debounce(e => {
      const x = +e.target.value;
      if (x > 0 && x <= 100) store.update(pp => { pp.risk.participation = x; }, t('liq.participation'));
    }, 0));
  }
};
