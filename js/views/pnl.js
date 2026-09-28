import * as store from '../store.js';
import { t, lang } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtMoney, fmtNum, fmtPct, fmtDate, selectHtml, segmented, signCls, confirmDialog, toast, openModal, closeModal, numIn } from '../ui.js';
import { typeLabel } from '../instruments.js';
import { PNL_TYPES, TX_SIDES, parseTransactions, transactionsCSVRows, startOfYear } from '../pnl.js';
import { readFile, toCSV, parseCSV } from '../importer.js';
import * as charts from '../charts.js';
import { downloadBlob, slug, loadScript, uid, todayISO, addMonthsISO } from '../util.js';

const ui = { period: 'ytd', txFilter: '' };
const money = (x, o = {}) => `<span class="${signCls(x)}">${fmtMoney(x, '', { compact: true, ...o })}</span>`;

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const base = p.baseCcy;
    const val = a.v.ctx.valDate;
    const from = ui.period === 'ytd' ? startOfYear(val) : ui.period === '12m' ? addMonthsISO(val, -12) : null;
    const pn = a.pnlFor(from);
    const byId = new Map(p.positions.map(x => [x.id, x]));
    const txs = [...p.transactions].filter(tx => !ui.txFilter || tx.posId === ui.txFilter).sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
    const bookRows = new Map(pn.covered.flatMap(r => (r.book ? r.book.rows.map(b => [b.id, b]) : [])));
    const txPositions = p.positions.filter(x => PNL_TYPES.has(x.type));
    const periodLabel = ui.period === 'ytd' ? t('pnl.ytd') : ui.period === '12m' ? t('pnl.m12') : t('pnl.all');

    root.innerHTML = `
      ${pageHead(t('nav.pnl'), esc(t('pnl.sub')), `<button class="btn" data-act="txcsv" ${p.transactions.length ? '' : 'disabled'}>${esc(t('pnl.exportTx'))}</button><button class="btn" data-act="import">${esc(t('pnl.importTx'))}</button><button class="btn btn-primary" data-act="add">+ ${esc(t('pnl.addTx'))}</button>`)}
      <input type="file" id="txFile" accept=".csv,.txt,.tsv,.xlsx,.xls,.json,.xml" hidden>
      <div class="toolbar settings-strip"><span>${esc(t('pnl.period'))}</span>${segmented('period', [['ytd', t('pnl.ytd')], ['12m', t('pnl.m12')], ['all', t('pnl.all')]], ui.period)}
        <span class="muted small">${esc(t('pnl.coverage', { n: pn.covered.length, total: pn.eligible }))}</span></div>
      ${pn.mismatches ? `<div class="alert alert-warn"><span>${esc(t('pnl.mismatch', { n: pn.mismatches }))}</span></div>` : ''}
      ${pn.orphans.length ? `<div class="alert alert-warn"><span>${esc(t('pnl.orphans', { n: pn.orphans.length }))}</span><button class="btn btn-sm" data-act="dropOrphans">${esc(t('pnl.dropOrphans'))}</button></div>` : ''}
      ${!pn.covered.length ? `<div class="alert alert-info"><span>${esc(t('pnl.howto'))}</span></div>` : ''}
      <div class="kpi-grid">
        ${kpi(t('pnl.costBasis'), fmtMoney(pn.tot.costBase, base, { compact: true }), { sub: t('pnl.costBasisSub', { v: fmtMoney(pn.tot.mv, base, { compact: true }) }) })}
        ${kpi(t('pnl.unrealised'), money(pn.tot.unrealised), { sub: `${fmtPct(pn.tot.unrealisedPct, 1, { sign: true })} ${esc(t('pnl.onCost'))}`, tone: pn.tot.unrealised < 0 ? 'warn' : '' })}
        ${kpi(t('pnl.fxEffect'), money(pn.tot.fxEffect), { sub: t('pnl.fxEffectSub'), help: t('pnl.fxHelp') })}
        ${kpi(t('pnl.realisedPeriod', { p: periodLabel }), money(pn.tot.realisedPeriod), { sub: t('pnl.realisedSub', { n: pn.txCount }) })}
        ${kpi(t('pnl.realisedAll'), money(pn.tot.realisedAll), { sub: t('pnl.feesSub', { v: fmtMoney(pn.tot.fees, base, { compact: true }) }) })}
        ${kpi(t('pnl.total'), money(pn.tot.total), { sub: t('pnl.totalSub') })}
      </div>
      ${pn.covered.length ? card(t('pnl.chart'), '<div id="chPnl" class="chart"></div>', { sub: esc(t('pnl.chartSub', { base })) }) : ''}
      ${card(t('pnl.positions'), table([
        { key: 'n', label: t('col.name'), fmt: r => `${esc(r.name)}<div class="cell-sub">${esc(typeLabel(r.pos.type, lang()))} · ${esc(r.pos.ccy || '')}${r.covered ? ` · <span title="${esc(t('pnl.source.' + r.source))}">${esc(t('pnl.src.' + r.source))}</span>` : ''}</div>` },
        { key: 'q', label: t('col.qty'), align: 'right', fmt: r => `${fmtNum(r.qty, 0)}${r.mismatch ? `<div class="cell-sub neg">${esc(t('pnl.bookQty', { n: fmtNum(r.bookQty, 0) }))}</div>` : ''}` },
        { key: 'avg', label: t('pnl.avgCost'), align: 'right', fmt: r => r.covered ? fmtNum(r.avgPerUnit, r.avgPerUnit < 10 ? 4 : 2) : '<span class="muted">—</span>' },
        { key: 'px', label: t('col.price'), align: 'right', fmt: r => fmtNum(r.pos.price, r.pos.price < 10 ? 4 : 2) },
        { key: 'cb', label: t('pnl.costBase', { base }), align: 'right', fmt: r => r.covered ? fmtMoney(r.costBase, '', { compact: true }) : '<span class="muted">—</span>' },
        { key: 'mv', label: t('col.mv', { base }), align: 'right', fmt: r => fmtMoney(r.x.r.mv, '', { compact: true }) },
        { key: 'u', label: t('pnl.unrealised'), align: 'right', fmt: r => r.covered ? `${money(r.unrealised)}<div class="cell-sub ${signCls(r.unrealised)}">${fmtPct(r.unrealisedPct, 1, { sign: true })}</div>` : '<span class="muted">—</span>' },
        { key: 'fx', label: t('pnl.fxShort'), align: 'right', fmt: r => r.covered && Math.abs(r.fxEffect) > 0.5 ? money(r.fxEffect) : '<span class="muted">—</span>' },
        { key: 'r', label: t('pnl.realisedShort', { p: periodLabel }), align: 'right', fmt: r => r.book ? money(r.realisedPeriod) : '<span class="muted">—</span>' },
        { key: 'act', label: '', fmt: r => r.covered && r.source === 'costPrice' ? `<button class="icon-btn sm" data-editcost="${r.pos.id}" title="${esc(t('pnl.editCost'))}" aria-label="${esc(t('pnl.editCost'))}">✎</button>` : !r.covered ? `<button class="btn btn-sm" data-editcost="${r.pos.id}">${esc(t('pnl.setCost'))}</button>` : '' }
      ], pn.rows, { dense: true, rowAttr: r => (r.covered ? '' : 'class="row-info"') }), { sub: esc(t('pnl.positionsSub')) })}
      ${card(t('pnl.transactions'), `
        <div class="toolbar">${selectHtml('id="txFilter"', [['', t('pnl.allPositions')], ...txPositions.map(x => [x.id, x.name])], ui.txFilter)}
          <span class="muted small">${esc(t('hold.showing', { n: txs.length, total: p.transactions.length }))}</span></div>
        ${txs.length ? table([
          { key: 'd', label: t('cf.date'), fmt: tx => `<span class="nowrap">${fmtDate(tx.date)}</span>` },
          { key: 's', label: t('pnl.side'), fmt: tx => `<span class="chip ${tx.side === 'buy' ? 'chip-ok' : 'chip-warn'}">${esc(t('pnl.side.' + tx.side))}</span>` },
          { key: 'n', label: t('col.name'), fmt: tx => esc(byId.get(tx.posId)?.name || '?') },
          { key: 'q', label: t('col.qty'), align: 'right', fmt: tx => fmtNum(tx.qty, tx.qty % 1 ? 2 : 0) },
          { key: 'p', label: t('col.price'), align: 'right', fmt: tx => fmtNum(tx.price, tx.price < 10 ? 4 : 2) },
          { key: 'f', label: t('pnl.fees'), align: 'right', fmt: tx => tx.fees ? fmtNum(tx.fees, 2) : '<span class="muted">—</span>' },
          { key: 'x', label: t('pnl.fxRate'), align: 'right', fmt: tx => tx.fx ? fmtNum(tx.fx, 4) : '<span class="muted">—</span>' },
          { key: 'a', label: t('pnl.qtyAfter'), align: 'right', fmt: tx => bookRows.has(tx.id) ? fmtNum(bookRows.get(tx.id).qtyAfter, 0) : '—' },
          { key: 'r', label: t('pnl.realisedTx', { base }), align: 'right', fmt: tx => bookRows.has(tx.id) && tx.side === 'sell' ? money(bookRows.get(tx.id).realisedBase) : '<span class="muted">—</span>' },
          { key: 'note', label: t('pnl.note'), fmt: tx => esc(tx.note || '') },
          { key: 'act', label: '', fmt: tx => `<div class="row-actions"><button class="icon-btn sm" data-edittx="${tx.id}" aria-label="${esc(t('common.edit'))}">✎</button><button class="icon-btn sm" data-deltx="${tx.id}" aria-label="${esc(t('common.delete'))}">✕</button></div>` }
        ], txs, { dense: true }) : `<p class="muted small">${esc(t('pnl.noTx'))}</p>`}`, { sub: esc(t('pnl.transactionsSub')) })}
      <p class="footnote">${esc(t('pnl.method'))}</p>
    `;

    if (pn.covered.length) {
      const top = [...pn.covered].sort((x, y) => Math.abs(y.unrealised) - Math.abs(x.unrealised)).slice(0, 15);
      charts.render('chPnl', charts.barHSpec(top.map(r => ({ label: r.name, value: r.unrealised, text: fmtMoney(r.unrealised, '', { compact: true }) })), { fmt: 'num', diverging: true }));
    }

    root.querySelector('#txFilter')?.addEventListener('change', e => { ui.txFilter = e.target.value; app.rerender(); });
    root.querySelector('#txFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const data = await readFile(f, loadScript);
        const rows = data.sheets[0].rows;
        const r = parseTransactions(rows, p.positions);
        if (r.error === 'columns') { toast(t('pnl.importColumns'), { tone: 'warn', ms: 7000 }); return; }
        if (!r.txs.length) { toast(t('pnl.importNone', { n: r.unmatched.length }), { tone: 'warn', ms: 7000 }); return; }
        store.update(pp => { pp.transactions.push(...r.txs); }, t('pnl.importTx'));
        toast(t('pnl.imported', { n: r.txs.length, skipped: r.unmatched.length }), { ms: 6000 });
      } catch (err) { console.error(err); toast(t('pnl.importError'), { tone: 'warn' }); }
      e.target.value = '';
    });
    root.onclick = async e => {
      const seg = e.target.closest('[data-seg="period"]');
      if (seg) { ui.period = seg.dataset.value; app.rerender(); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'add') { txDialog(p, txPositions, null); return; }
      if (act === 'import') { root.querySelector('#txFile').click(); return; }
      if (act === 'txcsv') { downloadBlob('﻿' + toCSV(transactionsCSVRows(p), lang() === 'sv' ? ';' : ','), 'text/csv;charset=utf-8', `${slug(p.name)}-transactions.csv`); return; }
      if (act === 'dropOrphans') { store.update(pp => { const ids = new Set(pp.positions.map(x => x.id)); pp.transactions = pp.transactions.filter(tx => ids.has(tx.posId)); }, t('pnl.dropOrphans')); return; }
      const editTx = e.target.closest('[data-edittx]')?.dataset.edittx;
      if (editTx) { txDialog(p, txPositions, p.transactions.find(tx => tx.id === editTx)); return; }
      const delTx = e.target.closest('[data-deltx]')?.dataset.deltx;
      if (delTx) { store.update(pp => { pp.transactions = pp.transactions.filter(tx => tx.id !== delTx); }, t('common.delete')); toast(t('pnl.txDeleted'), { action: () => store.undo(), actionLabel: t('common.undo') }); return; }
      const cost = e.target.closest('[data-editcost]')?.dataset.editcost;
      if (cost) costDialog(p, byId.get(cost));
    };
  }
};

