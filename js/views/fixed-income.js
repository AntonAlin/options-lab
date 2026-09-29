import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtMoney, fmtPct, fmtNum, fmtDate, empty } from '../ui.js';
import { typeLabel } from '../instruments.js';
import { RATING_BUCKETS } from '../analytics.js';
import * as charts from '../charts.js';

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const { v, fi, alloc } = a;
    const base = p.baseCcy;
    const hasDeriv = v.valid.some(x => x.r.fi && x.r.fi.derivative);
    if (!fi.rows.length && !hasDeriv) {
      root.innerHTML = pageHead(t('nav.fi'), esc(t('fi.sub'))) + empty(esc(t('fi.none')), `<a class="btn" href="#/holdings">${esc(t('nav.holdings'))}</a>`);
      return;
    }
    const ratings = RATING_BUCKETS.map(b => ({ key: b, share: fi.fiMv ? (alloc.rating.find(x => x.key === b)?.value || 0) / fi.fiMv : 0 })).filter(x => x.share > 0);

    root.innerHTML = `
      ${pageHead(t('nav.fi'), esc(t('fi.sub')))}
      <div class="kpi-grid">
        ${kpi(t('fi.weight'), fmtPct(fi.fiWeight, 1), { sub: fmtMoney(fi.fiMv, base, { compact: true }) })}
        ${kpi(t('kpi.ytm'), fmtPct(fi.ytm, 2), { sub: t('fi.ytmSub'), help: t('help.ytm') })}
        ${kpi(t('fi.modDur'), fmtNum(fi.modDur, 2), { sub: t('fi.modDurSub') })}
        ${kpi(t('fi.portDur'), fmtNum(fi.portfolioDuration, 2), { sub: t('fi.portDurSub'), help: t('help.duration') })}
        ${kpi(t('fi.spreadDur'), fmtNum(fi.portfolioSpreadDuration, 2), { sub: t('fi.spreadDurSub'), help: t('help.spreadDur') })}
        ${kpi('DV01', fmtMoney(fi.ir01, base, { compact: true }), { sub: t('fi.dv01Sub'), help: t('help.dv01') })}
        ${kpi('CS01', fmtMoney(fi.cs01, base, { compact: true }), { sub: t('fi.cs01Sub') })}
        ${Number.isFinite(fi.curveSpreadBp) ? kpi(t('fi.curveSpread'), `${fmtNum(fi.curveSpreadBp, 0)} bp`, { sub: t('fi.curveSpreadSub', { p: fmtPct(fi.curveSpreadCover, 0) }), help: t('help.curveSpread') }) : ''}
        ${kpi(t('fi.avgRating'), esc(fi.avgRating || '—'), { sub: t('fi.hySub', { p: fmtPct(fi.highYieldWeight, 1) }) })}
      </div>
      <div class="grid-2">
        ${card(t('fi.maturity'), '<div id="chMat" class="chart"></div>', { sub: esc(t('fi.maturitySub')) })}
        ${card(t('fi.rating'), '<div id="chRat" class="chart"></div>', { sub: esc(t('fi.ratingSub')) })}
      </div>
      <div class="grid-2">
        ${card(t('fi.ladder'), '<div id="chLad" class="chart"></div>', { sub: esc(t('fi.ladderSub', { base })) })}
        ${card(t('fi.byCcy'), table([
          { key: 'c', label: t('col.ccy'), fmt: ([c]) => `<strong>${esc(c)}</strong>` },
          { key: 'd', label: 'DV01', align: 'right', fmt: ([, d]) => fmtMoney(d, base) },
          { key: 'y', label: t('fi.durContrib'), align: 'right', fmt: ([, d]) => fmtNum(v.nav ? -d / v.nav / 1e-4 : 0, 2) }
        ], Object.entries(fi.ir01ByCcy).sort((x, y) => x[1] - y[1]), { dense: true }), { sub: esc(t('fi.byCcySub')) })}
      </div>
      ${card(t('fi.table'), table([
        { key: 'n', label: t('col.name'), fmt: x => `${esc(x.name)}<div class="cell-sub">${esc(typeLabel(x.pos.type))}${x.pos.issuer ? ' · ' + esc(x.pos.issuer) : ''}</div>` },
        { key: 'm', label: t('fi.maturityCol'), fmt: x => fmtDate(x.pos.maturity) },
        { key: 'c', label: t('fi.coupon'), align: 'right', fmt: x => x.pos.coupon != null ? fmtNum(x.pos.coupon, 3) : '—' },
        { key: 'r', label: 'Rating', fmt: x => esc(x.pos.rating || '—') },
        { key: 'y', label: t('kpi.ytm'), align: 'right', fmt: x => fmtPct(x.r.fi.ytm, 2) },
        { key: 'd', label: t('fi.modDurShort'), align: 'right', fmt: x => fmtNum(x.r.fi.modDur, 2) },
        { key: 's', label: t('fi.spreadDurShort'), align: 'right', fmt: x => fmtNum(x.r.fi.spreadDur, 2) },
        { key: 'cv', label: t('fi.convexity'), align: 'right', fmt: x => fmtNum(x.r.fi.convexity, 1) },
        { key: 'w', label: t('col.weight'), align: 'right', fmt: x => fmtPct(x.weight, 2) },
        { key: 'dv', label: 'DV01', align: 'right', fmt: x => fmtMoney(Object.values(x.r.ir01).reduce((s, q) => s + q, 0), '', { compact: true }) }
      ], [...fi.rows, ...v.valid.filter(x => x.r.fi && (x.r.fi.derivative || x.r.fi.fund))].sort((x, y) => (x.r.fi.years ?? 99) - (y.r.fi.years ?? 99)), { dense: true }), { sub: esc(t('fi.tableSub')) })}
    `;
    charts.render('chMat', charts.barVSpec(fi.maturity.map(m => m.key + 'y'), fi.maturity.map(m => m.share), { fmt: 'pct' }));
    charts.render('chRat', charts.barVSpec(ratings.map(r => r.key), ratings.map(r => r.share), { fmt: 'pct' }));
    charts.render('chLad', charts.barVSpec(fi.dv01Ladder.map(m => m.key + 'y'), fi.dv01Ladder.map(m => m.value), { diverging: true }));
  }
};
