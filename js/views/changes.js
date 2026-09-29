import * as store from '../store.js';
import { t, lang } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtPct, fmtNum, fmtMoney, fmtDate, empty, signCls, segmented, selectHtml, toast, confirmDialog } from '../ui.js';
import { typeLabel } from '../instruments.js';
import { compareSnapshots, realised } from '../insights.js';
import { snapshots, fromFile, saveSnapshot, deleteSnapshot } from '../snapshots.js';
import { metricsTable, rulesTable } from './compare-ui.js';
import * as charts from '../charts.js';
import { isNum, todayISO } from '../util.js';

const ui = { from: '', to: '', filter: 'traded' };
let cache = { key: '', cmp: null, rec: null };

function compute(p, snaps, a, b) {
  const key = [p.id, p.updatedAt, snaps.length, snaps[snaps.length - 1].date, a.date, b.date].join('|');
  if (cache.key !== key) cache = { key, cmp: compareSnapshots(p, a, b), rec: snaps.length >= 3 ? realised(p, snaps) : null };
  return cache;
}

// Values that round to zero print as 0, not -0.00.
const z = x => (Math.abs(x) < 0.005 ? 0 : x);
const zp = x => (Math.abs(x) < 5e-7 ? 0 : x);

const STATUS_TONE = { new: 'ok', added: 'ok', reduced: 'warn', sold: 'breach', held: '' };

