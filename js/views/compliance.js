import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, kpi, fmtNum, fmtDate, statusChip, table, openModal, closeModal, confirmDialog, selectHtml, toast } from '../ui.js';
import { ruleName, ruleVal, ruleLimit, unitVal } from '../labels.js';
import { RULE_DIMS, RULE_MEASURES, GROUP_BY, RULE_EXAMPLES, UNIT, newRule } from '../rules.js';
import { usesVar, geSettings } from '../globalexposure.js';
import { ASSET_CLASSES, INSTRUMENTS, GROUPS, REGIONS } from '../instruments.js';
import { regNote } from './regnote.js';
import { breachHistory } from '../insights.js';
import { snapshots } from '../snapshots.js';

let cache = { key: '', value: null };
import { DEFAULT_LIMITS } from '../store.js';
import { debounce } from '../util.js';

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const { comp } = a;
    const byId = Object.fromEntries(comp.rules.map(r => [r.id, r]));

    root.innerHTML = `
      ${pageHead(t('nav.compliance'), esc(t('comp.sub', { type: p.fundType || 'UCITS' })))}
      ${regNote('ucits')}
      ${comp.breaches ? `<div class="alert alert-info"><span>${esc(t('comp.toLog'))}</span><a href="#/control-log">${esc(t('nav.controlLog'))} →</a></div>` : ''}
      <div class="kpi-grid">
        ${kpi(t('comp.checked'), String(comp.rules.length))}
        ${kpi(t('comp.breaches'), String(comp.breaches), { tone: comp.breaches ? 'breach' : 'ok' })}
        ${kpi(t('comp.warnings'), String(comp.warnings), { tone: comp.warnings ? 'warn' : '', sub: t('comp.warnSub') })}
      </div>
      ${card(t('comp.rules'), `<div class="rules">${Object.keys(DEFAULT_LIMITS).map(id => {
        const lim = p.limits[id];
        const r = byId[id];
        const pct = r ? Math.min(1.2, r.dir === 'max' ? r.value / (r.limit || 1) : (r.limit ? r.limit / Math.max(r.value, 1e-9) : 0)) : 0;
        return `<article class="rule ${r ? 'rule-' + r.status : 'rule-off'}">
          <div class="rule-main">
            <label class="switch"><input type="checkbox" data-on="${id}" ${lim.on ? 'checked' : ''} aria-label="${esc(t('comp.enable'))}"><span></span></label>
            <div class="rule-text"><h3>${esc(t('limit.' + id))}</h3><p class="muted small">${esc(t('limit.' + id + '.help'))}</p></div>
            <div class="rule-limit"><span>${r?.dir === 'min' || ['liquidity7d', 'cashMin'].includes(id) ? '≥' : '≤'}</span><input type="number" step="0.5" min="0" value="${lim.value}" data-val="${id}" aria-label="${esc(t('comp.limit'))}"><span>%</span></div>
            <div class="rule-status">${r ? `${statusChip(r.status)}<div class="num strong">${fmtNum(r.value, 2)} %</div>` : `<span class="muted small">${esc(t('comp.off'))}</span>`}</div>
          </div>
          ${r ? `<div class="meter" aria-hidden="true"><div class="meter-fill ${r.status}" style="width:${Math.max(0, Math.min(100, pct / 1.2 * 100))}%"></div><div class="meter-limit" style="left:${100 / 1.2}%"></div></div>` : ''}
          ${r && r.details.length ? `<details><summary>${esc(t('comp.details', { n: r.details.length }))}</summary><ul class="detail-list">${r.details.map(d => `<li><span>${esc(d.name)}</span><span class="num">${fmtNum(d.value, 2)} %</span></li>`).join('')}</ul></details>` : ''}
        </article>`;
      }).join('')}</div>${usesVar(p) ? `<p class="small mt">${esc(t('comp.varNote', { m: t('ge.method.' + geSettings(p).method) }))} ${byId.varAbs || byId.varRel ? `${statusChip((byId.varAbs || byId.varRel).status)} <strong>${esc(ruleVal(byId.varAbs || byId.varRel))}</strong> / ${esc(ruleLimit(byId.varAbs || byId.varRel))}` : ''} <a class="link" href="#/global-exposure">${esc(t('nav.globalExposure'))} →</a></p>` : ''}`, { sub: esc(t('comp.rulesSub')), actions: `<button class="btn btn-sm" data-act="defaults">${esc(t('comp.defaults'))}</button>` })}
      ${fundRulesCard(p, comp)}
      ${historyCard(p)}
      <p class="footnote">${esc(t('comp.disclaimer'))}</p>
    `;

    root.querySelectorAll('[data-on]').forEach(cb => cb.addEventListener('change', e => store.update(pp => { pp.limits[e.target.dataset.on].on = e.target.checked; }, t('nav.compliance'))));
    root.querySelectorAll('[data-val]').forEach(inp => inp.addEventListener('change', debounce(e => {
      const x = parseFloat(String(e.target.value).replace(',', '.'));
      if (Number.isFinite(x) && x >= 0) store.update(pp => { pp.limits[e.target.dataset.val].value = x; }, t('comp.limit'));
    }, 0)));
    root.querySelector('[data-act="defaults"]').onclick = () => store.update(pp => { pp.limits = JSON.parse(JSON.stringify(DEFAULT_LIMITS)); }, t('comp.defaults'));
    bindFundRules(root);
  }
};

