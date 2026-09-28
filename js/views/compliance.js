import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, kpi, fmtNum, statusChip } from '../ui.js';
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
      }).join('')}</div>`, { sub: esc(t('comp.rulesSub')), actions: `<button class="btn btn-sm" data-act="defaults">${esc(t('comp.defaults'))}</button>` })}
      <p class="footnote">${esc(t('comp.disclaimer'))}</p>
    `;

    root.querySelectorAll('[data-on]').forEach(cb => cb.addEventListener('change', e => store.update(pp => { pp.limits[e.target.dataset.on].on = e.target.checked; }, t('nav.compliance'))));
    root.querySelectorAll('[data-val]').forEach(inp => inp.addEventListener('change', debounce(e => {
      const x = parseFloat(String(e.target.value).replace(',', '.'));
      if (Number.isFinite(x) && x >= 0) store.update(pp => { pp.limits[e.target.dataset.val].value = x; }, t('comp.limit'));
    }, 0)));
    root.querySelector('[data-act="defaults"]').onclick = () => store.update(pp => { pp.limits = JSON.parse(JSON.stringify(DEFAULT_LIMITS)); }, t('comp.defaults'));
  }
};
