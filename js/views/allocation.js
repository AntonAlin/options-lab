import * as store from '../store.js';
import { t, L, lang } from '../i18n.js';
import { esc, card, pageHead, table, kpi, fmtMoney, fmtPct, segmented, selectHtml, statusChip, signCls } from '../ui.js';
import { ASSET_CLASSES, REGIONS, typeLabel } from '../instruments.js';
import { ALLOC_DIMS, allocationTree } from '../allocation.js';
import * as charts from '../charts.js';

const ui = { measure: 'economic', kind: 'sunburst' };
const numIn = s => { const x = parseFloat(String(s).replace(/[\s  %]/g, '').replace(',', '.')); return Number.isFinite(x) ? x : null; };

export const classLabel = k => L(ASSET_CLASSES[k] || { en: k });
export function groupLabel(key) {
  if (key.startsWith('type:')) return typeLabel(key.slice(5), lang());
  if (REGIONS[key]) return L(REGIONS[key]);
  return key;
}

// Tree nodes with labels and colours attached, shared by the page and the PDF.
export function treeNodes(v, { measure, dim, base, th }) {
  return allocationTree(v, { measure, dim, base }).map(n => ({
    ...n,
    label: n.kind === 'class' ? classLabel(n.key) : n.kind === 'group' ? groupLabel(n.key) : n.key + (n.share != null && n.share < 1 ? ` (${Math.round(n.share * 100)} %)` : ''),
    color: charts.classColor(n.cls, th)
  }));
}

