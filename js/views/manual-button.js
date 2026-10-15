// "Download the complete manual" on the User guide and How we calculate pages: the text file built
// by js/manual.js, generated in the browser like every other download.
import { t } from '../i18n.js';
import { esc } from '../ui.js';
import { downloadBlob, todayISO } from '../util.js';
import { buildManual, MANUAL_FILENAME } from '../manual.js';

export const manualButton = () => `<button class="btn" data-manual>${esc(t('guide.manual'))}</button>`;
export function bindManualButton(root) {
  root.querySelector('[data-manual]')?.addEventListener('click', () => downloadBlob('\ufeff' + buildManual({ date: todayISO() }), 'text/plain;charset=utf-8', MANUAL_FILENAME));
}
