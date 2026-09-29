import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtPct, fmtNum, fmtMoney, selectHtml, toast, confirmDialog, numIn } from '../ui.js';
import { typeLabel } from '../instruments.js';
import { valuePortfolio } from '../analytics.js';
import { whatIf, sizeOf, posKey } from '../insights.js';
import { metricsTable, rulesTable } from './compare-ui.js';
import { openForm } from './holdings.js';

// Trades survive re-renders but not a reload, and are per portfolio.
const ui = { pf: '', trades: [], cash: 'auto' };
let seq = 0;

export default {
  render(root, app) {
    const p = store.active();
    if (ui.pf !== p.id) Object.assign(ui, { pf: p.id, trades: [], cash: 'auto' });
    // Drop trades on holdings that no longer exist (file refresh, deletion).
    ui.trades = ui.trades.filter(tr => tr.pos || p.positions.some(x => x.id === tr.id));
    const v = app.analysis().v;
    const base = p.baseCcy;
    const rowOf = id => v.valid.find(x => x.pos.id === id);
    const holdings = v.valid.filter(x => x.pos.type !== 'cash').sort((a, b) => a.name.localeCompare(b.name));
    const cashRows = v.valid.filter(x => x.pos.type === 'cash');
    const trades = ui.trades.map(tr => (tr.pos ? { pos: tr.pos } : { id: tr.id, mode: tr.mode, value: tr.mode === 'weight' ? num(tr.value) / 100 : num(tr.value) }));
    const res = trades.length ? whatIf(p, trades, { cashId: ui.cash === 'auto' ? null : ui.cash }) : null;
    const sourced = !!(p.source && p.source.file);

    const tradeRow = (tr, i) => {
      const applied = res?.applied[i];
      if (tr.pos) {
        return `<tr><td>${esc(tr.pos.name || typeLabel(tr.pos.type))}<div class="cell-sub">${esc(t('wi.newInstrument'))} · ${esc(typeLabel(tr.pos.type))}</div></td>
          <td class="r num">—</td><td class="r num">—</td><td>${esc(t('wi.asEntered'))}</td><td class="r num">${fmtNum(sizeOf(tr.pos), 2)}</td>
          <td class="r num">${applied ? fmtMoney(applied.mv, '', { compact: true }) : ''}</td>
          <td><button class="btn btn-sm" data-edit="${tr.k}">${esc(t('common.edit'))}</button> <button class="icon-btn sm" data-rm="${tr.k}" aria-label="${esc(t('common.delete'))}">✕</button></td></tr>`;
      }
      const x = rowOf(tr.id);
      return `<tr>
        <td>${selectHtml(`data-hold="${tr.k}" aria-label="${esc(t('col.name'))}"`, holdings.map(h => [h.pos.id, h.name]), tr.id)}<div class="cell-sub">${x ? esc(typeLabel(x.pos.type)) : ''}</div></td>
        <td class="r num">${x ? fmtNum(sizeOf(x.pos), 2) : ''}</td>
        <td class="r num">${x ? fmtPct(x.weight, 2) : ''}</td>
        <td>${selectHtml(`data-mode="${tr.k}" aria-label="${esc(t('wi.mode'))}"`, [['weight', t('wi.mode.weight')], ['delta', t('wi.mode.delta')], ['qty', t('wi.mode.qty')]], tr.mode)}</td>
        <td class="r"><input data-val="${tr.k}" inputmode="decimal" class="w-110 r" value="${esc(tr.value ?? '')}" aria-label="${esc(t('wi.value'))}">${tr.mode === 'weight' ? ' %' : ''}</td>
        <td class="r num">${applied ? `<span class="${applied.mv > 0 ? '' : 'pos'}">${fmtMoney(applied.mv, '', { compact: true })}</span>` : ''}</td>
        <td><button class="icon-btn sm" data-rm="${tr.k}" aria-label="${esc(t('common.delete'))}">✕</button></td></tr>`;
    };

    const riskMoves = res ? (() => {
      const m = r => new Map(r.risk.byPosition.map(x => [posKey(x.row.pos), { name: x.row.name, pct: x.pct }]));
      const a = m(res.before), b = m(res.after);
      return [...new Set([...a.keys(), ...b.keys()])].map(k => ({ name: (b.get(k) || a.get(k)).name, from: a.get(k)?.pct ?? 0, to: b.get(k)?.pct ?? 0 }))
        .map(r => ({ ...r, d: r.to - r.from })).filter(r => Math.abs(r.d) > 0.0005).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 8);
    })() : [];

    root.innerHTML = `
      ${pageHead(t('nav.whatif'), esc(t('wi.sub')))}
      ${card(t('wi.trades'), `
        ${ui.trades.length ? `<div class="table-wrap"><table class="tbl dense">
          <thead><tr><th>${esc(t('col.name'))}</th><th class="r">${esc(t('wi.size'))}</th><th class="r">${esc(t('col.weight'))}</th><th>${esc(t('wi.mode'))}</th><th class="r">${esc(t('wi.value'))}</th><th class="r">${esc(t('wi.mvChange', { base }))}</th><th></th></tr></thead>
          <tbody>${ui.trades.map(tradeRow).join('')}</tbody></table></div>` : `<p class="muted">${esc(t('wi.empty'))}</p>`}
        <div class="toolbar wrap">
          <button class="btn btn-primary" data-act="add" ${holdings.length ? '' : 'disabled'}>+ ${esc(t('wi.addTrade'))}</button>
          <button class="btn" data-act="new">+ ${esc(t('wi.addNew'))}</button>
          <label class="inline">${esc(t('wi.funding'))} ${selectHtml('id="wiCash"', [['auto', t('wi.cashAuto', { base })], ...cashRows.map(c => [c.pos.id, c.name]), ['', t('wi.cashNone')]], ui.cash)}</label>
          ${ui.trades.length ? `<button class="btn" data-act="clear">${esc(t('wi.clear'))}</button>` : ''}
        </div>
        <p class="muted small">${esc(t('wi.help'))}</p>`)}
      ${res ? `
        <div class="kpi-grid">
          ${kpi(t('wi.cashNeeded'), fmtMoney(res.cashNeeded, base, { compact: true }), { sub: t(res.cashNeeded >= 0 ? 'wi.cashOut' : 'wi.cashIn') })}
          ${kpi(t('cmp.m.var'), fmtPct(res.after.varPct, 2), { sub: t('wi.fromTo', { a: fmtPct(res.before.varPct, 2) }), tone: res.after.varPct > res.before.varPct * 1.0001 ? 'warn' : '' })}
          ${kpi(t('cmp.m.duration'), fmtNum(res.after.duration, 2), { sub: t('wi.fromTo', { a: fmtNum(res.before.duration, 2) }) })}
          ${kpi(t('cmp.m.breaches'), String(res.after.breaches), { sub: t('wi.fromTo', { a: String(res.before.breaches) }), tone: res.after.breaches > res.before.breaches ? 'breach' : res.after.breaches ? 'warn' : 'ok' })}
          ${res.after.cash < 0 ? kpi(t('cmp.m.cash'), fmtPct(res.after.cash, 1), { tone: 'breach', sub: t('wi.overdrawn') }) : ''}
        </div>
        <div class="grid-2">
          ${card(t('wi.impact'), metricsTable(res.before, res.after, base), { sub: esc(t('wi.impactSub')) })}
          <div>
            ${card(t('wi.limits'), rulesTable(res.rules), { sub: esc(t('wi.limitsSub')) })}
            ${card(t('wi.risk'), riskMoves.length ? table([
              { key: 'n', label: t('col.name'), fmt: r => esc(r.name) },
              { key: 'a', label: t('cmp.before'), align: 'right', fmt: r => fmtPct(r.from, 1) },
              { key: 'b', label: t('cmp.after'), align: 'right', fmt: r => fmtPct(r.to, 1) },
              { key: 'd', label: t('cmp.change'), align: 'right', fmt: r => `<span class="${r.d > 0 ? 'neg' : 'pos'}">${r.d > 0 ? '+' : ''}${fmtNum(r.d * 100, 1)} pp</span>` }
            ], riskMoves, { dense: true }) : `<p class="muted small">—</p>`, { sub: esc(t('wi.riskSub')) })}
          </div>
        </div>
        <div class="btn-row end">
          ${sourced ? `<span class="muted small">${esc(t('wi.sourced'))}</span>` : ''}
          <button class="btn btn-primary btn-lg" data-act="apply" ${sourced ? 'disabled' : ''}>${esc(t('wi.apply'))}</button>
        </div>` : ''}
      <p class="footnote">${esc(t('wi.method'))}</p>
    `;

    const find = k => ui.trades.find(tr => tr.k === +k);
    root.querySelectorAll('[data-hold]').forEach(s => s.addEventListener('change', e => { find(e.target.dataset.hold).id = e.target.value; app.rerender(); }));
    root.querySelectorAll('[data-mode]').forEach(s => s.addEventListener('change', e => { const tr = find(e.target.dataset.mode); tr.mode = e.target.value; tr.value = defaultValue(tr, rowOf(tr.id)); app.rerender(); }));
    root.querySelectorAll('[data-val]').forEach(s => s.addEventListener('change', e => { find(e.target.dataset.val).value = e.target.value; app.rerender(); }));
    root.querySelector('#wiCash')?.addEventListener('change', e => { ui.cash = e.target.value; app.rerender(); });
    root.onclick = async e => {
      const rm = e.target.closest('[data-rm]')?.dataset.rm;
      if (rm) { ui.trades = ui.trades.filter(tr => tr.k !== +rm); app.rerender(); return; }
      const ed = e.target.closest('[data-edit]')?.dataset.edit;
      if (ed) { const tr = find(ed); openForm(tr.pos, { onSave: pos => { tr.pos = pos; app.rerender(); } }); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'add') { const x = holdings[0]; const tr = { k: ++seq, id: x.pos.id, mode: 'weight' }; tr.value = defaultValue(tr, x); ui.trades.push(tr); app.rerender(); }
      if (act === 'new') openForm({ type: 'equity', ccy: base }, { onSave: pos => { ui.trades.push({ k: ++seq, pos }); app.rerender(); } });
      if (act === 'clear') { ui.trades = []; app.rerender(); }
      if (act === 'apply' && res && await confirmDialog(t('wi.applyConfirm', { n: ui.trades.length }), { ok: t('wi.apply') })) {
        const positions = res.portfolio.positions;
        store.update(pp => { pp.positions = positions; }, t('nav.whatif'));
        ui.trades = [];
        toast(t('wi.applied'), { action: () => store.undo(), actionLabel: t('common.undo') });
      }
    };
  }
};

const num = x => numIn(x) ?? 0;
function defaultValue(tr, x) {
  if (!x) return '';
  if (tr.mode === 'weight') return String(+(x.weight * 100).toFixed(2));
  if (tr.mode === 'qty') return String(sizeOf(x.pos) ?? 0);
  return '0';
}
