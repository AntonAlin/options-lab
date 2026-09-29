// NAV control: reconcile the administrator's NAV, holdings, prices and fees against the platform,
// and keep a log of every break until it is explained or goes away.
import * as store from '../store.js';
import { t, lang } from '../i18n.js';
import { typeLabel } from '../instruments.js';
import { esc, card, pageHead, table, kpi, fmtMoney, fmtNum, fmtPct, fmtDate, selectHtml, signCls, numIn, toast, empty } from '../ui.js';
import { readFile, toCSV } from '../importer.js';
import { valuePortfolio } from '../analytics.js';
import { navPerUnit } from '../fund.js';
import { snapshots } from '../snapshots.js';
import { atSnapshot } from '../insights.js';
import { DEFAULT_NC, MAX_ADMIN_DATES, parseAdminNav, parseAdminHoldings, forPortfolio, reconcileHoldings, reconcileNav, priceChecks, collectBreaks, syncLog } from '../navcontrol.js';
import { downloadBlob, loadScript, slug, isNum } from '../util.js';

const ui = { date: '', holdAll: false, logAll: false };
const KINDS_RUN = { nav: ['nav', 'units', 'fee'], hold: ['holding', 'cash'], price: ['price'] };
const bp = x => (isNum(x) ? `${fmtNum(Math.abs(x) < 0.05 ? 0 : x, 1)} bp` : '—');
const logText = e => (e.code ? `${e.detail} — ${t(e.code)}` : e.detail);
const chip = (tone, label) => `<span class="chip chip-${tone}">${esc(label)}</span>`;
const TONE = { ok: 'ok', break: 'breach', units: 'warn', no_match: 'warn', no_nav: 'warn', qty: 'breach', price: 'breach', value: 'warn', missing_admin: 'breach', missing_own: 'breach', cash: 'breach', fx_missing: 'warn', no_data: 'warn',
  missing: 'breach', nonpositive: 'breach', admin: 'warn', move: 'warn', stale: 'warn', open: 'breach', explained: 'warn', resolved: 'ok' };
