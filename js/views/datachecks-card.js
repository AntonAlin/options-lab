// The data-check findings (js/datachecks.js) as a card, shared by Bulk upload and Holdings.
import { t } from '../i18n.js';
import { esc, card, table, fmtNum, fmtPct } from '../ui.js';

const px = x => fmtNum(x, Math.abs(x) >= 100 ? 2 : 4);
function detail(f) {
  const d = f.detail;
  switch (f.kind) {
    case 'unit': return t('dc.d.unit', { a: px(d.from), b: px(d.to), r: fmtNum(d.ratio, 1) });
    case 'qty_scale': return t('dc.d.qty', { a: fmtNum(d.from, 0), b: fmtNum(d.to, 0) });
    case 'jump': return t(d.basis === 'history' ? 'dc.d.jumpHist' : d.basis === 'file' ? 'dc.d.jumpFile' : 'dc.d.jumpFloor', { a: px(d.from), b: px(d.to), r: fmtPct(d.ret, 1, { sign: true }), z: d.z == null ? '' : fmtNum(d.z, 0) });
    case 'stale': return t('dc.d.stale', { p: px(d.price), d: d.since || '—' });
    case 'price_missing': return t('dc.d.missing', { a: px(d.from) });
    case 'price_nonpositive': return t('dc.d.nonpositive', { p: fmtNum(d.price, 2) });
    case 'ccy': return t('dc.d.ccy', { a: d.from, b: d.to });
    case 'sign': return t('dc.d.sign', { a: fmtNum(d.from, 0), b: fmtNum(d.to, 0) });
    case 'dropped': return t('dc.d.dropped', { w: fmtPct(d.weight, 1) });
    default: return '';
  }
}

export function dataChecksCard(res, { sub = '', compact = false } = {}) {
  if (!res) return '';
  if (!res.flags.length) return compact ? '' : card(t('dc.title'), `<p class="muted small">${esc(t('dc.none', { n: res.compared }))}</p>`, { sub: esc(sub) });
  return card(t('dc.title'), table([
    { key: 's', label: '', fmt: f => `<span class="chip ${f.severity === 'error' ? 'chip-breach' : 'chip-warn'}">${esc(t('dc.sev.' + f.severity))}</span>` },
    { key: 'k', label: t('dc.check'), fmt: f => esc(t('dc.kind.' + f.kind)) },
    { key: 'n', label: t('col.name'), fmt: f => esc(f.name) },
    { key: 'd', label: t('dc.detail'), fmt: f => esc(detail(f)) }
  ], res.flags, { dense: true, maxRows: 50 }) + `<p class="muted small">${esc(t('dc.help'))}</p>`, {
    sub: esc(sub + ' ' + t('dc.count', { e: res.errors, w: res.warnings })),
    cls: res.errors ? 'card-alert' : ''
  });
}
