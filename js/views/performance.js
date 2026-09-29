import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtPct, fmtNum, empty, signCls } from '../ui.js';
import { rollingVol, monthlyReturns } from '../analytics.js';
import * as charts from '../charts.js';
import { isNum } from '../util.js';

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const { perf, risk, bench } = a;
    if (!perf) {
      root.innerHTML = pageHead(t('nav.performance'), esc(t('perf.sub'))) + empty(esc(t('perf.none')), `<a class="btn btn-primary" href="#/history">${esc(t('nav.history'))}</a>`);
      return;
    }
    const hp = risk.hp;
    const dates = hp.dates;
    const B = perf.bench;
    const monthly = monthlyReturns(dates, hp.portfolioRet);
    const years = Object.keys(monthly).sort().reverse();
    const mNames = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2020, i, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }));
    const row = (label, x, b, f = v => fmtPct(v, 2)) => ({ label, x, b, f });
    const stats = [
      row(t('perf.total'), perf.total, B?.total), row(t('perf.cagr'), perf.cagr, B?.cagr), row(t('perf.vol'), perf.vol, B?.vol),
      row(t('perf.sharpe'), perf.sharpe, B?.sharpe, v => fmtNum(v, 2)), row(t('perf.sortino'), perf.sortino, B?.sortino, v => fmtNum(v, 2)),
      row(t('perf.maxDD'), perf.maxDD, B?.maxDD), row(t('perf.calmar'), perf.calmar, B?.calmar, v => fmtNum(v, 2)),
      row(t('perf.var95'), perf.var95, B?.var95), row(t('perf.es95'), perf.es95, B?.es95), row(t('perf.var99'), perf.var99, B?.var99),
      row(t('perf.best'), perf.best, B?.best), row(t('perf.worst'), perf.worst, B?.worst), row(t('perf.hit'), perf.hitRate, B?.hitRate, v => fmtPct(v, 0)),
      row(t('perf.skew'), perf.skew, B?.skew, v => fmtNum(v, 2)), row(t('perf.kurt'), perf.kurt, B?.kurt, v => fmtNum(v, 2))
    ];
    const rel = B ? [
      row(t('perf.beta'), perf.beta, null, v => fmtNum(v, 2)), row(t('perf.corr'), perf.correlation, null, v => fmtNum(v, 2)),
      row(t('perf.alpha'), perf.alpha, null), row(t('perf.te'), perf.trackingError, null), row(t('perf.ir'), perf.infoRatio, null, v => fmtNum(v, 2)),
      row(t('perf.upCap'), perf.upCapture, null, v => fmtPct(v, 0)), row(t('perf.downCap'), perf.downCapture, null, v => fmtPct(v, 0))
    ] : [];

    root.innerHTML = `
      ${pageHead(t('nav.performance'), esc(t('perf.sub')))}
      <div class="alert alert-info">${esc(t('perf.backcast', { c: fmtPct(hp.coverage, 0) }))}</div>
      <div class="kpi-grid">
        ${kpi(t('perf.cagr'), fmtPct(perf.cagr, 1), { sub: B ? t('perf.vsBench', { b: fmtPct(B.cagr, 1) }) : '' , tone: signCls(perf.cagr) === 'neg' ? 'breach' : ''})}
        ${kpi(t('perf.vol'), fmtPct(perf.vol, 1), { sub: B ? t('perf.vsBench', { b: fmtPct(B.vol, 1) }) : '' })}
        ${kpi(t('perf.sharpe'), fmtNum(perf.sharpe, 2), { sub: t('perf.rf', { r: fmtPct((p.risk.riskFree || 0) / 100, 1) }) })}
        ${kpi(t('perf.maxDD'), fmtPct(perf.maxDD, 1))}
        ${B ? kpi(t('perf.te'), fmtPct(perf.trackingError, 1), { sub: `${esc(t('perf.ir'))} ${fmtNum(perf.infoRatio, 2)}` }) : ''}
        ${B ? kpi(t('perf.beta'), fmtNum(perf.beta, 2), { sub: esc(p.benchmark) }) : ''}
      </div>
      ${card(t('perf.cum'), '<div id="chCum" class="chart"></div>', { sub: B ? '' : `<a class="link" href="#/history">${esc(t('perf.pickBench'))}</a>` })}
      <div class="grid-2">
        ${card(t('perf.dd'), '<div id="chDD" class="chart"></div>')}
        ${card(t('perf.rollVol'), '<div id="chRV" class="chart"></div>', { sub: esc(t('perf.rollVolSub')) })}
      </div>
      <div class="grid-2">
        ${card(t('perf.stats'), table([
          { key: 'l', label: '', fmt: r => esc(r.label) },
          { key: 'x', label: t('perf.portfolio'), align: 'right', fmt: r => r.f(r.x) },
          ...(B ? [{ key: 'b', label: p.benchmark, align: 'right', fmt: r => (r.b == null ? '' : r.f(r.b)) }] : [])
        ], [...stats, ...rel], { dense: true }))}
        ${card(t('perf.dist'), '<div id="chHist" class="chart"></div>', { sub: esc(t('perf.distSub')) })}
      </div>
      ${card(t('perf.monthly'), `<div class="table-wrap"><table class="tbl dense monthly"><thead><tr><th></th>${mNames.map(m => `<th class="r">${esc(m)}</th>`).join('')}<th class="r">${esc(t('perf.ytd'))}</th></tr></thead><tbody>
        ${years.map(y => `<tr><th scope="row">${y}</th>${Array.from({ length: 12 }, (_, i) => { const r = monthly[y][i + 1]; return `<td class="r num heat" style="${heat(r)}">${isNum(r) ? fmtPct(r, 1) : ''}</td>`; }).join('')}<td class="r num"><strong class="${signCls(monthly[y].ytd)}">${fmtPct(monthly[y].ytd, 1)}</strong></td></tr>`).join('')}
      </tbody></table></div>`)}
    `;

    const cum = [{ name: p.name, y: perf.nav.map(x => x - 1) }];
    if (bench && B) { let g = 1; cum.push({ name: p.benchmark, y: [0, ...bench.slice(1).map(r => (g *= 1 + (isNum(r) ? r : 0)) - 1)] }); }
    const d = dates.slice(dates.length - cum[0].y.length);
    charts.render('chCum', charts.lineSpec(d, cum, { height: 360, zero: true, area: true, rangeButtons: true }));
    const P = charts.palette();
    charts.render('chDD', charts.lineSpec(d, [{ name: t('perf.dd'), y: perf.drawdown, color: P.neg }], { height: 240, area: 'down' }));
    charts.render('chRV', charts.lineSpec(dates, [{ name: t('perf.rollVol'), y: rollingVol(hp.portfolioRet), color: P.series[1] }], { height: 240, area: true }));
    charts.render('chHist', charts.histogramSpec(hp.portfolioRet, { markers: [{ x: -perf.var95, label: 'VaR 95' }, { x: -perf.var99, label: 'VaR 99' }] }));

  }
};

// Diverging cell tint, capped at ±5 % a month. Text stays in ink colours; the tint is secondary.
function heat(r) {
  if (!isNum(r)) return '';
  const a = Math.min(1, Math.abs(r) / 0.05) * 0.35;
  return `background: ${r >= 0 ? `rgba(42,120,214,${a})` : `rgba(227,73,72,${a})`}`;
}