const st = (s, prefix = 'nc.st.') => chip(TONE[s] || 'warn', t(prefix + s));

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const base = p.baseCcy;
    const nc = p.navControl;
    const cfg = { ...DEFAULT_NC, ...nc.cfg };
    const navDates = [...new Set(nc.adminNav.map(r => r.date))];
    const holdDates = Object.keys(nc.adminHoldings);
    const dates = [...new Set([...navDates, ...holdDates])].sort().reverse();
    if (!dates.includes(ui.date)) ui.date = dates[0] || '';
    const d = ui.date;

    // The platform's side for the date: today's holdings, or the snapshot for that date.
    const snaps = snapshots(p);
    let v = null, positions = null;
    if (d && d === a.v.ctx.valDate) { v = a.v; positions = p.positions; }
    else if (d) { const s = snaps.find(x => x.date === d); if (s) { v = valuePortfolio(atSnapshot(p, s)); positions = s.positions; } }

    let hold = null, navRec = null, prices = null;
    if (v) {
      const items = nc.adminHoldings[d];
      if (items) hold = reconcileHoldings(v, items, cfg);
      const admRows = nc.adminNav.filter(r => r.date === d);
      if (admRows.length) navRec = reconcileNav(navPerUnit(v, p.fund), admRows, v, hold, cfg);
      prices = priceChecks(positions, d, snaps, hold, cfg);
      // Log what this run found. Written straight to the portfolio: bookkeeping, not an undoable edit.
      const run = [...(navRec?.ok ? KINDS_RUN.nav : []), ...(hold ? KINDS_RUN.hold : []), ...KINDS_RUN.price];
      const res = syncLog(nc.log, d, collectBreaks({ navRec, hold, prices }), run);
      if (res.changed) { nc.log = res.log; store.persist(); }
    }
    const openLog = nc.log.filter(e => e.status === 'open');

    root.innerHTML = `
      ${pageHead(t('nav.navcontrol'), esc(t('nc.sub')))}
      <div class="alert alert-info"><span>${esc(t('nc.honest'))}</span></div>
      ${card(t('nc.files'), `
        <div class="grid-2">
          <div>
            <h3 class="h3">${esc(t('nc.navFile'))}</h3>
            <p class="muted small">${esc(t('nc.navFileHelp'))}</p>
            <p class="small">${navDates.length ? esc(t('nc.loadedNav', { n: nc.adminNav.length, d: navDates.length, f: nc.files.nav || '' })) : `<span class="muted">${esc(t('nc.none'))}</span>`}</p>
            <div class="btn-row">
              <button class="btn btn-sm btn-primary" data-act="navFile">${esc(t('nc.load'))}</button><input type="file" id="ncNav" accept=".csv,.txt,.tsv,.xlsx,.xls" hidden>
              <button class="btn btn-sm" data-act="navTpl">${esc(t('nc.template'))}</button>
              ${navDates.length ? `<button class="btn btn-sm" data-act="navClear">${esc(t('nc.clear'))}</button>` : ''}
            </div>
          </div>
          <div>
            <h3 class="h3">${esc(t('nc.holdFile'))}</h3>
            <p class="muted small">${esc(t('nc.holdFileHelp'))}</p>
            <p class="small">${holdDates.length ? esc(t('nc.loadedHold', { d: holdDates.length, f: nc.files.hold || '' })) : `<span class="muted">${esc(t('nc.none'))}</span>`}</p>
            <div class="btn-row">
              <button class="btn btn-sm btn-primary" data-act="holdFile">${esc(t('nc.load'))}</button><input type="file" id="ncHold" accept=".csv,.txt,.tsv,.xlsx,.xls" hidden>
              <button class="btn btn-sm" data-act="holdTpl">${esc(t('nc.template'))}</button>
              ${holdDates.length ? `<button class="btn btn-sm" data-act="holdClear">${esc(t('nc.clear'))}</button>` : ''}
            </div>
          </div>
        </div>
        <details class="mt"><summary>${esc(t('nc.tolerances'))}</summary>
          <div class="form-grid three mt">${[['navTolBp', 'bp'], ['feeTolBp', 'bp'], ['priceTolBp', 'bp'], ['mvTolBp', 'bp'], ['qtyTol', ''], ['staleDays', t('nc.days')], ['moveScale', '×']].map(([k, u]) => `
            <label><span>${esc(t('nc.cfg.' + k))}</span><span class="with-unit"><input data-cfg="${k}" inputmode="decimal" value="${cfg[k]}"><em>${esc(u)}</em></span></label>`).join('')}
          </div>
        </details>
      `, { sub: esc(t('nc.filesSub')) })}
      ${!dates.length ? empty(esc(t('nc.start'))) : `
      <div class="toolbar wrap">
        <label class="inline">${esc(t('nc.date'))} ${selectHtml('id="ncDate"', dates.map(x => [x, fmtDate(x)]), d)}</label>
        ${!v ? `<span class="neg small">${esc(t('nc.noOwn', { d: fmtDate(d) }))}</span>` : ''}
      </div>
      ${v ? `
      <div class="kpi-grid">
        ${kpi(t('nc.k.nav'), navRec?.ok ? `<span class="${Math.abs(navRec.diffBp) > cfg.navTolBp ? 'neg' : ''}">${bp(navRec.diffBp)}</span>` : '—', { sub: navRec?.ok ? fmtMoney(Math.abs(navRec.diff) < 0.5 ? 0 : navRec.diff, base, { compact: true }) : esc(t('nc.why.' + (navRec?.reason || 'no_admin'))), tone: navRec?.ok ? (navRec.breaks ? 'breach' : 'ok') : '' })}
        ${kpi(t('nc.k.hold'), hold ? fmtNum(hold.breaks, 0) : '—', { sub: hold ? esc(t('nc.k.holdSub', { n: hold.matched })) : esc(t('nc.noHold')), tone: hold ? (hold.breaks ? 'breach' : 'ok') : '' })}
        ${kpi(t('nc.k.prices'), fmtNum(prices.length, 0), { sub: esc(t('nc.k.pricesSub')), tone: prices.some(x => ['missing', 'nonpositive'].includes(x.kind)) ? 'breach' : prices.length ? 'warn' : 'ok' })}
        ${kpi(t('nc.k.fees'), navRec?.ok ? fmtNum(navRec.feeBreaks, 0) : '—', { tone: navRec?.ok ? (navRec.feeBreaks ? 'breach' : 'ok') : '' })}
        ${kpi(t('nc.k.log'), fmtNum(openLog.length, 0), { sub: esc(t('nc.k.logSub')), tone: openLog.length ? 'breach' : 'ok' })}
      </div>
      ${navCard(navRec, base)}
      ${holdCard(hold, base)}
      ${priceCard(prices)}
      ${feeCard(navRec)}` : ''}
      `}
      ${logCard(nc.log, base)}
      <p class="footnote">${esc(t('nc.method'))}</p>
    `;

    // ---- events ----
    const save = fn => store.update(pp => fn(pp.navControl), t('nav.navcontrol'));
    root.querySelector('#ncDate')?.addEventListener('change', e => { ui.date = e.target.value; app.rerender(); });
    root.querySelectorAll('[data-cfg]').forEach(el => el.addEventListener('change', e => {
      const x = numIn(e.target.value);
      save(n => { n.cfg[e.target.dataset.cfg] = isNum(x) && x >= 0 ? x : DEFAULT_NC[e.target.dataset.cfg]; });
    }));
    root.querySelectorAll('[data-logst]').forEach(el => el.addEventListener('change', e => save(n => { const it = n.log.find(x => x.id === e.target.dataset.logst); if (it) { it.status = e.target.value; it.auto = false; it.updatedAt = new Date().toISOString(); } })));
    root.querySelectorAll('[data-logc]').forEach(el => el.addEventListener('change', e => save(n => { const it = n.log.find(x => x.id === e.target.dataset.logc); if (it) { it.comment = e.target.value; it.updatedAt = new Date().toISOString(); } })));
    const readRows = async f => { const r = await readFile(f, loadScript); return r.sheets.find(s => s.rows.length > 1)?.rows || []; };
    root.querySelector('#ncNav').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const r = parseAdminNav(await readRows(f));
        const rows = r.error ? [] : forPortfolio(r.rows, p);
        if (!rows.length) { toast(t('nc.err.' + (r.error || 'no_portfolio')), { tone: 'warn' }); return; }
        save(n => {
          const keyOf = x => x.date + '|' + x.className + '|' + x.ccy;
          const incoming = new Set(rows.map(keyOf));
          n.adminNav = [...n.adminNav.filter(x => !incoming.has(keyOf(x))), ...rows].sort((x, y) => x.date.localeCompare(y.date)).slice(-500);
          n.files.nav = f.name;
        });
        ui.date = rows.map(x => x.date).sort().pop();
        toast(t('nc.loaded', { n: rows.length }));
      } catch (err) { toast(t('nc.err.read'), { tone: 'warn' }); }
    });
    root.querySelector('#ncHold').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const r = parseAdminHoldings(await readRows(f), p.valDate || '');
        if (r.error) { toast(t('nc.err.' + r.error), { tone: 'warn' }); return; }
        const byDate = {};
        for (const [dd, items] of Object.entries(r.byDate)) { const mine = forPortfolio(items, p); if (mine.length) byDate[dd] = mine; }
        if (!Object.keys(byDate).length) { toast(t('nc.err.no_portfolio'), { tone: 'warn' }); return; }
        save(n => {
          const all = { ...n.adminHoldings, ...byDate };
          n.adminHoldings = Object.fromEntries(Object.keys(all).sort().slice(-MAX_ADMIN_DATES).map(k => [k, all[k]]));
          n.files.hold = f.name;
        });
        ui.date = Object.keys(byDate).sort().pop();
        toast(t('nc.loadedDates', { n: Object.keys(byDate).length }));
      } catch (err) { toast(t('nc.err.read'), { tone: 'warn' }); }
    });
    root.onclick = e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'navFile') root.querySelector('#ncNav').click();
      if (act === 'holdFile') root.querySelector('#ncHold').click();
      if (act === 'navClear') save(n => { n.adminNav = []; n.files.nav = ''; });
      if (act === 'holdClear') save(n => { n.adminHoldings = {}; n.files.hold = ''; });
      if (act === 'holdAll') { ui.holdAll = !ui.holdAll; app.rerender(); }
      if (act === 'logAll') { ui.logAll = !ui.logAll; app.rerender(); }
      const day = p.valDate || new Date().toISOString().slice(0, 10);
      if (act === 'navTpl') {
        const cls = p.fund.classes.length ? p.fund.classes : [{ name: 'A', ccy: base, units: 1000000 }];
        const rows = [['Date', 'Portfolio', 'Share class', 'Currency', 'NAV per unit', 'Units', 'Total NAV', 'Management fee', 'Performance fee'], ...cls.map(c => [day, p.name, c.name || 'A', c.ccy || base, '', c.units ?? '', '', '', ''])];
        downloadBlob('﻿' + toCSV(rows, ';'), 'text/csv;charset=utf-8', `admin-nav-${slug(p.name)}.csv`);
      }
      if (act === 'holdTpl') {
        const rows = [['Date', 'Portfolio', 'ISIN', 'Ticker', 'Name', 'Type', 'Quantity', 'Price', 'Currency', 'Market value', `Market value (${base})`],
          ...p.positions.slice(0, 5).map(x => [day, p.name, x.isin || '', x.ticker || '', x.name || '', x.type, x.qty ?? '', x.price ?? '', x.ccy || base, '', ''])];
        downloadBlob('﻿' + toCSV(rows, ';'), 'text/csv;charset=utf-8', `admin-holdings-${slug(p.name)}.csv`);
      }
      if (act === 'logCsv') {
        const rows = [['Date', 'Check', 'Item', 'Detail', 'Value', 'Status', 'Comment', 'First seen', 'Updated'], ...nc.log.map(x => [x.date, t('nc.kind.' + x.kind), x.ref, logText(x), x.value ?? '', t('nc.st.' + x.status), x.comment || '', x.firstSeen, x.updatedAt])];
        downloadBlob('﻿' + toCSV(rows, ';'), 'text/csv;charset=utf-8', `nav-control-log-${slug(p.name)}.csv`);
      }
    };
  }
};

