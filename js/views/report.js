import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, toast, selectHtml, fmtNum } from '../ui.js';
import { SECTIONS, generateReport, reportFilename } from '../report.js';
import { buildTPT, tptFilename } from '../tptout.js';
import { toCSV } from '../importer.js';
import { downloadBlob, todayISO } from '../util.js';
import { downloadWorkbook } from '../xlsxout.js';

// Report settings are kept per portfolio in memory for the session (commentary can be long and
// is usually month-specific, so it is not persisted).
const drafts = new Map();

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const d = drafts.get(p.id) || { title: '', manager: p.manager || '', commentary: '', sections: SECTIONS.filter(s => s !== 'holdings' || p.positions.length <= 80) };
    drafts.set(p.id, d);
    const available = s => s === 'performance' ? !!a.perf : s === 'fixedIncome' ? a.v.valid.some(x => x.r.fi) : s === 'cashflow' ? !!(a.cf && a.cf.events.length) : s === 'nav' ? !!(a.nav && a.nav.ok) : s === 'derivatives' ? !!(a.db && a.db.count) : s === 'pnl' ? !!(a.pnl && a.pnl.covered.length) : s === 'controlLog' ? !!(p.controlLog && p.controlLog.length) : true;

    root.innerHTML = `
      ${pageHead(t('nav.report'), esc(t('rep.sub')))}
      <div class="grid-2 report-grid">
        ${card(t('rep.settings'), `
          <form id="repForm" class="form-stack">
            <label><span>${esc(t('rep.title'))}</span><input name="title" value="${esc(d.title)}" placeholder="${esc(t('rep.defaultTitle'))}"></label>
            <label><span>${esc(t('pf.manager'))}</span><input name="manager" value="${esc(d.manager)}"></label>
            <label><span>${esc(t('rep.commentary'))}</span><textarea name="commentary" rows="7" placeholder="${esc(t('rep.commentaryPh'))}">${esc(d.commentary)}</textarea></label>
          </form>`)}
        ${card(t('rep.sections'), `
          <div class="check-list">${SECTIONS.map(s => `<label class="check ${available(s) ? '' : 'disabled'}"><input type="checkbox" data-sec="${s}" ${d.sections.includes(s) && available(s) ? 'checked' : ''} ${available(s) ? '' : 'disabled'}>
            <span><strong>${esc(t('rep.sec.' + s))}</strong><small>${esc(available(s) ? t('rep.sec.' + s + '.help') : t('rep.unavailable.' + s))}</small></span></label>`).join('')}</div>
          <div class="btn-row">
            <button class="btn btn-primary btn-lg" id="genPdf">${esc(t('rep.download'))}</button>
          </div>
          <p class="muted small">${esc(t('rep.privacy'))}</p>`)}
      </div>
      ${tptCard(p, a)}
    `;

    bindTpt(root, p, a, app);
    const form = root.querySelector('#repForm');
    form.addEventListener('input', () => { const f = new FormData(form); d.title = f.get('title'); d.manager = f.get('manager'); d.commentary = f.get('commentary'); });
    root.querySelectorAll('[data-sec]').forEach(cb => cb.addEventListener('change', () => {
      d.sections = [...root.querySelectorAll('[data-sec]:checked')].map(x => x.dataset.sec);
    }));
    root.querySelector('#genPdf').onclick = async e => {
      const btn = e.currentTarget;
      if (!d.sections.length) { toast(t('rep.pickOne'), { tone: 'warn' }); return; }
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = t('rep.generating');
      try {
        const doc = await generateReport(p, a, d);
        doc.save(reportFilename(p, a.v));
        toast(t('rep.done'));
      } catch (err) {
        console.error(err);
        toast(t('err.pdf'), { tone: 'warn', ms: 7000 });
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    };
  }
};

// ---- TPT for the fund's investors ---------------------------------------------------------------------
// The identifying code and share class are kept on the portfolio (p.tpt); the report date is today.
const tptCfg = p => ({ id: '', classId: '', ...(p.tpt || {}) });
function tptShareClass(p, cfg) {
  const classes = p.fund?.classes || [];
  return classes.find(c => c.id === cfg.classId) || (classes.length === 1 ? classes[0] : null);
}
function tptCard(p, a) {
  const cfg = tptCfg(p);
  const classes = p.fund?.classes || [];
  const out = buildTPT(p, a.v, { id: cfg.id, shareClass: tptShareClass(p, cfg), reportDate: todayISO() });
  const warn = out.warnings.map(w => `<li>${esc(t('tpt.w.' + w.code, { name: w.name || '', n: w.n || 0, type: w.type || '', list: w.list || '' }))}</li>`).join('');
  return card(t('tpt.title'), `
    <p>${esc(t('tpt.body'))}</p>
    <form id="tptForm" class="form-grid">
      <label>${esc(t('tpt.id'))}<input name="id" value="${esc(cfg.id)}" placeholder="SE0000000000" autocomplete="off"></label>
      ${classes.length > 1 ? `<label>${esc(t('tpt.class'))}${selectHtml('name="classId"', [['', t('tpt.classNone')], ...classes.map(c => [c.id, c.name])], cfg.classId)}</label>` : ''}
    </form>
    <p class="small">${esc(t('tpt.summary', { n: out.positions, d: a.v.ctx.valDate, nav: fmtNum(a.v.nav, 0), ccy: p.baseCcy }))}</p>
    ${warn ? `<div class="alert alert-warn"><ul class="guide-list">${warn}</ul></div>` : ''}
    <div class="btn-row">
      <button class="btn btn-primary" data-tpt="xlsx">${esc(t('tpt.xlsx'))}</button>
      <button class="btn" data-tpt="csv">${esc(t('tpt.csv'))}</button>
    </div>
    <p class="muted small">${esc(t('tpt.note'))}</p>`, { sub: esc(t('tpt.sub')), id: 'tptCard' });
}
function bindTpt(root, p, a, app) {
  const form = root.querySelector('#tptForm');
  form?.addEventListener('change', () => {
    const f = Object.fromEntries(new FormData(form));
    store.update(pp => { pp.tpt = { ...tptCfg(pp), id: String(f.id || '').trim().toUpperCase(), ...(f.classId !== undefined ? { classId: f.classId } : {}) }; }, t('tpt.title'));
    app.rerender();
  });
  form?.addEventListener('submit', e => e.preventDefault());
  root.querySelector('#tptCard')?.addEventListener('click', async e => {
    const kind = e.target.closest('[data-tpt]')?.dataset.tpt;
    if (!kind) return;
    const cfg = tptCfg(p);
    const out = buildTPT(p, a.v, { id: cfg.id, shareClass: tptShareClass(p, cfg), reportDate: todayISO() });
    if (kind === 'csv') { downloadBlob('\ufeff' + toCSV(out.rows, ';'), 'text/csv;charset=utf-8', tptFilename(p, a.v, 'csv')); return; }
    const dateCols = new Set(out.rows[0].map((h, c) => (/^(6|7|39|43)_/.test(h) ? c : -1)).filter(c => c >= 0));
    try { await downloadWorkbook(tptFilename(p, a.v, 'xlsx'), [{ name: 'TPT', rows: out.rows, dateCols }]); }
    catch (err) { console.error(err); toast(t('err.lib'), { tone: 'warn' }); }
  });
}