export default {
  render(root, app) {
    const p = store.active();
    const snaps = snapshots(p);
    const file = fromFile(p);
    const base = p.baseCcy;
    const saveBtn = `<button class="btn ${snaps.length < 2 ? 'btn-primary' : ''}" data-act="save">${esc(t('chg.save', { d: fmtDate(p.valDate || todayISO()) }))}</button>`;

    if (snaps.length < 2) {
      root.innerHTML = `${pageHead(t('nav.changes'), esc(t('chg.sub')))}
        ${empty(esc(t(snaps.length ? 'chg.needOne' : 'chg.needTwo')), `<div class="btn-row">${saveBtn}<a class="btn" href="#/import">${esc(t('chg.connect'))}</a></div>`)}
        <p class="footnote">${esc(t('chg.howSnapshots'))}</p>`;
      bind(root, app);
      return;
    }

    const dates = snaps.map(s => s.date);
    if (!dates.includes(ui.to)) ui.to = dates[dates.length - 1];
    if (!dates.includes(ui.from) || ui.from >= ui.to) ui.from = dates[Math.max(0, dates.indexOf(ui.to) - 1)];
    const a = snaps.find(s => s.date === ui.from), b = snaps.find(s => s.date === ui.to);
    const { cmp, rec } = compute(p, snaps, a, b);
    const per = cmp.period;
    const rows = per.rows.filter(o => ui.filter === 'all' || o.status !== 'held')
      .sort((x, y) => (Math.abs(y.tradeEffect) + Math.abs(y.priceEffect)) - (Math.abs(x.tradeEffect) + Math.abs(x.priceEffect)));
    const dateOpts = dates.map(d => [d, d]).reverse();
    const counts = per.rows.reduce((m, o) => (m[o.status] = (m[o.status] || 0) + 1, m), {});

    root.innerHTML = `
      ${pageHead(t('nav.changes'), esc(t('chg.sub')), saveBtn)}
      <div class="toolbar wrap">
        <label class="inline">${esc(t('chg.from'))} ${selectHtml('id="chgFrom"', dateOpts.filter(([d]) => d < ui.to), ui.from)}</label>
        <label class="inline">${esc(t('chg.to'))} ${selectHtml('id="chgTo"', dateOpts.filter(([d]) => d > dates[0]), ui.to)}</label>
        <span class="muted small">${esc(t(file ? 'chg.srcFile' : 'chg.srcSaved', { n: snaps.length }))}</span>
      </div>
      <div class="kpi-grid">
        ${kpi(t('chg.return'), fmtPct(per.ret, 2), { tone: signCls(per.ret) === 'neg' ? 'breach' : '', sub: t('chg.returnSub'), help: t('chg.returnHelp') })}
        ${kpi(t('chg.navChange'), fmtMoney(per.vB.nav - per.v0.nav, base, { compact: true }), { sub: `${fmtMoney(per.v0.nav, base, { compact: true })} → ${fmtMoney(per.vB.nav, base, { compact: true })}` })}
        ${kpi(t('chg.flows'), fmtMoney(per.flows, base, { compact: true }), { sub: t('chg.flowsSub'), help: t('chg.flowsHelp') })}
        ${kpi(t('chg.turnover'), fmtPct(per.turnover, 1), { sub: t('chg.turnoverSub', { b: fmtMoney(per.buys, base, { compact: true }), s: fmtMoney(per.sells, base, { compact: true }) }) })}
      </div>
      ${per.unpriced.length ? `<div class="alert alert-warn"><span>${esc(t('chg.unpriced', { list: per.unpriced.map(x => x.name || x.isin || x.ticker).slice(0, 8).join(', ') }))}</span></div>` : ''}
      <div class="grid-2">
        ${card(t('chg.keyFigures'), metricsTable(cmp.before, cmp.after, base, { labels: [fmtDate(a.date), fmtDate(b.date)] }), { sub: esc(t('chg.keyFiguresSub')) })}
        <div>
          ${card(t('chg.limits'), rulesTable(cmp.rules), { sub: esc(t('chg.limitsSub')) })}
          ${card(t('chg.riskMoves'), table([
            { key: 'n', label: t('col.name'), fmt: r => esc(r.name) },
            { key: 'a', label: fmtDate(a.date), align: 'right', fmt: r => fmtPct(r.from, 1) },
            { key: 'b', label: fmtDate(b.date), align: 'right', fmt: r => fmtPct(r.to, 1) },
            { key: 'd', label: t('cmp.change'), align: 'right', fmt: r => `<span class="${r.delta > 0 ? 'neg' : 'pos'}">${r.delta > 0 ? '+' : ''}${fmtNum(r.delta * 100, 1)} pp</span>` }
          ], cmp.riskMoves.filter(r => Math.abs(r.delta) > 0.0005), { dense: true }), { sub: esc(t('chg.riskMovesSub')) })}
        </div>
      </div>
      ${card(t('chg.holdings'), `
        <div class="toolbar wrap">${segmented('chgFilter', [['traded', t('chg.onlyTraded')], ['all', t('chg.all')]], ui.filter)}
          <span class="muted small">${['new', 'added', 'reduced', 'sold'].filter(k => counts[k]).map(k => `${esc(t('chg.st.' + k))}: ${counts[k]}`).join(' · ') || esc(t('chg.noTrades'))}</span></div>
        ${rows.length ? table([
          { key: 'n', label: t('col.name'), fmt: o => `${esc(o.name)}<div class="cell-sub">${esc(typeLabel(o.type, lang()))}</div>` },
          { key: 's', label: t('chg.status'), fmt: o => `<span class="chip ${STATUS_TONE[o.status] ? 'chip-' + STATUS_TONE[o.status] : ''}">${esc(t('chg.st.' + o.status))}</span>` },
          { key: 'q', label: t('chg.qty'), align: 'right', fmt: o => o.status === 'held' ? fmtNum(o.qtyB, 2) : `${o.inA ? fmtNum(o.qtyA, 2) : '—'} → ${o.inB ? fmtNum(o.qtyB, 2) : '—'}` },
          { key: 'w', label: t('col.weight'), align: 'right', fmt: o => `${fmtPct(o.wA, 2)} → <strong>${fmtPct(o.wB, 2)}</strong>` },
          { key: 'dw', label: t('chg.dWeight'), align: 'right', fmt: o => { const d = o.wB - o.wA; return `<span class="${signCls(d)}">${d > 0 ? '+' : ''}${fmtNum(d * 100, 2)} pp</span>`; } },
          { key: 'pe', label: t('chg.priceEffect'), align: 'right', fmt: o => `<span class="${signCls(z(o.priceEffect))}">${fmtMoney(z(o.priceEffect), '', { compact: true })}</span>` },
          { key: 'te', label: t('chg.tradeEffect'), align: 'right', fmt: o => fmtMoney(z(o.tradeEffect), '', { compact: true }) }
        ], rows, { dense: true, maxRows: 150 }) : `<p class="muted small">${esc(t('chg.noTrades'))}</p>`}`, { sub: esc(t('chg.holdingsSub', { base })) })}
      ${rec ? trackRecord(p, rec, base) : card(t('chg.track'), `<p class="muted small">${esc(t('chg.trackNeed'))}</p>`)}
      ${savedList(p)}
      <p class="footnote">${esc(t('chg.method'))}</p>
    `;
    if (rec) {
      const series = [{ name: p.name, y: rec.index.map(x => x - 1) }];
      if (rec.bench) { const bi = [1]; rec.bench.forEach(r => bi.push(bi[bi.length - 1] * (1 + (isNum(r) ? r : 0)))); series.push({ name: p.benchmark, y: bi.map(x => x - 1), dash: 'dot' }); }
      charts.render('chTrack', charts.lineSpec(rec.dates, series, { zero: true }));
      charts.render('chNav', charts.lineSpec(rec.dates, [{ name: t('chg.nav'), y: rec.nav }], { fmt: 'num', area: true, endMarkers: false }));
    }
    bind(root, app);
  }
};

