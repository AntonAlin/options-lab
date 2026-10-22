import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtPct, fmtNum, empty, signCls } from '../ui.js';
import { rollingVol, rollingWindow, monthlyReturns } from '../analytics.js';
import { perfStatRows, freqWords, spanText, MIN_TAIL_OBS } from '../labels.js';
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
    const w = freqWords(perf.freq);
    const span = spanText(perf);
    const tail = perf.n >= MIN_TAIL_OBS;
    const monthly = monthlyReturns(dates, hp.portfolioRet);
    const years = Object.keys(monthly).sort().reverse();
    const mNames = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2020, i, 1)).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }));
    const FMT = { pct: v => fmtPct(v, 2), pct0: v => fmtPct(v, 0), num: v => fmtNum(v, 2) };
    const rows = perfStatRows(perf);
    const win = rollingWindow(perf.periodsPerYear);
    const rv = rollingVol(hp.portfolioRet, { periodsPerYear: perf.periodsPerYear });

    // Under a year of history the headline is the total return: an annualised figure from four
    // months of data is an extrapolation, not a result (GIPS).
    const headline = perf.annualised
      ? kpi(t('perf.cagr'), fmtPct(perf.cagr, 1), { sub: B ? t('perf.vsBench', { b: fmtPct(B.cagr, 1) }) : '', tone: signCls(perf.cagr) === 'neg' ? 'breach' : '' })
      : kpi(t('perf.total'), fmtPct(perf.total, 2), { sub: esc(t('perf.totalSub', { span })) + (B ? ' · ' + esc(t('perf.vsBench', { b: fmtPct(B.total, 2) })) : ''), tone: signCls(perf.total) === 'neg' ? 'breach' : '' });
    root.innerHTML = `
      ${pageHead(t('nav.performance'), esc(t('perf.sub')))}
      <div class="alert alert-info">${esc(t('perf.backcast', { c: fmtPct(hp.coverage, 0) }))}</div>
      ${perf.annualised ? '' : `<div class="alert alert-info">${esc(t('perf.notAnnualised', { span }))}</div>`}
      <div class="kpi-grid">
        ${headline}
        ${kpi(t('perf.vol'), fmtPct(perf.vol, 1), { sub: B ? t('perf.vsBench', { b: fmtPct(B.vol, 1) }) : perf.freq !== 'daily' ? t('perf.volSub', { n: perf.n, f: w.f.toLowerCase() }) : '' })}
        ${perf.annualised ? kpi(t('perf.sharpe'), fmtNum(perf.sharpe, 2), { sub: t('perf.rf', { r: fmtPct((p.risk.riskFree || 0) / 100, 1) }) }) : ''}
        ${kpi(t('perf.maxDD'), fmtPct(perf.maxDD, 1))}
        ${B ? kpi(t('perf.te'), fmtPct(perf.trackingError, 1), { sub: perf.annualised ? `${esc(t('perf.ir'))} ${fmtNum(perf.infoRatio, 2)}` : '' }) : ''}
        ${B ? kpi(t('perf.beta'), fmtNum(perf.beta, 2), { sub: esc(p.benchmark) }) : ''}
      </div>
      ${card(t('perf.cum'), '<div id="chCum" class="chart"></div>', { sub: B ? '' : `<a class="link" href="#/history">${esc(t('perf.pickBench'))}</a>` })}
      <div class="grid-2">
        ${card(t('perf.dd'), '<div id="chDD" class="chart"></div>')}
        ${card(t('perf.rollVol'), rv ? '<div id="chRV" class="chart"></div>' : `<p class="muted">${esc(t('perf.rollVolShort', { n: 2 * win, ps: w.ps, have: perf.n }))}</p>`, { sub: rv ? esc(t('perf.rollVolSub', { n: win, ps: w.ps })) : '' })}
      </div>
      <div class="grid-2">
        ${card(t('perf.stats'), table([
          { key: 'l', label: '', fmt: r => esc(r.label) },
          { key: 'x', label: t('perf.portfolio'), align: 'right', fmt: r => FMT[r.f](r.x) },
          ...(B ? [{ key: 'b', label: p.benchmark, align: 'right', fmt: r => (r.b == null ? '' : FMT[r.f](r.b)) }] : [])
        ], rows, { dense: true }))}
        ${card(t('perf.dist', w), tail ? '<div id="chHist" class="chart"></div>' : `<p class="muted">${esc(t('perf.distShort', { min: MIN_TAIL_OBS, n: perf.n, ...w }))}</p>`, { sub: tail ? esc(t('perf.distSub')) : '' })}
      </div>
      ${card(t('perf.monthly'), `<div class="table-wrap"><table class="tbl dense monthly"><thead><tr><th></th>${mNames.map(m => `<th class="r">${esc(m)}</th>`).join('')}<th class="r">${esc(t('perf.ytd'))}</th></tr></thead><tbody>
        ${years.map(y => `<tr><th scope="row">${y}</th>${Array.from({ length: 12 }, (_, i) => { const r = monthly[y][i + 1]; return `<td class="r num heat" style="${heat(r)}">${isNum(r) ? fmtPct(r, 1) : ''}</td>`; }).join('')}<td class="r num"><strong class="${signCls(monthly[y].ytd)}">${fmtPct(monthly[y].ytd, 1)}</strong></td></tr>`).join('')}
      </tbody></table></div>`)}
    `;

    const cum = [{ name: p.name, y: perf.nav.map(x => x - 1) }];
    if (bench && B) { let g = 1; cum.push({ name: p.benchmark, y: [0, ...bench.slice(1).map(r => (g *= 1 + (isNum(r) ? r : 0)) - 1)] }); }
    const d = dates.slice(dates.length - cum[0].y.length);
    charts.render('chCum', charts.lineSpec(d, cum, { height: 360, zero: true, area: true, rangeButtons: perf.annualised }));
    const P = charts.palette();
    charts.render('chDD', charts.lineSpec(d, [{ name: t('perf.dd'), y: perf.drawdown, color: P.neg }], { height: 240, area: 'down' }));
    if (rv) charts.render('chRV', charts.lineSpec(dates, [{ name: t('perf.rollVol'), y: rv, color: P.series[1] }], { height: 240, area: true }));
    if (tail) charts.render('chHist', charts.histogramSpec(hp.portfolioRet, { markers: [{ x: -perf.var95, label: 'VaR 95' }, { x: -perf.var99, label: 'VaR 99' }] }));
  }
};

// Diverging cell tint, capped at ±5 % a month. Text stays in ink colours; the tint is secondary.
function heat(r) {
  if (!isNum(r)) return '';
  const a = Math.min(1, Math.abs(r) / 0.05) * 0.35;
  return `background: ${r >= 0 ? `rgba(42,120,214,${a})` : `rgba(227,73,72,${a})`}`;
}
