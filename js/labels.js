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