function navCard(rec, base) {
  if (!rec) return card(t('nc.navRec'), `<p class="muted">${esc(t('nc.noNavFile'))}</p>`);
  if (!rec.ok) return card(t('nc.navRec'), `<p class="muted">${esc(t('nc.why.' + rec.reason))}</p>`);
  const cls = table([
    { key: 'n', label: t('navp.className'), fmt: r => esc(r.name) },
    { key: 's', label: t('nc.shadow'), align: 'right', fmt: r => `${fmtNum(r.shadowNav, 4)} ${esc(r.ccy)}` },
    { key: 'a', label: t('nc.admin'), align: 'right', fmt: r => (isNum(r.admNav) ? `${fmtNum(r.admNav, 4)} ${esc(r.ccy)}` : '—') },
    { key: 'd', label: t('nc.diff'), align: 'right', fmt: r => `<span class="${signCls(r.diffBp)}">${bp(r.diffBp)}</span>` },
    { key: 'u', label: t('nc.unitsDiff'), align: 'right', fmt: r => (isNum(r.unitsDiff) ? fmtNum(r.unitsDiff, 2) : '—') },
    { key: 'st', label: t('nc.status'), fmt: r => st(r.status) }
  ], rec.classes, { dense: true });
  const bridge = table([
    { key: 'k', label: '', fmt: r => (r[2] ? `<strong>${esc(r[0])}</strong>` : esc(r[0])) },
    { key: 'v', label: base, align: 'right', fmt: r => `<span class="${r[2] ? 'strong' : signCls(r[1])}">${fmtMoney(r[1])}</span>` }
  ], [
    [t('nc.admTotal'), rec.admTotal, true],
    ...rec.bridge.map(([k, x]) => [t('nc.b.' + k), x]),
    [t('nc.shadowTotal'), rec.shadowTotal, true]
  ], { dense: true });
  return `<div class="grid-2">${card(t('nc.navRec'), cls + (rec.unmatchedAdmin.length ? `<p class="small neg mt">${esc(t('nc.unmatched', { list: rec.unmatchedAdmin.join(', ') }))}</p>` : ''), { sub: esc(t('nc.navRecSub')) })}
    ${card(t('nc.bridge'), bridge, { sub: esc(t('nc.bridgeSub')) })}</div>`;
}