// Limits over the snapshots, with each breach classed as active (a trade) or passive (the market).
function historyCard(p) {
  const snaps = snapshots(p);
  if (snaps.length < 2) return card(t('bh.title'), `<p class="muted small">${esc(t('bh.need'))} <a href="#/changes">${esc(t('nav.changes'))} →</a></p>`, { sub: esc(t('bh.sub')) });
  const key = [p.id, p.updatedAt, snaps.length, snaps[snaps.length - 1].date].join('|');
  if (cache.key !== key) cache = { key, value: breachHistory(p, snaps) };
  const h = cache.value;
  const eps = h.episodes;
  const n = c => eps.filter(e => e.cause === c).length;
  const strip = r => `<div class="bh-strip" role="img" aria-label="${esc(ruleName(r.id))}">${r.statuses.map((s, i) => `<span class="bh-${s}" title="${esc(h.dates[i])}: ${esc(t('status.' + s))}${r.values[i] != null ? ' · ' + unitVal(r.values[i], r.id) : ''}"></span>`).join('')}</div>`;
  const shown = h.rules.filter(r => r.statuses.some(s => s !== 'ok'));
  return card(t('bh.title'), `
    <div class="kpi-grid">
      ${kpi(t('bh.episodes'), String(eps.length), { sub: t('bh.checked', { n: h.checked, a: fmtDate(h.dates[0]), b: fmtDate(h.dates[h.dates.length - 1]) }) })}
      ${kpi(t('bh.active'), String(n('active')), { tone: n('active') ? 'breach' : 'ok', help: t('bh.activeHelp') })}
      ${kpi(t('bh.passive'), String(n('passive')), { tone: n('passive') ? 'warn' : 'ok', help: t('bh.passiveHelp') })}
      ${kpi(t('bh.ongoing'), String(eps.filter(e => e.ongoing).length), { tone: eps.some(e => e.ongoing) ? 'breach' : 'ok' })}
    </div>
    ${shown.length ? `<div class="bh-grid">${shown.map(r => `<div class="bh-row"><span class="small">${esc(ruleName(r.id))}</span>${strip(r)}</div>`).join('')}
      <div class="bh-row"><span></span><div class="bh-axis small muted"><span>${esc(fmtDate(h.dates[0]))}</span><span>${esc(fmtDate(h.dates[h.dates.length - 1]))}</span></div></div></div>` : `<p class="muted small">${esc(t('bh.clean'))}</p>`}
    ${eps.length ? table([
      { key: 'r', label: t('cmp.rule'), fmt: e => esc(ruleName(e.id)) },
      { key: 's', label: t('bh.start'), fmt: e => esc(fmtDate(e.start)) },
      { key: 'e', label: t('bh.end'), fmt: e => e.ongoing ? `<span class="chip chip-breach">${esc(t('bh.stillOpen'))}</span>` : esc(fmtDate(e.end)) },
      { key: 'd', label: t('bh.days'), align: 'right', fmt: e => fmtNum(e.days, 0) },
      { key: 'c', label: t('bh.cause'), fmt: e => `<span class="chip ${e.cause === 'active' ? 'chip-breach' : e.cause === 'passive' ? 'chip-warn' : ''}">${esc(t('bh.cause.' + e.cause))}</span>` },
      { key: 'v', label: t('bh.worst'), align: 'right', fmt: e => `${esc(unitVal(e.peak, e.id))} <span class="muted small">(${esc(ruleLimit({ id: e.id, dir: e.dir, limit: e.limit }))})</span>` }
    ], eps, { dense: true, maxRows: 60 }) : ''}
    <p class="muted small">${esc(t('bh.method'))}${h.truncated ? ' ' + esc(t('bh.truncated', { n: h.checked })) : ''}</p>`, { sub: esc(t('bh.sub')), id: 'breachHistory' });
}

