import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, kpi, fmtNum, fmtDate, statusChip, table } from '../ui.js';
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
      ${historyCard(p)}
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

// Limits over the snapshots, with each breach classed as active (a trade) or passive (the market).
function historyCard(p) {
  const snaps = snapshots(p);
  if (snaps.length < 2) return card(t('bh.title'), `<p class="muted small">${esc(t('bh.need'))} <a href="#/changes">${esc(t('nav.changes'))} →</a></p>`, { sub: esc(t('bh.sub')) });
  const key = [p.id, p.updatedAt, snaps.length, snaps[snaps.length - 1].date].join('|');
  if (cache.key !== key) cache = { key, value: breachHistory(p, snaps) };
  const h = cache.value;
  const eps = h.episodes;
  const n = c => eps.filter(e => e.cause === c).length;
  const strip = r => `<div class="bh-strip" role="img" aria-label="${esc(t('limit.' + r.id))}">${r.statuses.map((s, i) => `<span class="bh-${s}" title="${esc(h.dates[i])}: ${esc(t('status.' + s))}${r.values[i] != null ? ' · ' + fmtNum(r.values[i], 2) + ' %' : ''}"></span>`).join('')}</div>`;
  const shown = h.rules.filter(r => r.statuses.some(s => s !== 'ok'));
  return card(t('bh.title'), `
    <div class="kpi-grid">
      ${kpi(t('bh.episodes'), String(eps.length), { sub: t('bh.checked', { n: h.checked, a: fmtDate(h.dates[0]), b: fmtDate(h.dates[h.dates.length - 1]) }) })}
      ${kpi(t('bh.active'), String(n('active')), { tone: n('active') ? 'breach' : 'ok', help: t('bh.activeHelp') })}
      ${kpi(t('bh.passive'), String(n('passive')), { tone: n('passive') ? 'warn' : 'ok', help: t('bh.passiveHelp') })}
      ${kpi(t('bh.ongoing'), String(eps.filter(e => e.ongoing).length), { tone: eps.some(e => e.ongoing) ? 'breach' : 'ok' })}
    </div>
    ${shown.length ? `<div class="bh-grid">${shown.map(r => `<div class="bh-row"><span class="small">${esc(t('limit.' + r.id))}</span>${strip(r)}</div>`).join('')}
      <div class="bh-row"><span></span><div class="bh-axis small muted"><span>${esc(fmtDate(h.dates[0]))}</span><span>${esc(fmtDate(h.dates[h.dates.length - 1]))}</span></div></div></div>` : `<p class="muted small">${esc(t('bh.clean'))}</p>`}
    ${eps.length ? table([
      { key: 'r', label: t('cmp.rule'), fmt: e => esc(t('limit.' + e.id)) },
      { key: 's', label: t('bh.start'), fmt: e => esc(fmtDate(e.start)) },
      { key: 'e', label: t('bh.end'), fmt: e => e.ongoing ? `<span class="chip chip-breach">${esc(t('bh.stillOpen'))}</span>` : esc(fmtDate(e.end)) },
      { key: 'd', label: t('bh.days'), align: 'right', fmt: e => fmtNum(e.days, 0) },
      { key: 'c', label: t('bh.cause'), fmt: e => `<span class="chip ${e.cause === 'active' ? 'chip-breach' : e.cause === 'passive' ? 'chip-warn' : ''}">${esc(t('bh.cause.' + e.cause))}</span>` },
      { key: 'v', label: t('bh.worst'), align: 'right', fmt: e => `${fmtNum(e.peak, 2)} % <span class="muted small">(${e.dir === 'min' ? '≥' : '≤'} ${fmtNum(e.limit, 1)} %)</span>` }
    ], eps, { dense: true, maxRows: 60 }) : ''}
    <p class="muted small">${esc(t('bh.method'))}${h.truncated ? ' ' + esc(t('bh.truncated', { n: h.checked })) : ''}</p>`, { sub: esc(t('bh.sub')), id: 'breachHistory' });
}