function txDialog(p, positions, tx) {
  const isNew = !tx;
  const d = tx || { posId: positions[0]?.id || '', side: 'buy', date: todayISO(), qty: '', price: '', fees: '', fx: '', note: '' };
  const m = openModal(`<div class="modal-head"><h2>${esc(isNew ? t('pnl.addTx') : t('pnl.editTx'))}</h2></div>
    <form class="modal-body form-grid" id="txForm">
      <label><span>${esc(t('col.name'))}</span>${selectHtml('name="posId" required', positions.map(x => [x.id, x.name]), d.posId)}</label>
      <label><span>${esc(t('pnl.side'))}</span>${selectHtml('name="side"', TX_SIDES.map(s => [s, t('pnl.side.' + s)]), d.side)}</label>
      <label><span>${esc(t('cf.date'))}</span><input type="date" name="date" required value="${esc(d.date)}"></label>
      <label><span>${esc(t('col.qty'))}</span><input name="qty" inputmode="decimal" required value="${d.qty}"></label>
      <label><span>${esc(t('pnl.txPrice'))}</span><input name="price" inputmode="decimal" required value="${d.price}"></label>
      <label><span>${esc(t('pnl.fees'))}</span><input name="fees" inputmode="decimal" value="${d.fees ?? ''}"></label>
      <label><span>${esc(t('pnl.fxRate'))}</span><input name="fx" inputmode="decimal" value="${d.fx ?? ''}" placeholder="${esc(t('pnl.fxPh', { base: p.baseCcy }))}"></label>
      <label><span>${esc(t('pnl.note'))}</span><input name="note" value="${esc(d.note || '')}"></label>
    </form>
    <div class="modal-foot"><button class="btn" data-close>${esc(t('common.cancel'))}</button><button class="btn btn-primary" data-ok>${esc(t('common.save'))}</button></div>`);
  m.querySelector('[data-ok]').addEventListener('click', () => {
    const f = new FormData(m.querySelector('#txForm'));
    const qty = numIn(f.get('qty')), price = numIn(f.get('price')), fees = numIn(f.get('fees')), fx = numIn(f.get('fx'));
    if (!f.get('posId') || !f.get('date') || !(qty > 0) || !(price >= 0)) { toast(t('pnl.txInvalid'), { tone: 'warn' }); return; }
    const rec = { id: isNew ? uid('tx') : tx.id, posId: f.get('posId'), side: f.get('side'), date: f.get('date'), qty, price, fees: fees > 0 ? fees : 0, note: String(f.get('note') || '').trim() };
    if (fx > 0) rec.fx = fx;
    store.update(pp => { pp.transactions = isNew ? [...pp.transactions, rec] : pp.transactions.map(x => (x.id === rec.id ? rec : x)); }, isNew ? t('pnl.addTx') : t('pnl.editTx'));
    closeModal();
    toast(t('pnl.txSaved'));
  });
}

function costDialog(p, pos) {
  const m = openModal(`<div class="modal-head"><h2>${esc(t('pnl.editCost'))}</h2></div>
    <div class="modal-body form-stack">
      <p class="muted small">${esc(t('pnl.costHelp', { name: pos.name, ccy: pos.ccy || p.baseCcy }))}</p>
      <label><span>${esc(t('pnl.avgCost'))}</span><input id="costIn" inputmode="decimal" value="${pos.costPrice ?? ''}"></label>
    </div>
    <div class="modal-foot"><button class="btn" data-close>${esc(t('common.cancel'))}</button><button class="btn btn-primary" data-ok>${esc(t('common.save'))}</button></div>`);
  m.querySelector('[data-ok]').addEventListener('click', () => {
    const x = numIn(m.querySelector('#costIn').value);
    store.update(pp => { const q = pp.positions.find(y => y.id === pos.id); if (q) { if (x == null) delete q.costPrice; else q.costPrice = x; } }, t('pnl.editCost'));
    closeModal();
  });
}