function holdCard(h, base) {
  if (!h) return card(t('nc.holdRec'), `<p class="muted">${esc(t('nc.noHold'))}</p>`);
  const rows = ui.holdAll ? h.rows : h.rows.filter(r => r.status !== 'ok');
  return card(t('nc.holdRec'), `
    ${rows.length ? table([
      { key: 'n', label: t('col.name'), fmt: r => `${esc(r.name)}${r.isin ? `<div class="muted small">${esc(r.isin)}</div>` : ''}` },
      { key: 'q', label: t('nc.qty'), align: 'right', fmt: r => `${fmtNum(r.ownQty, 2)}<div class="muted small">${fmtNum(r.admQty, 2)}</div>` },
      { key: 'p', label: t('nc.price'), align: 'right', fmt: r => `${fmtNum(r.ownPrice, 4)}<div class="muted small">${fmtNum(r.admPrice, 4)}</div>` },
      { key: 'm', label: t('nc.mv', { base }), align: 'right', fmt: r => `${fmtMoney(r.ownMv)}<div class="muted small">${fmtMoney(r.admMv)}${r.approx ? ' *' : ''}</div>` },
      { key: 'd', label: t('nc.diff'), align: 'right', fmt: r => `<span class="${signCls(r.mvDiff)}">${fmtMoney(r.mvDiff)}</span>` },
      { key: 's', label: t('nc.status'), fmt: r => st(r.status) }
    ], rows, { dense: true }) : `<p class="pos">${esc(t('nc.allMatch', { n: h.matched }))}</p>`}
    <p class="muted small">${esc(t('nc.ownAdm'))}</p>
    <div class="btn-row"><button class="btn btn-sm" data-act="holdAll">${esc(ui.holdAll ? t('nc.breaksOnly') : t('nc.showAll'))}</button></div>
    <h3 class="h3 mt">${esc(t('nc.cashRec'))}</h3>
    ${table([
      { key: 'c', label: t('col.ccy'), fmt: r => esc(r.ccy) },
      { key: 'o', label: t('nc.own'), align: 'right', fmt: r => fmtMoney(r.own, '', { d: 2 }) },
      { key: 'a', label: t('nc.admin'), align: 'right', fmt: r => fmtMoney(r.adm, '', { d: 2 }) },
      { key: 'd', label: t('nc.diffBase', { base }), align: 'right', fmt: r => `<span class="${signCls(r.diffBase)}">${fmtMoney(r.diffBase)}</span>` },
      { key: 's', label: t('nc.status'), fmt: r => st(r.status) }
    ], h.cash, { dense: true })}
  `, { sub: esc(t('nc.holdRecSub')) });
}

