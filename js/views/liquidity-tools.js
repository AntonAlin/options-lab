// Liquidity management tools: the fund's selection, swing pricing calibration and redemption gates.
// The reading of the rules behind it is the developer's; see the note at the top.
import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, kpi, fmtNum, table, numIn } from '../ui.js';
import { typeLabel } from '../instruments.js';
import { LMT_TOOLS, SELECTABLE, lmtSettings, lmtCheck, swingAnalysis, gateAnalysis, costBp, DEFAULT_COST_BP } from '../lmt.js';
import { regNote } from './regnote.js';

const bp = x => (isFinite(x) ? fmtNum(x, 1) + ' bp' : '—');
const pc = (x, d = 1) => (isFinite(x) ? fmtNum(x, d) + ' %' : '—');

export default {
  render(root, app) {
    const p = store.active();
    const v = app.analysis().v;
    const cfg = lmtSettings(p);
    const chk = lmtCheck(cfg);
    const sw = swingAnalysis(v, cfg);
    const gates = gateAnalysis(v, cfg);
    const types = [...new Set(v.valid.filter(x => x.def.group !== 'derivatives' && x.r.mv > 0).map(x => x.pos.type))];

    root.innerHTML = `
      ${pageHead(t('nav.lmt'), esc(t('lmt.sub')))}
      ${regNote('lmt')}
      ${card(t('lmt.selection'), `
        <label class="inline"><input type="checkbox" id="lmtMmf" ${cfg.mmf ? 'checked' : ''}> ${esc(t('lmt.mmf'))}</label>
        <div class="lmt-grid">${LMT_TOOLS.map(k => {
          const sel = SELECTABLE.includes(k);
          return `<label class="lmt-tool ${cfg.selected.includes(k) ? 'on' : ''} ${sel ? '' : 'fixed'}">
            <input type="checkbox" data-lmt="${k}" ${cfg.selected.includes(k) || k === 'suspension' ? 'checked' : ''} ${k === 'suspension' ? 'disabled' : ''}>
            <span><strong>${esc(t('lmt.t.' + k))}</strong>${sel ? '' : ` <span class="chip">${esc(t('lmt.notCounted'))}</span>`}<br><span class="small muted">${esc(t('lmt.t.' + k + '.help'))}</span></span>
          </label>`;
        }).join('')}</div>
        <div class="alert ${chk.ok ? 'alert-ok' : 'alert-breach'}"><span>${esc(chk.ok ? t('lmt.ok', { n: chk.count, r: chk.required }) : t('lmt.notOk', { n: chk.count, r: chk.required }))}</span></div>
        ${chk.antiDilutionOverlap ? `<div class="alert alert-warn"><span>${esc(t('lmt.overlap'))}</span></div>` : ''}`, { sub: esc(t('lmt.selectionSub')) })}

      ${sw ? card(t('lmt.swing'), `
        <div class="toolbar wrap">
          <label class="inline">${esc(t('lmt.stressMult'))} <input id="lmtStress" class="w-80" inputmode="decimal" value="${cfg.stressMult}"> ×</label>
          <label class="inline">${esc(t('lmt.materiality'))} <input id="lmtMat" class="w-80" inputmode="decimal" value="${cfg.materialityBp}"> bp</label>
          <label class="inline">${esc(t('lmt.cap'))} <input id="lmtCap" class="w-80" inputmode="decimal" value="${cfg.capPct}"> %</label>
          <label class="inline"><input type="checkbox" id="lmtImpact" ${cfg.impact ? 'checked' : ''}> ${esc(t('lmt.impact'))}</label>
        </div>
        <div class="kpi-grid">
          ${kpi(t('lmt.factor5'), bp(sw.table.find(r => r.flow === 5)?.factor ?? sw.table[0].factor), { sub: t('lmt.factorSub'), help: t('help.swingFactor') })}
          ${kpi(t('lmt.factor5s'), bp(sw.table.find(r => r.flow === 5)?.factorStressed ?? sw.table[0].factorStressed), { sub: t('lmt.stressedSub', { m: fmtNum(cfg.stressMult, 1) }), tone: sw.overCap ? 'breach' : '' })}
          ${kpi(t('lmt.threshold'), sw.threshold != null ? pc(sw.threshold) : '> 50 %', { sub: t('lmt.thresholdSub', { m: fmtNum(cfg.materialityBp, 1) }), help: t('help.swingThreshold') })}
          ${kpi(t('lmt.thresholdS'), sw.thresholdStressed != null ? pc(sw.thresholdStressed) : '> 50 %', { sub: t('lmt.stressedShort') })}
        </div>
        ${sw.overCap ? `<div class="alert alert-warn"><span>${esc(t('lmt.overCap', { f: bp(sw.maxStressed), c: pc(cfg.capPct) }))}</span></div>` : ''}
        ${table([
          { key: 'f', label: t('lmt.flow'), fmt: r => pc(r.flow, 0) },
          { key: 'a', label: t('lmt.factorCol'), align: 'right', fmt: r => bp(r.factor) },
          { key: 'b', label: t('lmt.factorColS'), align: 'right', fmt: r => bp(r.factorStressed) },
          { key: 'c', label: t('lmt.dilution'), align: 'right', fmt: r => bp(r.dilution) },
          { key: 'd', label: t('lmt.dilutionS'), align: 'right', fmt: r => bp(r.dilutionStressed) }
        ], sw.table, { dense: true })}
        <p class="muted small">${esc(t('lmt.impactCoverage', { c: pc(sw.impactCoverage * 100, 0), k: pc(sw.cashShare * 100, 1) }))}</p>
        <div class="grid-2">
          <div>
            <h3 class="h3">${esc(t('lmt.costs'))}</h3>
            <p class="muted small">${esc(t('lmt.costsHelp'))}</p>
            <div class="cma-grid">${types.map(k => `<label><span>${esc(typeLabel(k))}</span><span class="with-unit"><input data-cost="${k}" inputmode="decimal" value="${costBp(cfg, k)}" placeholder="${DEFAULT_COST_BP[k] ?? 20}"><em>bp</em></span></label>`).join('')}</div>
          </div>
          <div>
            <h3 class="h3">${esc(t('lmt.contributors'))}</h3>
            ${table([
              { key: 'n', label: t('col.name'), fmt: c => esc(c.row.name) },
              { key: 'w', label: t('col.weight'), align: 'right', fmt: c => pc(c.w * 100) },
              { key: 'c', label: t('lmt.costCol'), align: 'right', fmt: c => bp(c.cost + c.impact) },
              { key: 'b', label: t('lmt.contrib'), align: 'right', fmt: c => bp(c.bp) }
            ], sw.contributors, { dense: true })}
          </div>
        </div>
        <p class="muted small">${esc(t('lmt.swingMethod'))}</p>`, { sub: esc(t('lmt.swingSub')) }) : ''}

      ${card(t('lmt.gates'), `
        <div class="toolbar wrap"><label class="inline">${esc(t('lmt.gatePct'))} <input id="lmtGate" class="w-80" inputmode="decimal" value="${cfg.gatePct}"> ${esc(t('lmt.perDay'))}</label></div>
        ${table([
          { key: 'r', label: t('lmt.request'), fmt: r => pc(r.request, 0) },
          { key: 'g', label: t('lmt.gated'), fmt: r => (r.gated ? `<span class="chip chip-warn">${esc(t('lmt.yes'))}</span>` : esc(t('lmt.no'))) },
          { key: 'f', label: t('lmt.firstDay'), align: 'right', fmt: r => pc(r.firstDay) },
          { key: 'd', label: t('lmt.deferred'), align: 'right', fmt: r => pc(r.deferred) },
          { key: 'n', label: t('lmt.days'), align: 'right', fmt: r => fmtNum(r.days, 0) },
          { key: 'c', label: t('lmt.covered'), fmt: (r, i) => `${r.coversFirstDay ? '✓' : `<span class="neg">✕</span>`} / ${gates.stressed[gates.normal.indexOf(r)].coversFirstDay ? '✓' : `<span class="neg">✕</span>`}` },
          { key: 'h', label: t('lmt.coverIn'), align: 'right', fmt: r => { const s = gates.stressed[gates.normal.indexOf(r)]; return `${r.coverIn ? t('liq.nd', { n: r.coverIn }) : '> 365'} / ${s.coverIn ? t('liq.nd', { n: s.coverIn }) : '> 365'}`; } }
        ], gates.normal, { dense: true })}
        <p class="muted small">${esc(t('lmt.gateMethod', { l: pc(gates.normal[0]?.day1Liquid ?? 0), s: pc(gates.stressed[0]?.day1Liquid ?? 0) }))}</p>`, { sub: esc(t('lmt.gatesSub')) })}
    `;

    const save = fn => store.update(pp => { pp.lmt = lmtSettings(pp); fn(pp.lmt); }, t('nav.lmt'));
    root.querySelector('#lmtMmf')?.addEventListener('change', e => save(c => { c.mmf = e.target.checked; }));
    root.querySelectorAll('[data-lmt]').forEach(cb => cb.addEventListener('change', e => save(c => {
      const k = e.target.dataset.lmt;
      c.selected = e.target.checked ? [...new Set([...c.selected, k])] : c.selected.filter(x => x !== k);
    })));
    const num = (sel, key, ok = x => x >= 0) => root.querySelector(sel)?.addEventListener('change', e => { const x = numIn(e.target.value); if (x != null && ok(x)) save(c => { c[key] = x; }); });
    num('#lmtStress', 'stressMult', x => x >= 1);
    num('#lmtMat', 'materialityBp');
    num('#lmtCap', 'capPct', x => x > 0);
    num('#lmtGate', 'gatePct', x => x > 0 && x <= 100);
    root.querySelector('#lmtImpact')?.addEventListener('change', e => save(c => { c.impact = e.target.checked; }));
    root.querySelectorAll('[data-cost]').forEach(inp => inp.addEventListener('change', e => {
      const x = numIn(e.target.value);
      save(c => { if (x == null) delete c.costs[e.target.dataset.cost]; else if (x >= 0) c.costs[e.target.dataset.cost] = x; });
    }));
  }
};
