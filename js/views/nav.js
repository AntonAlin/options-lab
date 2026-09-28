import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtMoney, fmtNum, fmtPct, fmtDate, selectHtml, statusChip, signCls } from '../ui.js';
import { simulateFlow } from '../fund.js';
import { uid, todayISO } from '../util.js';

const ui = { classId: '', amount: '', pct: null };
const numIn = s => parseFloat(String(s).replace(/[\s  ]/g, '').replace(',', '.'));

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const base = p.baseCcy;
    const f = p.fund;
    const nav = a.nav;
    if (!ui.classId || !f.classes.some(c => c.id === ui.classId)) ui.classId = f.classes[0]?.id || '';
    const amount = ui.pct != null ? ui.pct * a.v.nav : numIn(ui.amount);
    const sim = nav.ok && Number.isFinite(amount) && amount !== 0 ? simulateFlow(p, nav, ui.classId, amount) : null;
    const ccyOpts = store.CURRENCIES.map(c => [c, c]);

    root.innerHTML = `
      ${pageHead(t('nav.nav'), esc(t('navp.sub')))}
      <div class="alert alert-info"><span>${esc(t('navp.honest'))}</span></div>
      ${card(t('navp.classes'), `
        <div class="table-wrap"><table class="tbl dense class-tbl">
          <thead><tr><th>${esc(t('navp.className'))}</th><th>${esc(t('col.ccy'))}</th><th class="r">${esc(t('navp.units'))}</th><th class="r">${esc(t('navp.lastNav'))}</th><th>${esc(t('navp.lastNavDate'))}</th><th class="r">${esc(t('navp.fee'))}</th><th></th></tr></thead>
          <tbody>${f.classes.map(c => `<tr>
            <td><input data-cls="${c.id}" data-k="name" value="${esc(c.name || '')}" placeholder="A SEK"></td>
            <td>${selectHtml(`data-cls="${c.id}" data-k="ccy"`, ccyOpts, c.ccy || base)}</td>
            <td class="r"><input data-cls="${c.id}" data-k="units" inputmode="decimal" class="num-in" value="${c.units ?? ''}"></td>
            <td class="r"><input data-cls="${c.id}" data-k="lastNav" inputmode="decimal" class="num-in" value="${c.lastNav ?? ''}"></td>
            <td><input type="date" data-cls="${c.id}" data-k="lastNavDate" value="${esc(c.lastNavDate || '')}"></td>
            <td class="r"><input data-cls="${c.id}" data-k="feePct" inputmode="decimal" class="num-in sm" value="${c.feePct ?? ''}"></td>
            <td><button class="icon-btn sm" data-delcls="${c.id}" aria-label="${esc(t('common.delete'))}">✕</button></td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="btn-row"><button class="btn btn-sm" data-act="addcls">+ ${esc(t('navp.addClass'))}</button></div>
        <div class="form-grid three mt">
          <label><span>${esc(t('navp.liabilities', { base }))}</span><input data-fund="liabilities" inputmode="decimal" value="${f.liabilities || ''}" placeholder="0"></label>
          <label><span>${esc(t('navp.receivables', { base }))}</span><input data-fund="receivables" inputmode="decimal" value="${f.receivables || ''}" placeholder="0"></label>
          <label><span>${esc(t('navp.feeFrom'))}</span><input type="date" data-fund="feeFrom" value="${esc(f.feeFrom || '')}"></label>
        </div>
      `, { sub: esc(t('navp.classesSub')) })}
      ${!nav.ok ? `<div class="empty"><p>${esc(t('navp.why.' + nav.reason))}</p></div>` : `
      <div class="kpi-grid">
        ${nav.classes.map(c => kpi(t('navp.navPerUnit', { name: c.name || c.ccy }), `${fmtNum(c.navPerUnit, 4)} <small>${esc(c.ccy)}</small>`, {
          sub: c.vsLast != null ? `<span class="${signCls(c.vsLast)}">${fmtPct(c.vsLast, 2, { sign: true })}</span> ${esc(t('navp.vsLast', { d: c.lastNavDate ? fmtDate(c.lastNavDate) : '' }))}` : esc(t('navp.noLast'))
        })).join('')}
        ${kpi(t('navp.accrued'), fmtMoney(nav.accruedFees, base, { compact: true }), { sub: t('navp.accruedSub', { d: fmtNum(nav.feeDays, 0) }) })}
        ${kpi(t('navp.net'), fmtMoney(nav.net, base, { compact: true }), { sub: t('navp.netSub') })}
      </div>
      <div class="grid-2">
        ${card(t('navp.bridge'), table([
          { key: 'k', label: '', fmt: r => r[2] ? `<strong>${esc(r[0])}</strong>` : esc(r[0]) },
          { key: 'v', label: base, align: 'right', fmt: r => `<span class="${r[2] ? 'strong' : signCls(r[1])}">${fmtMoney(r[1])}</span>` }
        ], [
          [t('navp.gross'), nav.gross, true], [t('navp.minusLiab'), -nav.liabilities], [t('navp.plusRec'), nav.receivables],
          [t('navp.minusFees'), -nav.accruedFees], [t('navp.net'), nav.net, true]
        ], { dense: true }))}
        ${card(t('navp.perClass'), table([
          { key: 'n', label: t('navp.className'), fmt: c => esc(c.name || c.ccy) },
          { key: 's', label: t('navp.share'), align: 'right', fmt: c => fmtPct(c.share, 1) },
          { key: 'u', label: t('navp.units'), align: 'right', fmt: c => fmtNum(c.units, 2) },
          { key: 'f', label: t('navp.feeDay'), align: 'right', fmt: c => fmtMoney(c.feePerDay, '', { compact: true }) },
          { key: 'v', label: t('navp.navUnit'), align: 'right', fmt: c => `<strong>${fmtNum(c.navPerUnit, 4)}</strong> ${esc(c.ccy)}` }
        ], nav.classes, { dense: true }), { sub: esc(t('navp.perClassSub')) })}
      </div>
      ${card(t('navp.sim'), `
        <div class="toolbar wrap">
          ${nav.classes.length > 1 ? `<label class="inline">${esc(t('navp.className'))} ${selectHtml('id="simCls"', nav.classes.map(c => [c.id, c.name || c.ccy]), ui.classId)}</label>` : ''}
          <label class="inline">${esc(t('navp.amount', { base }))} <input id="simAmt" inputmode="decimal" value="${ui.pct != null ? '' : esc(ui.amount)}" placeholder="${esc(t('navp.amountPh'))}" class="w-160"></label>
          <span class="muted small">${esc(t('navp.quick'))}</span>
          ${[-0.2, -0.1, -0.05, 0.05, 0.1].map(x => `<button class="btn btn-sm ${ui.pct === x ? 'btn-primary' : ''}" data-pct="${x}">${x > 0 ? '+' : ''}${fmtNum(x * 100, 0)} %</button>`).join('')}
        </div>
        ${sim ? `
          <div class="kpi-grid small">
            ${kpi(sim.amountBase < 0 ? t('navp.redemption') : t('navp.subscription'), `<span class="${signCls(sim.amountBase)}">${fmtMoney(sim.amountBase, base, { compact: true })}</span>`, { sub: fmtPct(a.v.nav ? sim.amountBase / a.v.nav : 0, 1, { sign: true }) + ' NAV' })}
            ${kpi(t('navp.unitsChange'), fmtNum(sim.unitsDelta, 2), { sub: t('navp.unitsAfter', { n: fmtNum(sim.unitsAfter, 2) }) })}
            ${kpi(t('navp.cashAfter'), `<span class="${sim.overdraft ? 'neg' : ''}">${fmtMoney(sim.cashAfter, base, { compact: true })}</span>`, { sub: fmtPct(sim.cashPctAfter, 1) + ' NAV', tone: sim.overdraft ? 'breach' : '' })}
            ${sim.amountBase < 0 ? kpi(t('navp.coverage'), sim.coveredByCash ? esc(t('navp.coveredCash')) : sim.coveredByLiquid1d ? esc(t('navp.coveredLiquid')) : esc(t('navp.notCovered')), { tone: sim.coveredByCash ? 'ok' : sim.coveredByLiquid1d ? 'warn' : 'breach', sub: t('navp.liquid1d', { v: fmtMoney(sim.liquid1d, base, { compact: true }) }) }) : ''}
          </div>
          ${table([
            { key: 'r', label: t('comp.rule'), fmt: r => esc(t('limit.' + r.id)) },
            { key: 'b', label: t('navp.before'), align: 'right', fmt: r => { const o = sim.rulesBefore.rules.find(x => x.id === r.id); return `${fmtNum(o?.value, 2)} % ${o ? statusChip(o.status) : ''}`; } },
            { key: 'a', label: t('navp.after'), align: 'right', fmt: r => `${fmtNum(r.value, 2)} % ${statusChip(r.status)}` }
          ], sim.rulesAfter.rules, { dense: true, rowAttr: r => sim.newlyBroken.some(x => x.id === r.id) ? 'class="row-error"' : '' })}
          ${sim.newlyBroken.length ? `<p class="neg small mt">${esc(t('navp.broken', { list: sim.newlyBroken.map(r => t('limit.' + r.id)).join(', ') }))}</p>` : `<p class="pos small mt">${esc(t('navp.noneBroken'))}</p>`}
        ` : `<p class="muted small">${esc(t('navp.simHelp'))}</p>`}
      `, { sub: esc(t('navp.simSub')) })}`}
      <p class="footnote">${esc(t('navp.method'))}</p>
    `;

    const saveFund = fn => store.update(pp => { pp.fund = { classes: [], ...(pp.fund || {}) }; fn(pp.fund); }, t('nav.nav'));
    root.querySelectorAll('[data-cls]').forEach(el => el.addEventListener('change', e => {
      const { cls, k } = e.target.dataset;
      const raw = e.target.value;
      saveFund(fd => { const c = fd.classes.find(x => x.id === cls); if (!c) return; c[k] = ['units', 'lastNav', 'feePct'].includes(k) ? (raw === '' ? null : numIn(raw)) : raw; });
    }));
    root.querySelectorAll('[data-fund]').forEach(el => el.addEventListener('change', e => {
      const k = e.target.dataset.fund, raw = e.target.value;
      saveFund(fd => { fd[k] = k === 'feeFrom' ? raw : (raw === '' ? 0 : numIn(raw) || 0); });
    }));
    root.querySelector('#simCls')?.addEventListener('change', e => { ui.classId = e.target.value; app.rerender(); });
    root.querySelector('#simAmt')?.addEventListener('change', e => { ui.amount = e.target.value; ui.pct = null; app.rerender(); });
    root.onclick = e => {
      const pct = e.target.closest('[data-pct]');
      if (pct) { ui.pct = ui.pct === +pct.dataset.pct ? null : +pct.dataset.pct; ui.amount = ''; app.rerender(); return; }
      const del = e.target.closest('[data-delcls]')?.dataset.delcls;
      if (del) { saveFund(fd => { fd.classes = fd.classes.filter(c => c.id !== del); }); return; }
      if (e.target.closest('[data-act="addcls"]')) {
        saveFund(fd => {
          const first = !fd.classes.length;
          fd.classes.push({ id: uid('cls'), name: first ? 'A' : '', ccy: p.baseCcy, units: first ? 1000000 : null, lastNav: first && a.v.nav > 0 ? Math.round(a.v.nav / 1e6 * 10000) / 10000 : null, lastNavDate: first ? todayISO() : '', feePct: 1 });
          if (!fd.feeFrom) fd.feeFrom = todayISO().slice(0, 8) + '01';
        });
      }
    };
  }
};