function trackRecord(p, rec, base) {
  const s = rec.stats;
  const top = rec.byHolding.filter(x => zp(x.contrib) > 0).slice(0, 8), bottom = rec.byHolding.filter(x => zp(x.contrib) < 0).slice(-8).reverse();
  // GIPS: returns for periods under a year are not annualised.
  const fullYear = (Date.parse(rec.dates[rec.dates.length - 1]) - Date.parse(rec.dates[0])) / 86400000 >= 365;
  const contribTable = list => table([
    { key: 'n', label: t('col.name'), fmt: r => esc(r.name) },
    { key: 'c', label: t('chg.contrib'), align: 'right', fmt: r => `<span class="${signCls(zp(r.contrib))}">${fmtPct(zp(r.contrib), 2)}</span>` },
    { key: 'p', label: t('chg.pnl', { base }), align: 'right', fmt: r => fmtMoney(z(r.pnl), '', { compact: true }) }
  ], list, { dense: true });
  return `
    ${card(t('chg.track'), `
      <div class="kpi-grid">
        ${kpi(t('chg.trackTotal'), fmtPct(rec.total, 2), { sub: t('chg.trackPeriod', { a: fmtDate(rec.dates[0]), b: fmtDate(rec.dates[rec.dates.length - 1]), n: rec.dates.length }) })}
        ${s && fullYear ? kpi(t('perf.cagr'), fmtPct(s.cagr, 1), { sub: s.bench ? t('perf.vsBench', { b: fmtPct(s.bench.cagr, 1) }) : '' }) : s?.bench ? kpi(t('chg.benchTotal'), fmtPct(s.bench.total, 2), { sub: t('chg.notAnnualised') }) : ''}
        ${s ? kpi(t('perf.vol'), fmtPct(s.vol, 1)) : ''}
        ${s ? kpi(t('perf.maxDD'), fmtPct(s.maxDD, 1)) : ''}
        ${s?.trackingError ? kpi(t('perf.te'), fmtPct(s.trackingError, 1), { sub: `${esc(t('perf.ir'))} ${fmtNum(s.infoRatio, 2)}` }) : ''}
        ${kpi(t('chg.turnoverAnnual'), fmtPct(rec.turnoverAnnual, 0), { help: t('chg.turnoverHelp') })}
        ${kpi(t('chg.flowsTotal'), fmtMoney(rec.flows, base, { compact: true }))}
      </div>
      <div class="grid-2"><div><h3 class="h3">${esc(t('chg.cum'))}</h3><div id="chTrack" class="chart"></div></div><div><h3 class="h3">${esc(t('chg.navFlows'))}</h3><div id="chNav" class="chart"></div></div></div>
      ${!s ? `<p class="muted small">${esc(t('chg.statsNeed'))}</p>` : ''}
      <div class="grid-2"><div><h3 class="h3">${esc(t('chg.topContrib'))}</h3>${top.length ? contribTable(top) : `<p class="muted small">—</p>`}</div><div><h3 class="h3">${esc(t('chg.bottomContrib'))}</h3>${bottom.length ? contribTable(bottom) : `<p class="muted small">—</p>`}</div></div>
      ${rec.unpriced.length ? `<p class="muted small">${esc(t('chg.unpriced', { list: rec.unpriced.slice(0, 8).join(', ') }))}</p>` : ''}
    `, { sub: esc(t('chg.trackSub')) })}`;
}

function savedList(p) {
  const saved = Array.isArray(p.snapshots) ? p.snapshots : [];
  if (!saved.length) return '';
  return card(t('chg.saved'), `<ul class="tpl-list">${[...saved].reverse().map(s => `<li>
      <div><strong>${esc(fmtDate(s.date))}</strong><div class="small muted">${esc(t('chg.savedLine', { n: s.positions.length }))}</div></div>
      <div class="row-actions"><button class="icon-btn sm" data-del="${esc(s.date)}" title="${esc(t('common.delete'))}" aria-label="${esc(t('common.delete'))}">✕</button></div>
    </li>`).join('')}</ul>`, { sub: esc(t('chg.savedSub', { n: 90 })) });
}

function bind(root, app) {
  root.querySelector('#chgFrom')?.addEventListener('change', e => { ui.from = e.target.value; app.rerender(); });
  root.querySelector('#chgTo')?.addEventListener('change', e => { ui.to = e.target.value; app.rerender(); });
  root.onclick = async e => {
    const seg = e.target.closest('[data-seg="chgFilter"]');
    if (seg) { ui.filter = seg.dataset.value; app.rerender(); return; }
    const del = e.target.closest('[data-del]')?.dataset.del;
    if (del && await confirmDialog(t('chg.deleteConfirm', { d: fmtDate(del) }), { danger: true, ok: t('common.delete') })) { deleteSnapshot(del); return; }
    if (e.target.closest('[data-act="save"]')) { const d = saveSnapshot(); toast(t('chg.savedToast', { d: fmtDate(d) })); }
  };
}