function priceCard(prices) {
  const detail = r => {
    if (r.kind === 'stale') return esc(t('nc.pd.stale', { d: fmtDate(r.since), n: r.days }));
    if (r.kind === 'move') return esc(t('nc.pd.move', { m: fmtPct(r.move, 1, { sign: true }), p: fmtNum(r.prevPrice, 4), d: fmtDate(r.prevDate), l: fmtPct(r.limit, 0) }));
    if (r.kind === 'admin') return esc(t('nc.pd.admin', { a: fmtNum(r.admPrice, 4), b: fmtNum(r.diffBp, 1) }));
    return esc(t('nc.pd.' + r.kind));
  };
  return card(t('nc.prices'), prices.length ? table([
    { key: 'n', label: t('col.name'), fmt: r => `${esc(r.name)}${r.isin ? `<div class="muted small">${esc(r.isin)}</div>` : ''}` },
    { key: 't', label: t('col.type'), fmt: r => esc(typeLabel(r.type, lang())) },
    { key: 'p', label: t('nc.price'), align: 'right', fmt: r => `${fmtNum(r.price, 4)} ${esc(r.ccy || '')}` },
    { key: 'k', label: t('nc.check'), fmt: r => st(r.kind, 'nc.pk.') },
    { key: 'd', label: t('nc.detail'), fmt: detail }
  ], prices, { dense: true }) : `<p class="pos">${esc(t('nc.pricesOk'))}</p>`, { sub: esc(t('nc.pricesSub')) });
}

