// Setup: the page every portfolio page shows until a data source is connected. There is no
// built-in demo portfolio: the demo is a file (js/demofile.js) the user downloads, saves where the
// organisation keeps its files and connects, exactly as they would their real holdings.
import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, toast } from '../ui.js';
import * as sources from '../sources.js';
import { sourceCardHtml, bindSourceCard } from './source-card.js';
import { demoCSV, demoWorkbook, demoDate } from '../demofile.js';
import { XLSX_URL, XLSX_SRI } from '../importer.js';
import { downloadBlob, loadScript, todayISO } from '../util.js';

// kind: 'xlsx' | 'csv' | 'template' (the workbook with headers only)
export async function downloadDemo(kind) {
  const date = demoDate(todayISO());
  try {
    if (kind === 'csv') { downloadBlob(demoCSV(date), 'text/csv;charset=utf-8', 'nexus-holdings-demo.csv'); return; }
    await loadScript(XLSX_URL, { integrity: XLSX_SRI });
    const X = window.XLSX;
    const wb = demoWorkbook(X, date, { empty: kind === 'template' });
    downloadBlob(new Blob([X.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), kind === 'template' ? 'nexus-holdings-template.xlsx' : 'nexus-holdings-demo.xlsx');
  } catch (err) { console.error(err); toast(t('err.lib'), { tone: 'warn' }); }
}
export const demoButtons = (primary = false) => `<div class="btn-row">
    <button class="btn ${primary ? 'btn-primary' : ''}" data-demo="xlsx">${esc(t('setup.dlXlsx'))}</button>
    <button class="btn" data-demo="csv">${esc(t('setup.dlCsv'))}</button>
    <button class="btn" data-demo="template">${esc(t('setup.dlTemplate'))}</button>
  </div>`;
export function bindDemoButtons(root) {
  const onClick = e => { const k = e.target.closest('[data-demo]')?.dataset.demo; if (k) downloadDemo(k); };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

export default {
  noPortfolio: true,
  render(root) {
    const draw = () => {
      const local = store.listPortfolios().filter(p => !sources.isSourced(p)).length;
      const waiting = sources.list().filter(s => s.status.state === 'needs-permission');
      root.innerHTML = `
        ${pageHead(t('setup.title'), esc(t('setup.sub')))}
        ${!sources.initialised() ? `<p class="muted">${esc(t('setup.checking'))}</p>` : ''}
        ${waiting.length ? `<div class="alert alert-info"><span>${esc(t('setup.waiting', { list: waiting.map(s => s.name).join(', ') }))}</span></div>` : ''}
        ${sourceCardHtml()}
        ${local ? `<p class="muted small">${esc(t('setup.localPortfolios', { n: local }))}</p>` : ''}
        ${card(t('setup.demoTitle'), `<p>${esc(t('setup.demoBody'))}</p>${demoButtons(true)}<p class="muted small">${esc(t('setup.demoNote'))}</p>`, { sub: esc(t('setup.demoSub')) })}
        ${card(t('setup.writeTitle'), `<ul class="guide-list">${['add', 'change', 'remove', 'log', 'lock', 'api'].map(k => `<li>${esc(t('setup.write.' + k))}</li>`).join('')}</ul>`, { sub: esc(t('setup.writeSub')) })}`;
    };
    draw();
    // The card redraws itself; the page redraws when the list of sources changes shape.
    let shape = '';
    const off = sources.onChange(() => { const s = sources.list().map(x => x.id + x.status.state).join() + sources.initialised(); if (s !== shape) { shape = s; draw(); } });
    const offCard = bindSourceCard(root);
    const offDemo = bindDemoButtons(root);
    return () => { off(); offCard(); offDemo(); };
  }
};