export function overlayRows(aa, th) {
  return aa.classes.map(c => ({
    label: classLabel(c.key), physical: aa.nav ? c.physical / aa.nav : 0, overlay: c.overlayW, econ: c.econW,
    color: charts.classColor(c.key, th), target: c.target, min: c.min, max: c.max
  }));
}

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const { aa, db } = a;
    const base = p.baseCcy;
    const dim = p.risk.allocDim && ALLOC_DIMS.includes(p.risk.allocDim) ? p.risk.allocDim : 'auto';
    const eq = aa.classes.find(c => c.key === 'equity');
    const fi = aa.classes.find(c => c.key === 'fixed_income');
    const tg = k => p.allocTargets?.[k] || {};
    const inp = (k, f) => `<input data-tgt="${esc(k)}" data-f="${f}" inputmode="decimal" class="tgt-in" value="${tg(k)[f] ?? ''}" placeholder="—" aria-label="${esc(classLabel(k) + ' ' + t('aa.' + f))}">`;
    const allClasses = [...new Set([...aa.classes.map(c => c.key), 'equity', 'fixed_income', 'money_market', 'cash', 'alternative', 'commodity'])];
    const missing = allClasses.filter(k => !aa.classes.some(c => c.key === k));

    root.innerHTML = `
      ${pageHead(t('nav.allocation'), esc(t('aa.sub')))}
      <div class="kpi-grid">
        ${kpi(t('aa.equity'), fmtPct(eq?.econW || 0, 1), { sub: t('aa.vsMv', { v: fmtPct(eq?.mvW || 0, 1) }), help: t('aa.econHelp') })}
        ${kpi(t('aa.fixedIncome'), fmtPct(fi?.econW || 0, 1), { sub: t('aa.vsMv', { v: fmtPct(fi?.mvW || 0, 1) }) })}
        ${kpi(t('aa.overlay'), `<span class="${signCls(aa.overlay)}">${fmtPct(aa.overlayW, 1, { sign: true })}</span>`, { sub: fmtMoney(aa.overlay, base, { compact: true }) })}
        ${kpi(t('aa.econNet'), fmtPct(aa.econW, 1), { sub: t('aa.econNetSub') })}
        ${kpi(t('aa.gross'), fmtPct(aa.grossW, 1), { sub: t('aa.grossSub') })}
        ${kpi(t('aa.breaches'), String(aa.breaches), { tone: aa.breaches ? 'breach' : aa.classes.some(c => c.status) ? 'ok' : '', sub: aa.classes.some(c => c.status) ? t('aa.breachesSub') : t('aa.noTargets') })}
      </div>
      ${card(t('aa.bridge'), '<div id="chAaBridge" class="chart"></div>', { sub: esc(t('aa.bridgeSub')) })}
      ${card(t('aa.map'), `
        <div class="toolbar wrap">
          ${segmented('aaMeasure', [['economic', t('aa.m.economic')], ['mv', t('aa.m.mv')]], ui.measure)}
          ${segmented('aaKind', [['sunburst', t('aa.sunburst')], ['treemap', t('aa.treemap')]], ui.kind)}
          <label class="inline">${esc(t('aa.dim'))} ${selectHtml('id="aaDim"', ALLOC_DIMS.map(d => [d, t('aa.dim.' + d)]), dim)}</label>
        </div>
        <div id="chAaTree" class="chart"></div>
        <p class="muted small">${esc(t('aa.mapHelp'))}</p>`, { sub: esc(t('aa.mapSub')) })}
      ${card(t('aa.table'), `${table([
        { key: 'k', label: t('exp.assetClass'), fmt: c => `<span class="swatch" style="background:${charts.classColor(c.key)}"></span>${esc(classLabel(c.key))}` },
        { key: 'mv', label: t('aa.mvAmt', { base }), align: 'right', fmt: c => fmtMoney(c.mv, '', { compact: true }) },
        { key: 'mvW', label: t('aa.m.mv'), align: 'right', fmt: c => fmtPct(c.mvW, 1) },
        { key: 'ov', label: t('aa.overlayCol'), align: 'right', fmt: c => c.overlay ? `<span class="${signCls(c.overlay)}">${fmtPct(c.overlayW, 1, { sign: true })}</span>` : '—' },
        { key: 'ec', label: t('aa.m.economic'), align: 'right', fmt: c => `<strong>${fmtPct(c.econW, 1)}</strong>` },
        { key: 'lo', label: t('aa.long'), align: 'right', fmt: c => fmtPct(c.longW, 1) },
        { key: 'sh', label: t('aa.short'), align: 'right', fmt: c => c.short ? `<span class="neg">${fmtPct(c.shortW, 1)}</span>` : '—' },
        { key: 'tg', label: t('aa.target'), align: 'right', fmt: c => inp(c.key, 'target') },
        { key: 'mn', label: t('aa.min'), align: 'right', fmt: c => inp(c.key, 'min') },
        { key: 'mx', label: t('aa.max'), align: 'right', fmt: c => inp(c.key, 'max') },
        { key: 'ac', label: t('aa.active'), align: 'right', fmt: c => c.active != null ? `<span class="${signCls(c.active)}">${fmtPct(c.active, 1, { sign: true })}</span>` : '—' },
        { key: 'st', label: '', fmt: c => c.status ? statusChip(c.status) : '' }
      ], aa.classes, { dense: true, rowAttr: c => c.status === 'breach' ? 'class="row-error"' : '' })}
        ${missing.length ? `<div class="toolbar mt"><label class="inline">${esc(t('aa.addTarget'))} ${selectHtml('id="aaAddCls"', [['', '—'], ...missing.map(k => [k, classLabel(k)])], '')}</label></div>` : ''}`, { sub: esc(t('aa.tableSub')) })}
      ${db.count ? `<div class="alert alert-info"><span>${esc(t('aa.derivNote', { n: db.count, r: db.usingReported }))} <a href="#/derivatives">${esc(t('nav.derivatives'))} →</a></span></div>` : ''}
      <p class="footnote">${esc(t('aa.method'))}</p>
    `;

    const th = charts.currentTheme();
    charts.render('chAaBridge', charts.overlaySpec(overlayRows(aa, th), { names: { physical: t('aa.physical'), overlay: t('aa.overlayCol'), econ: t('aa.m.economic'), target: t('aa.target') } }));
    const nodes = treeNodes(a.v, { measure: ui.measure, dim, base, th });
    if (nodes.length) charts.render('chAaTree', charts.hierarchySpec(nodes, { kind: ui.kind, shortLabel: t('aa.shortLbl'), height: ui.kind === 'treemap' ? 480 : 520 }));

    const saveTarget = (k, f, val) => store.update(pp => {
      pp.allocTargets = { ...(pp.allocTargets || {}) };
      const cur = { ...(pp.allocTargets[k] || {}) };
      if (val == null) delete cur[f]; else cur[f] = val;
      if (Object.keys(cur).length) pp.allocTargets[k] = cur; else delete pp.allocTargets[k];
    }, t('aa.target'));
    root.querySelectorAll('[data-tgt]').forEach(el => el.addEventListener('change', e => saveTarget(e.target.dataset.tgt, e.target.dataset.f, numIn(e.target.value))));
    root.querySelector('#aaAddCls')?.addEventListener('change', e => { if (e.target.value) saveTarget(e.target.value, 'target', 0); });
    root.querySelector('#aaDim')?.addEventListener('change', e => store.update(pp => { pp.risk.allocDim = e.target.value; }, t('aa.dim')));
    root.onclick = e => {
      const m = e.target.closest('[data-seg="aaMeasure"]');
      if (m) { ui.measure = m.dataset.value; app.rerender(); return; }
      const k = e.target.closest('[data-seg="aaKind"]');
      if (k) { ui.kind = k.dataset.value; app.rerender(); }
    };
  }
};