// ---- fund rules ------------------------------------------------------------------------------------
const CODES = {
  assetClass: () => Object.keys(ASSET_CLASSES), type: () => Object.keys(INSTRUMENTS), group: () => Object.keys(GROUPS),
  region: () => Object.keys(REGIONS), rating: () => ['IG', 'HY', 'NR']
};
const opsFor = dim => (dim === 'rating' ? ['in', 'notin', 'below', 'atleast'] : ['name', 'issuer', 'sector', 'strategy'].includes(dim) ? ['in', 'notin', 'contains'] : ['in', 'notin']);

export function describeRule(r) {
  const what = t('fr.m.' + r.measure) + (r.measure === 'maxGroup' ? ' ' + t('fr.by', { g: t('fr.dim.' + (r.groupBy || 'issuer')) }) : '');
  const where = (r.conds || []).length
    ? t('fr.where') + ' ' + r.conds.map(c => `${t('fr.dim.' + c.dim)} ${t('fr.op.' + c.op)} ${(c.values || []).join(', ')}`).join(' ' + t('fr.and') + ' ')
    : t('fr.all');
  return `${what}, ${where}`;
}

function fundRulesCard(p, comp) {
  const byId = Object.fromEntries(comp.rules.map(r => [r.id, r]));
  const list = p.rules || [];
  return card(t('fr.title'), `
    ${regNote('fundRules')}
    ${list.length ? `<div class="rules">${list.map(rule => {
      const r = byId['fr:' + rule.id];
      const pct = r ? Math.min(1.2, r.dir === 'max' ? (r.limit ? r.value / r.limit : r.value > 0 ? 1.2 : 0) : (r.limit ? r.limit / Math.max(r.value, 1e-9) : 0)) : 0;
      return `<article class="rule ${r ? 'rule-' + r.status : 'rule-off'}">
        <div class="rule-main">
          <label class="switch"><input type="checkbox" data-fron="${esc(rule.id)}" ${rule.on !== false ? 'checked' : ''} aria-label="${esc(t('comp.enable'))}"><span></span></label>
          <div class="rule-text"><h3>${esc(rule.name)} <span class="row-actions inline-actions"><button class="icon-btn sm" data-fredit="${esc(rule.id)}" title="${esc(t('common.edit'))}" aria-label="${esc(t('common.edit'))}">✎</button><button class="icon-btn sm" data-frdel="${esc(rule.id)}" title="${esc(t('common.delete'))}" aria-label="${esc(t('common.delete'))}">✕</button></span></h3><p class="muted small">${esc(describeRule(rule))}</p></div>
          <div class="rule-limit"><span class="strong">${esc(ruleLimit({ dir: rule.dir, limit: rule.limit, unit: UNIT[rule.measure] }))}</span></div>
          <div class="rule-status">${r ? `${statusChip(r.status)}<div class="num strong">${esc(ruleVal(r))}</div>` : `<span class="muted small">${esc(t('comp.off'))}</span>`}</div>
        </div>
        ${r ? `<div class="meter" aria-hidden="true"><div class="meter-fill ${r.status}" style="width:${Math.max(0, Math.min(100, pct / 1.2 * 100))}%"></div><div class="meter-limit" style="left:${100 / 1.2}%"></div></div>` : ''}
        ${r && r.details.length ? `<details><summary>${esc(t('comp.details', { n: r.details.length }))}</summary><ul class="detail-list">${r.details.map(d => `<li><span>${esc(d.name)}</span><span class="num">${esc(unitVal(d.value, r.id))}</span></li>`).join('')}</ul></details>` : ''}
      </article>`;
    }).join('')}</div>` : `<p class="muted small">${esc(t('fr.empty'))}</p>`}
    <div class="btn-row">
      <button class="btn btn-sm btn-primary" data-act="fr-add">+ ${esc(t('fr.add'))}</button>
      ${selectHtml('id="frExample" aria-label="' + esc(t('fr.examples')) + '"', [['', t('fr.examples')], ...RULE_EXAMPLES.map(e => [e.key, e.rule.name])], '')}
    </div>`, { sub: esc(t('fr.sub')), id: 'fundRules' });
}

