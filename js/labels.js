// Presentation data shared by the Asset allocation page and the PDF: class and group labels, and
// the allocation tree / overlay rows with colours attached.
import { L, t } from './i18n.js';
import { ASSET_CLASSES, REGIONS, typeLabel } from './instruments.js';
import * as store from './store.js';
import { UNIT } from './rules.js';
import { isNum } from './util.js';
import { fmtNum } from './ui.js';
import { allocationTree } from './allocation.js';
import * as charts from './charts.js';

export const classLabel = k => L(ASSET_CLASSES[k] || { en: k });
export function groupLabel(key) {
  if (key.startsWith('type:')) return typeLabel(key.slice(5));
  if (REGIONS[key]) return L(REGIONS[key]);
  return key;
}

// Tree nodes with labels and colours attached, shared by the page and the PDF.
export function treeNodes(v, { measure, dim, base, th }) {
  return allocationTree(v, { measure, dim, base }).map(n => ({
    ...n,
    label: n.kind === 'class' ? classLabel(n.key) : n.kind === 'group' ? groupLabel(n.key) : n.key + (n.share != null && n.share < 1 ? ` (${Math.round(n.share * 100)} %)` : ''),
    color: charts.classColor(n.cls, th)
  }));
}

export function overlayRows(aa, th) {
  return aa.classes.map(c => ({
    label: classLabel(c.key), physical: aa.nav ? c.physical / aa.nav : 0, overlay: c.overlayW, econ: c.econW,
    color: charts.classColor(c.key, th), target: c.target, min: c.min, max: c.max
  }));
}

// Limits and rules: UCITS limits have a translated name; fund rules carry the name the user gave
// them (ids 'fr:…'); the VaR limit is a multiple (×) under the relative approach.
export function ruleName(id, p = store.active()) {
  if (String(id).startsWith('fr:')) return (p?.rules || []).find(r => 'fr:' + r.id === id)?.name || t('comp.deletedRule');
  return t('limit.' + id);
}
export function ruleUnit(id, p = store.active()) {
  if (String(id).startsWith('fr:')) { const r = (p?.rules || []).find(x => 'fr:' + x.id === id); return r ? UNIT[r.measure] ?? '%' : '%'; }
  return id === 'varRel' ? '×' : '%';
}
const withUnit = (x, u, d) => (isNum(x) ? fmtNum(x, u === '' ? 0 : d) + (u === '' ? '' : u === '%' ? ' %' : ' ' + u) : '—');
export const ruleVal = (r, d = 2) => (r ? withUnit(r.value, r.unit ?? ruleUnit(r.id), d) : '');
export const ruleLimit = (r, { ascii = false } = {}) => (r ? (r.dir === 'min' ? (ascii ? '>= ' : '≥ ') : (ascii ? '<= ' : '≤ ')) + withUnit(r.limit, r.unit ?? ruleUnit(r.id), 1) : '');
export const unitVal = (x, id, d = 2) => withUnit(x, ruleUnit(id), d);

// ---- performance statistics -----------------------------------------------------------------------------
// The words for one observation period of a return series ('daily' → Daily / day / days), so a
// month-end history says "Monthly VaR" and "Best month" instead of pretending to be daily.
export const freqWords = freq => ({ f: t('freq.' + freq), p: t('freq.p.' + freq), ps: t('freq.ps.' + freq) });
// Below this many returns a quantile, the best and worst period, the hit rate and the higher
// moments are anecdotes, not statistics: they are left out rather than shown with false precision.
export const MIN_TAIL_OBS = 20;
// The rows of the statistics table (page and PDF): [{ k, label, x, b, f }] with f 'pct' | 'pct0' | 'num'.
// Annualised ratios only with a year of history (perfStats.annualised); per-period tail figures
// only with MIN_TAIL_OBS returns.
export function perfStatRows(perf, { bench = true } = {}) {
  const B = bench ? perf.bench : null, w = freqWords(perf.freq);
  const ann = perf.annualised, tail = perf.n >= MIN_TAIL_OBS;
  const row = (label, k, f = 'pct', show = true) => (show ? [{ k, label, x: perf[k], b: B ? B[k] : null, f }] : []);
  const rel = (label, k, f = 'num', show = true) => (show && B ? [{ k, label, x: perf[k], b: null, f }] : []);
  return [
    ...row(t('perf.total'), 'total'), ...row(t('perf.cagr'), 'cagr', 'pct', ann), ...row(t('perf.vol'), 'vol'),
    ...row(t('perf.sharpe'), 'sharpe', 'num', ann), ...row(t('perf.sortino'), 'sortino', 'num', ann),
    ...row(t('perf.maxDD'), 'maxDD'), ...row(t('perf.calmar'), 'calmar', 'num', ann),
    ...row(t('perf.var95', w), 'var95', 'pct', tail), ...row(t('perf.es95', w), 'es95', 'pct', tail), ...row(t('perf.var99', w), 'var99', 'pct', tail),
    ...row(t('perf.best', w), 'best', 'pct', tail), ...row(t('perf.worst', w), 'worst', 'pct', tail), ...row(t('perf.hit', w), 'hitRate', 'pct0', tail),
    ...row(t('perf.skew'), 'skew', 'num', tail), ...row(t('perf.kurt'), 'kurt', 'num', tail),
    ...rel(t('perf.beta'), 'beta'), ...rel(t('perf.corr'), 'correlation'), ...rel(t('perf.alpha'), 'alpha', 'pct', ann),
    ...rel(t('perf.te'), 'trackingError', 'pct'), ...rel(t('perf.ir'), 'infoRatio', 'num', ann),
    ...rel(t('perf.upCap'), 'upCapture', 'pct0'), ...rel(t('perf.downCap'), 'downCapture', 'pct0')
  ];
}
// "4 months" / "2.9 years": how much history the figures rest on.
export function spanText(perf) {
  const d = perf.spanDays || 0;
  return d < 365 ? t('perf.spanMonths', { n: Math.max(1, Math.round(d / 30.44)) }) : t('perf.spanYears', { n: fmtNum(d / 365.25, 1) });
}
