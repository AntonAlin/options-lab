import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, toast, selectHtml, confirmDialog, fmtDate, segmented } from '../ui.js';
import { downloadBlob, todayISO } from '../util.js';
import { loadDemo } from '../app.js';

const CMA_FIELDS = [
  ['equityVol', '%'], ['equitySpecificVol', '%'], ['ratesVolBp', 'bp'], ['creditVolBp', 'bp'], ['fxVol', '%'], ['commodityVol', '%'], ['volOfVolPts', 'pts'],
  ['corrEqRates', 'ρ'], ['corrEqCredit', 'ρ'], ['corrEqFx', 'ρ'], ['corrEqCmd', 'ρ'], ['corrEqVol', 'ρ'], ['corrRatesCredit', 'ρ'], ['corrRatesRates', 'ρ'], ['corrFxFx', 'ρ'], ['corrCmdFx', 'ρ']
];

export default {
  noPortfolio: true,
  render(root) {
    const p = store.active();
    const S = store.settings();
    const usedCcys = p ? [...new Set([p.baseCcy, ...p.positions.flatMap(x => [x.ccy, x.buyCcy, x.sellCcy]).filter(Boolean)])] : [];
    const fx = p ? store.fxFn(p) : null;

    root.innerHTML = `
      ${pageHead(t('nav.settings'), esc(t('set.sub')))}
      ${card(t('set.app'), `
        <div class="toolbar wrap">
          <span>${esc(t('set.lang'))}</span>${segmented('lang', [['en', 'English'], ['sv', 'Svenska']], S.lang)}
          <span>${esc(t('set.theme'))}</span>${segmented('theme', [['auto', t('theme.auto')], ['light', t('theme.light')], ['dark', t('theme.dark')]], S.theme || 'auto')}
        </div>`)}
      ${p ? card(t('set.portfolio'), `
        <form id="pfForm" class="form-grid">
          <label><span>${esc(t('pf.name'))}</span><input name="name" value="${esc(p.name)}"></label>
          <label><span>${esc(t('pf.base'))}</span>${selectHtml('name="baseCcy"', store.CURRENCIES.map(c => [c, c]), p.baseCcy)}</label>
          <label><span>${esc(t('pf.manager'))}</span><input name="manager" value="${esc(p.manager || '')}"></label>
          <label><span>${esc(t('pf.fundType'))}</span>${selectHtml('name="fundType"', [['UCITS', 'UCITS'], ['AIF', 'AIF'], ['Mandate', t('pf.mandate')], ['Other', t('pf.other')]], p.fundType)}</label>
          <label><span>${esc(t('top.valdate'))}</span><input type="date" name="valDate" value="${esc(p.valDate || '')}"><small class="muted">${esc(t('set.valdateHelp'))}</small></label>
          <label><span>${esc(t('set.riskFree'))}</span><input name="riskFree" inputmode="decimal" value="${p.risk.riskFree}"></label>
        </form>`) : ''}
      ${p ? card(t('set.fx'), `
        <p class="muted small">${esc(t('set.fxBody', { base: p.baseCcy }))} ${p.fxSource === 'ecb' ? esc(t('set.fxEcb', { d: fmtDate(p.fxDate) })) : p.fxSource === 'fallback' ? `<strong class="warn-text">${esc(t('set.fxFallback'))}</strong>` : p.fxSource === 'manual' ? esc(t('set.fxManual')) : ''}</p>
        <div class="fx-grid">${store.CURRENCIES.filter(c => c !== p.baseCcy).sort((a, b) => (usedCcys.includes(b) - usedCcys.includes(a)) || a.localeCompare(b)).map(c => `
          <label class="${usedCcys.includes(c) ? 'used' : ''}"><span>1 ${c} =</span><input data-fx="${c}" inputmode="decimal" value="${fx(c) != null ? +fx(c).toPrecision(6) : ''}"><span>${esc(p.baseCcy)}</span></label>`).join('')}</div>
        <div class="btn-row"><button class="btn" data-act="ecb">${esc(t('set.fetchEcb'))}</button></div>`, { sub: esc(t('set.fxSub')) }) : ''}
      ${p ? card(t('set.cma'), `
        <p class="muted small">${esc(t('set.cmaBody'))}</p>
        <div class="cma-grid">${CMA_FIELDS.map(([k, unit]) => `<label><span>${esc(t('cma.' + k))}</span><span class="with-unit"><input data-cma="${k}" inputmode="decimal" value="${p.cma[k]}"><em>${unit}</em></span></label>`).join('')}</div>
        <div class="btn-row"><button class="btn btn-sm" data-act="cmaReset">${esc(t('set.cmaReset'))}</button></div>`) : ''}
      ${card(t('set.data'), `
        <p class="muted small">${esc(t('set.dataBody'))}</p>
        <div class="btn-row">
          <button class="btn" data-act="backup">${esc(t('set.backup'))}</button>
          <button class="btn" data-act="restore">${esc(t('set.restore'))}</button>
          <input type="file" id="restoreFile" accept=".json,application/json" hidden>
          <button class="btn" data-act="demo">${esc(t('pf.loadDemo'))}</button>
          <button class="btn btn-danger" data-act="reset">${esc(t('set.reset'))}</button>
        </div>`)}
      ${card(t('set.about'), `<p class="muted small">${esc(t('set.aboutBody'))}</p><p class="muted small">${esc(t('rep.disclaimer'))}</p>`)}
    `;

    const num = s => parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
    root.querySelector('#pfForm')?.addEventListener('change', e => {
      const { name, value } = e.target;
      store.update(pp => {
        if (name === 'riskFree') { const x = num(value); if (Number.isFinite(x)) pp.risk.riskFree = x; }
        else if (name === 'valDate') pp.valDate = value === todayISO() ? '' : value;
        else if (name === 'baseCcy') {
          // Keep the EUR-cross table; converting to a new base just re-reads it.
          pp.baseCcy = value;
        } else pp[name] = value;
      }, t('set.portfolio'));
    });
    root.querySelectorAll('[data-fx]').forEach(inp => inp.addEventListener('change', e => {
      const c = e.target.dataset.fx, x = num(e.target.value);
      if (!(x > 0)) { toast(t('set.fxInvalid'), { tone: 'warn' }); return; }
      // Stored as EUR crosses: EUR per CCY follows from base-per-CCY and EUR-per-base.
      store.update(pp => { const eurBase = pp.fxEur[pp.baseCcy]; pp.fxEur[c] = eurBase / x; pp.fxSource = 'manual'; }, t('set.fx'));
    }));
    root.querySelectorAll('[data-cma]').forEach(inp => inp.addEventListener('change', e => {
      const x = num(e.target.value);
      if (Number.isFinite(x)) store.update(pp => { pp.cma[e.target.dataset.cma] = x; }, t('set.cma'));
    }));
    root.querySelector('#restoreFile').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const n = store.importWorkspace(JSON.parse(await f.text()), { merge: true });
        toast(t('set.restored', { n }));
      } catch (err) { toast(t('set.restoreError'), { tone: 'warn' }); }
    });
    root.onclick = async e => {
      const seg = e.target.closest('[data-seg]');
      if (seg) { store.setSetting(seg.dataset.seg, seg.dataset.value); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ecb') fetchEcb();
      if (act === 'cmaReset') store.update(pp => { pp.cma = { ...store.DEFAULT_CMA }; }, t('set.cma'));
      if (act === 'backup') downloadBlob(store.exportWorkspace(), 'application/json', `nexus-portfolio-lab-backup-${todayISO()}.json`);
      if (act === 'restore') root.querySelector('#restoreFile').click();
      if (act === 'demo') loadDemo();
      if (act === 'reset' && await confirmDialog(t('set.resetConfirm'), { danger: true, ok: t('set.reset') })) { store.resetWorkspace(); toast(t('set.resetDone')); }
    };
  }
};

// ECB reference rates via the free Frankfurter API (no key, CORS enabled). Rates are EUR-based,
// which is exactly how they are stored.
async function fetchEcb() {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=EUR');
    if (!res.ok) throw new Error(res.status);
    const j = await res.json();
    store.update(pp => {
      pp.fxEur = { ...pp.fxEur, ...j.rates, EUR: 1 };
      pp.fxSource = 'ecb';
      pp.fxDate = j.date;
    }, t('set.fx'));
    toast(t('set.ecbDone', { d: j.date }));
  } catch (e) {
    toast(t('set.ecbError'), { tone: 'warn', ms: 7000 });
  }
}
