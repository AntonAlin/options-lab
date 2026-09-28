// Presentation data shared by the Asset allocation page and the PDF: class and group labels in
// the current language, and the allocation tree / overlay rows with colours attached.
import { L, lang } from './i18n.js';
import { ASSET_CLASSES, REGIONS, typeLabel } from './instruments.js';
import { allocationTree } from './allocation.js';
import * as charts from './charts.js';

export const classLabel = k => L(ASSET_CLASSES[k] || { en: k });
export function groupLabel(key) {
  if (key.startsWith('type:')) return typeLabel(key.slice(5), lang());
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
