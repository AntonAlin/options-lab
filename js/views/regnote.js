// The standing caveat on every page that reads regulation: rules change, and this is one reading.
import { t } from '../i18n.js';
import { esc } from '../ui.js';

export const REG_AS_OF = 'September 2026';
export function regNote(kind) {
  return `<div class="alert alert-warn reg-note" role="note"><span><strong>${esc(t('reg.title'))}</strong> ${esc(t('reg.note', { d: REG_AS_OF, refs: t('reg.refs.' + kind) }))}</span></div>`;
}