function feeCard(rec) {
  if (!rec?.ok) return '';
  return card(t('nc.fees'), table([
    { key: 'n', label: t('navp.className'), fmt: r => esc(r.name) },
    { key: 'm', label: t('nc.mgmt'), align: 'right', fmt: r => `${fmtMoney(r.shadowMgmt)}<div class="muted small">${fmtMoney(r.admMgmt)}</div>` },
    { key: 'md', label: t('nc.diff'), align: 'right', fmt: r => `<span class="${signCls(r.mgmtDiff)}">${fmtMoney(r.mgmtDiff)}</span>` },
    { key: 'p', label: t('nc.perf'), align: 'right', fmt: r => `${fmtMoney(r.shadowPerf)}<div class="muted small">${fmtMoney(r.admPerf)}</div>` },
    { key: 'pd', label: t('nc.diff'), align: 'right', fmt: r => `<span class="${signCls(r.perfDiff)}">${fmtMoney(r.perfDiff)}</span>` },
    { key: 'h', label: t('nc.hurdle'), align: 'right', fmt: r => (r.perfMissingHwm ? `<span class="neg">${esc(t('nc.noHwm'))}</span>` : isNum(r.perfHurdle) ? fmtNum(r.perfHurdle, 4) : '—') },
    { key: 's', label: t('nc.status'), fmt: r => st(r.feeStatus) }
  ], rec.classes.filter(r => r.matched), { dense: true }) + `<p class="muted small">${esc(t('nc.feesNote'))}</p>`, { sub: esc(t('nc.feesSub')) });
}

function logCard(log, base) {
  const rows = ui.logAll ? log : log.filter(e => e.status !== 'resolved');
  return card(t('nc.log'), `
    ${rows.length ? table([
      { key: 'd', label: t('nc.date'), fmt: e => fmtDate(e.date) },
      { key: 'k', label: t('nc.check'), fmt: e => esc(t('nc.kind.' + e.kind)) },
      { key: 'x', label: t('nc.detail'), fmt: e => esc(logText(e)) },
      { key: 's', label: t('nc.status'), fmt: e => `${selectHtml(`data-logst="${esc(e.id)}"`, ['open', 'explained', 'resolved'].map(s => [s, t('nc.st.' + s)]), e.status)}${e.auto && e.status === 'resolved' ? `<div class="muted small">${esc(t('nc.auto'))}</div>` : ''}` },
      { key: 'c', label: t('nc.comment'), fmt: e => `<input data-logc="${esc(e.id)}" value="${esc(e.comment || '')}" placeholder="${esc(t('nc.commentPh'))}">` }
    ], rows, { dense: true, maxRows: 300 }) : `<p class="muted">${esc(t('nc.logEmpty'))}</p>`}
    <div class="btn-row">
      <button class="btn btn-sm" data-act="logAll">${esc(ui.logAll ? t('nc.logOpen') : t('nc.logAll'))}</button>
      ${log.length ? `<button class="btn btn-sm" data-act="logCsv">${esc(t('nc.export'))}</button>` : ''}
    </div>
  `, { sub: esc(t('nc.logSub')) });
}