function editRule(rule, isNew) {
  const d = JSON.parse(JSON.stringify(rule));
  const codes = dim => (CODES[dim] ? CODES[dim]().join(', ') : '');
  const condRow = (c, i) => `<div class="cond-row">
      ${selectHtml(`data-cdim="${i}" aria-label="${esc(t('fr.field'))}"`, RULE_DIMS.map(k => [k, t('fr.dim.' + k)]), c.dim)}
      ${selectHtml(`data-cop="${i}" aria-label="${esc(t('fr.op'))}"`, opsFor(c.dim).map(k => [k, t('fr.op.' + k)]), c.op)}
      <input data-cval="${i}" value="${esc((c.values || []).join(', '))}" placeholder="${esc(c.dim === 'rating' && ['below', 'atleast'].includes(c.op) ? 'BBB-' : t('fr.valuesPh'))}" aria-label="${esc(t('fr.values'))}">
      <button type="button" class="icon-btn sm" data-cdel="${i}" aria-label="${esc(t('common.delete'))}">✕</button>
      ${codes(c.dim) ? `<div class="small muted cond-codes">${esc(t('fr.codes'))}: ${esc(codes(c.dim))}</div>` : ''}
    </div>`;
  const render = () => {
    const m = openModal(`<div class="modal-head"><h2>${esc(isNew ? t('fr.addTitle') : t('fr.editTitle'))}</h2></div>
      <form class="modal-body form-stack" id="frForm">
        <label><span>${esc(t('fr.name'))}</span><input name="name" required value="${esc(d.name)}"></label>
        <div class="form-grid">
          <label><span>${esc(t('fr.measure'))}</span>${selectHtml('name="measure"', RULE_MEASURES.map(k => [k, t('fr.m.' + k)]), d.measure)}</label>
          <label><span>${esc(t('fr.groupBy'))}</span>${selectHtml('name="groupBy"', GROUP_BY.map(k => [k, t('fr.dim.' + k)]), d.groupBy || 'issuer')}</label>
          <label><span>${esc(t('fr.dir'))}</span>${selectHtml('name="dir"', [['max', t('fr.dir.max')], ['min', t('fr.dir.min')]], d.dir)}</label>
          <label><span>${esc(t('fr.limit'))} (${esc(UNIT[d.measure] || t('fr.unitCount'))})</span><input name="limit" inputmode="decimal" required value="${esc(String(d.limit ?? ''))}"></label>
        </div>
        <p class="muted small">${esc(t('fr.m.' + d.measure + '.help'))}</p>
        <h3 class="h3">${esc(t('fr.conditions'))}</h3>
        <p class="muted small">${esc(t('fr.conditionsHelp'))}</p>
        <div class="cond-list">${d.conds.map(condRow).join('')}</div>
        <button type="button" class="btn btn-sm" data-cadd>+ ${esc(t('fr.addCond'))}</button>
      </form>
      <div class="modal-foot"><button class="btn" data-close>${esc(t('common.cancel'))}</button><button class="btn btn-primary" form="frForm" type="submit">${esc(t('common.save'))}</button></div>`, { wide: true });
    const f = m.querySelector('#frForm');
    const pull = () => {
      d.name = f.name.value; d.measure = f.measure.value; d.groupBy = f.groupBy.value; d.dir = f.dir.value; d.limit = f.limit.value;
      m.querySelectorAll('[data-cdim]').forEach(el => { d.conds[+el.dataset.cdim].dim = el.value; });
      m.querySelectorAll('[data-cop]').forEach(el => { d.conds[+el.dataset.cop].op = el.value; });
      m.querySelectorAll('[data-cval]').forEach(el => { d.conds[+el.dataset.cval].values = el.value.split(/[,;]/).map(x => x.trim()).filter(Boolean); });
    };
    m.addEventListener('change', e => {
      if (e.target.name === 'measure' || e.target.dataset.cdim !== undefined) {
        pull();
        d.conds.forEach(c => { if (!opsFor(c.dim).includes(c.op)) c.op = 'in'; });
        render();
      }
    });
    m.addEventListener('click', e => {
      if (e.target.closest('[data-cadd]')) { pull(); d.conds.push({ dim: 'assetClass', op: 'in', values: [] }); render(); }
      const del = e.target.closest('[data-cdel]');
      if (del) { pull(); d.conds.splice(+del.dataset.cdel, 1); render(); }
    });
    f.addEventListener('submit', e => {
      e.preventDefault();
      pull();
      const lim = parseFloat(String(d.limit).replace(',', '.'));
      if (!Number.isFinite(lim)) { toast(t('fr.badLimit'), { tone: 'warn' }); return; }
      d.limit = lim;
      d.conds = d.conds.filter(c => (c.values || []).length);
      closeModal();
      store.update(pp => {
        const i = pp.rules.findIndex(x => x.id === d.id);
        if (i >= 0) pp.rules[i] = d; else pp.rules.push(d);
      }, t('fr.title'));
    });
  };
  render();
}

function bindFundRules(root) {
  root.querySelectorAll('[data-fron]').forEach(cb => cb.addEventListener('change', e => store.update(pp => { const r = pp.rules.find(x => x.id === e.target.dataset.fron); if (r) r.on = e.target.checked; }, t('fr.title'))));
  root.querySelector('[data-act="fr-add"]')?.addEventListener('click', () => editRule(newRule(), true));
  root.querySelector('#frExample')?.addEventListener('change', e => {
    const ex = RULE_EXAMPLES.find(x => x.key === e.target.value);
    if (ex) editRule(newRule(ex.rule), true);
  });
  root.querySelectorAll('[data-fredit]').forEach(b => b.addEventListener('click', () => { const r = store.active().rules.find(x => x.id === b.dataset.fredit); if (r) editRule(r, false); }));
  root.querySelectorAll('[data-frdel]').forEach(b => b.addEventListener('click', async () => {
    const r = store.active().rules.find(x => x.id === b.dataset.frdel);
    if (r && await confirmDialog(t('fr.deleteConfirm', { name: esc(r.name) }), { danger: true, ok: t('common.delete') })) store.update(pp => { pp.rules = pp.rules.filter(x => x.id !== r.id); }, t('fr.title'));
  }));
}
