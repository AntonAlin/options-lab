// Before/after tables shared by the Changes and Pre-trade pages.
import { t } from '../i18n.js';
import { esc, table, fmtPct, fmtNum, fmtMoney, statusChip } from '../ui.js';
import { isNum } from '../util.js';

// [key, label key, formatter, which way is worse ('up' | 'down' | '')]
const pct = d => x => fmtPct(x, d);
export const METRICS = [
  ['nav', 'cmp.m.nav', null, ''],
  ['n', 'cmp.m.n', x => fmtNum(x, 0), ''],
  ['varPct', 'cmp.m.var', pct(2), 'up'],
  ['esPct', 'cmp.m.es', pct(2), 'up'],
  ['volPct', 'cmp.m.vol', pct(1), 'up'],
  ['equity', 'cmp.m.equity', pct(1), ''],
  ['duration', 'cmp.m.duration', x => fmtNum(x, 2), ''],
  ['spreadDuration', 'cmp.m.spreadDuration', x => fmtNum(x, 2), ''],
  ['gross', 'cmp.m.gross', pct(1), 'up'],
  ['commitment', 'cmp.m.commitment', pct(1), 'up'],
  ['cash', 'cmp.m.cash', pct(1), ''],
  ['liq1', 'cmp.m.liq1', pct(0), 'down'],
  ['liq7', 'cmp.m.liq7', pct(0), 'down'],
  ['illiquid', 'cmp.m.illiquid', pct(1), 'up'],
  ['top10', 'cmp.m.top10', pct(1), 'up'],
  ['maxIssuer', 'cmp.m.maxIssuer', pct(1), 'up'],
  ['breaches', 'cmp.m.breaches', x => fmtNum(x, 0), 'up'],
  ['warnings', 'cmp.m.warnings', x => fmtNum(x, 0), 'up']
];

export function metricsTable(before, after, base, { labels = [t('cmp.before'), t('cmp.after')] } = {}) {
  const rows = METRICS.map(([k, lab, f, worse]) => {
    const fmt = f || (x => fmtMoney(x, base, { compact: true }));
    const a = before[k], b = after[k];
    const d = isNum(a) && isNum(b) ? b - a : null;
    const tone = !d || Math.abs(d) < 1e-12 || !worse ? '' : (worse === 'up') === (d > 0) ? 'neg' : 'pos';
    const dTxt = d == null ? '—' : Math.abs(d) < 1e-12 ? '·' : (d > 0 ? '+' : '') + (k === 'nav' ? fmtMoney(d, base, { compact: true }) : ['varPct', 'esPct', 'volPct', 'equity', 'gross', 'commitment', 'cash', 'liq1', 'liq7', 'illiquid', 'top10', 'maxIssuer'].includes(k) ? fmtNum(d * 100, 2) + ' pp' : fmtNum(d, k === 'n' || k === 'breaches' || k === 'warnings' ? 0 : 2));
    return { label: t(lab), a: isNum(a) ? fmt(a) : '—', b: isNum(b) ? fmt(b) : '—', d: dTxt, tone };
  });
  return table([
    { key: 'label', label: t('cmp.metric'), fmt: r => esc(r.label) },
    { key: 'a', label: labels[0], align: 'right', fmt: r => r.a },
    { key: 'b', label: labels[1], align: 'right', fmt: r => `<strong>${r.b}</strong>` },
    { key: 'd', label: t('cmp.change'), align: 'right', fmt: r => `<span class="${r.tone}">${r.d}</span>` }
  ], rows, { dense: true });
}

// Only the rules whose status moved, worst first; empty text when nothing did.
export function rulesTable(changes) {
  const moved = changes.filter(r => r.from !== r.to).sort((a, b) => b.dir - a.dir);
  const still = changes.filter(r => r.from === r.to && r.to === 'breach');
  if (!moved.length && !still.length) return `<p class="muted small">${esc(t('cmp.rulesSame'))}</p>`;
  return table([
    { key: 'id', label: t('cmp.rule'), fmt: r => esc(t('limit.' + r.id)) },
    { key: 'a', label: t('cmp.before'), fmt: r => `${statusChip(r.from)} <span class="num small">${r.before ? fmtNum(r.before.value, 2) + ' %' : ''}</span>` },
    { key: 'b', label: t('cmp.after'), fmt: r => `${statusChip(r.to)} <span class="num small">${r.after ? fmtNum(r.after.value, 2) + ' %' : ''}</span>` },
    { key: 'l', label: t('cmp.limit'), align: 'right', fmt: r => { const x = r.after || r.before; return x ? (x.dir === 'min' ? '≥ ' : '≤ ') + fmtNum(x.limit, 1) + ' %' : ''; } }
  ], [...moved, ...still], { dense: true });
}
