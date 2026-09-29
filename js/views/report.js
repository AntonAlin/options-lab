import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, toast } from '../ui.js';
import { SECTIONS, generateReport, reportFilename } from '../report.js';

// Report settings are kept per portfolio in memory for the session (commentary can be long and
// is usually month-specific, so it is not persisted).
const drafts = new Map();

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const d = drafts.get(p.id) || { title: '', manager: p.manager || '', commentary: '', sections: SECTIONS.filter(s => s !== 'holdings' || p.positions.length <= 80) };
    drafts.set(p.id, d);
    const available = s => s === 'performance' ? !!a.perf : s === 'fixedIncome' ? a.v.valid.some(x => x.r.fi) : s === 'cashflow' ? !!(a.cf && a.cf.events.length) : s === 'nav' ? !!(a.nav && a.nav.ok) : s === 'derivatives' ? !!(a.db && a.db.count) : s === 'pnl' ? !!(a.pnl && a.pnl.covered.length) : true;

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
    `;

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
