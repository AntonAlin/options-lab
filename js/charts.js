// Plotly wrappers. Spec builders are pure ({ data, layout }) so the same chart renders on
// screen in the current theme and into the PDF in the light print theme.
//
// Styling follows the Options Lab: gradient-filled areas, 2.5 px lines with an end-point marker,
// rounded bars, soft grids and a neon palette in dark mode.
import { locale, lang } from './i18n.js';
import { isNum } from './util.js';

const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const THEMES = {
  light: {
    surface: '#ffffff', ink: '#0f172a', ink2: '#475569', muted: '#94a3b8', grid: 'rgba(15,23,42,0.06)', axis: 'rgba(15,23,42,0.18)',
    series: ['#4f46e5', '#0891b2', '#059669', '#d97706', '#db2777', '#0284c7', '#7c3aed', '#dc2626'],
    pos: '#059669', neg: '#e11d48', mid: '#f1f5f9', accent: '#4f46e5',
    hover: '#0f172a', hoverInk: '#f8fafc'
  },
  dark: {
    surface: '#0f0f18', ink: '#f1f5f9', ink2: '#cbd5e1', muted: '#64748b', grid: 'rgba(255,255,255,0.045)', axis: 'rgba(255,255,255,0.14)',
    series: ['#818cf8', '#22d3ee', '#34d399', '#fbbf24', '#f472b6', '#38bdf8', '#c084fc', '#fb7185'],
    pos: '#34d399', neg: '#fb7185', mid: '#1e1b4b', accent: '#818cf8',
    hover: 'rgba(12,12,20,0.96)', hoverInk: '#e2e8f0'
  }
};
export function currentTheme() {
  return typeof document !== 'undefined' && document.documentElement.dataset.resolvedTheme === 'dark' ? 'dark' : 'light';
}
export const palette = (theme = currentTheme()) => THEMES[theme];

// Asset classes keep the same colour on every chart.
export const CLASS_ORDER = ['equity', 'fixed_income', 'money_market', 'cash', 'commodity', 'currency', 'alternative', 'mixed'];
export const classColor = (cls, theme) => palette(theme).series[Math.max(0, CLASS_ORDER.indexOf(cls)) % 8];

export function rgba(hex, a) {
  if (hex.startsWith('rgba')) return hex;
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map(c => c + c).join('') : m, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function axis(P, extra = {}) {
  return {
    gridcolor: P.grid, zerolinecolor: P.axis, zerolinewidth: 1, linecolor: 'rgba(0,0,0,0)', showline: false,
    tickfont: { color: P.muted, size: 11 }, automargin: true, ticks: '', ...extra
  };
}
function baseLayout(th, extra = {}) {
  const P = THEMES[th];
  return {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: FONT, size: 12, color: P.ink2 },
    margin: { l: 8, r: 16, t: 10, b: 28 },
    xaxis: axis(P), yaxis: axis(P),
    hoverlabel: { bgcolor: P.hover, bordercolor: rgba(P.accent, 0.5), font: { family: FONT, color: P.hoverInk, size: 12 } },
    legend: { orientation: 'h', y: 1.1, x: 0, yanchor: 'bottom', font: { color: P.ink2, size: 11 }, bgcolor: 'rgba(0,0,0,0)' },
    showlegend: false,
    barcornerradius: 5,
    separators: lang() === 'sv' ? ', ' : '.,',
    ...extra
  };
}
const pctTick = { tickformat: '.0%' };

// ---- bars -------------------------------------------------------------------------------------------
// items: [{ label, value, color?, text? }], fmt: 'pct' | 'num'
export function barHSpec(items, { th = currentTheme(), fmt = 'pct', color = null, height = null, colorFn = null, diverging = false } = {}) {
  const P = THEMES[th];
  const rev = [...items].reverse();
  const colors = rev.map(it => it.color || (colorFn ? colorFn(it) : diverging ? (it.value >= 0 ? P.pos : P.neg) : color || P.series[0]));
  return {
    data: [{
      type: 'bar', orientation: 'h', y: rev.map(i => i.label), x: rev.map(i => i.value),
      marker: { color: colors.map(c => rgba(c, 0.85)), line: { color: colors, width: 1 } },
      text: rev.map(i => i.text ?? ''), textposition: diverging ? 'auto' : 'outside', cliponaxis: false,
      insidetextfont: { color: '#ffffff', size: 11 }, textfont: { color: P.ink2, size: 11 },
      hovertemplate: fmt === 'pct' ? '<b>%{y}</b><br>%{x:.2%}<extra></extra>' : '<b>%{y}</b><br>%{x:,.0f}<extra></extra>'
    }],
    layout: baseLayout(th, {
      height: height || Math.max(170, 30 * items.length + 50), bargap: 0.38,
      xaxis: axis(P, { ...(fmt === 'pct' ? pctTick : {}), zeroline: true }),
      yaxis: axis(P, { gridcolor: 'rgba(0,0,0,0)', tickfont: { color: P.ink2, size: 12 } })
    })
  };
}

// Two measures side by side (e.g. market value vs net exposure), same axis.
export function barHGroupedSpec(labels, series, { th = currentTheme(), fmt = 'pct', height = null } = {}) {
  const P = THEMES[th];
  const rl = [...labels].reverse();
  return {
    data: series.map((s, i) => ({
      type: 'bar', orientation: 'h', name: s.name, y: rl, x: [...s.values].reverse(),
      marker: { color: rgba(P.series[i], 0.85), line: { color: P.series[i], width: 1 } },
      hovertemplate: `<b>%{y}</b><br>${s.name}: ${fmt === 'pct' ? '%{x:.2%}' : '%{x:,.0f}'}<extra></extra>`
    })),
    layout: baseLayout(th, {
      barmode: 'group', bargap: 0.28, bargroupgap: 0.1, showlegend: true,
      height: height || Math.max(210, 42 * labels.length + 80),
      xaxis: axis(P, fmt === 'pct' ? pctTick : {}),
      yaxis: axis(P, { gridcolor: 'rgba(0,0,0,0)', tickfont: { color: P.ink2, size: 12 } })
    })
  };
}

export function barVSpec(labels, values, { th = currentTheme(), fmt = 'num', diverging = false, color = null, height = 260 } = {}) {
  const P = THEMES[th];
  const colors = values.map(v => diverging ? (v >= 0 ? P.pos : P.neg) : color || P.series[0]);
  return {
    data: [{
      type: 'bar', x: labels, y: values,
      marker: { color: colors.map(c => rgba(c, 0.85)), line: { color: colors, width: 1 } },
      text: values.map(v => (fmt === 'pct' ? (v * 100).toFixed(1) + '%' : '')), textposition: fmt === 'pct' ? 'outside' : 'none', cliponaxis: false,
      textfont: { color: P.ink2, size: 11 },
      hovertemplate: fmt === 'pct' ? '<b>%{x}</b><br>%{y:.2%}<extra></extra>' : '<b>%{x}</b><br>%{y:,.0f}<extra></extra>'
    }],
    layout: baseLayout(th, {
      height, bargap: 0.35,
      yaxis: axis(P, fmt === 'pct' ? pctTick : {}),
      xaxis: axis(P, { gridcolor: 'rgba(0,0,0,0)', type: 'category', tickfont: { color: P.ink2, size: 12 } })
    })
  };
}

// Stacked monthly amounts (inflows up, outflows down) with an optional running total on the
// same currency axis — one unit, so no second y-axis.
export function stackedBarSpec(labels, series, { th = currentTheme(), height = 320, line = null } = {}) {
  const P = THEMES[th];
  const data = series.map((s, i) => ({
    type: 'bar', name: s.name, x: labels, y: s.values,
    marker: { color: rgba(s.color || P.series[i % 8], 0.85), line: { color: s.color || P.series[i % 8], width: 1 } },
    hovertemplate: `${s.name}: <b>%{y:,.0f}</b><extra></extra>`
  }));
  if (line) data.push({
    type: 'scatter', mode: 'lines+markers', name: line.name, x: labels, y: line.values,
    line: { color: P.ink2, width: 2, dash: 'dot' }, marker: { size: 6, color: P.ink2 },
    hovertemplate: `${line.name}: <b>%{y:,.0f}</b><extra></extra>`
  });
  return {
    data,
    layout: baseLayout(th, {
      height, barmode: 'relative', bargap: 0.3, showlegend: true, hovermode: 'x unified',
      legend: { orientation: 'h', y: 1.02, x: 0, yanchor: 'bottom', font: { color: P.ink2, size: 11 } },
      margin: { l: 8, r: 16, t: 30, b: 28 },
      xaxis: axis(P, { gridcolor: 'rgba(0,0,0,0)', type: 'category', tickfont: { color: P.ink2, size: 11 } }),
      yaxis: axis(P, { zeroline: true, separatethousands: true, tickformat: '~s' })
    })
  };
}

// ---- allocation ------------------------------------------------------------------------------------
// Physical holdings plus derivative overlay per class, stacked (overlay can be negative), with the
// resulting economic weight as a diamond and the mandate range as a thin band behind the bars.
// rows: [{ label, physical, overlay, econ, color, min?, max?, target? }] as weights of NAV.
export function overlaySpec(rows, { th = currentTheme(), names = {}, height = null } = {}) {
  const P = THEMES[th];
  const r = [...rows].reverse();
  const y = r.map(x => x.label);
  const pct = '%{x:.1%}';
  const data = [
    { type: 'bar', orientation: 'h', name: names.physical || 'Physical', y, x: r.map(x => x.physical),
      marker: { color: r.map(x => rgba(x.color, 0.85)), line: { color: r.map(x => x.color), width: 1 } },
      hovertemplate: `<b>%{y}</b><br>${names.physical || 'Physical'}: ${pct}<extra></extra>` },
    { type: 'bar', orientation: 'h', name: names.overlay || 'Derivatives', y, x: r.map(x => x.overlay),
      marker: { color: r.map(x => rgba(x.color, 0.28)), line: { color: r.map(x => x.color), width: 1.5, dash: 'dot' }, pattern: { shape: '/', fgcolor: r.map(x => rgba(x.color, 0.7)), size: 6 } },
      hovertemplate: `<b>%{y}</b><br>${names.overlay || 'Derivatives'}: ${pct}<extra></extra>` },
    { type: 'scatter', mode: 'markers+text', name: names.econ || 'Economic', y, x: r.map(x => x.econ),
      marker: { symbol: 'diamond', size: 12, color: P.ink, line: { color: P.surface, width: 2 } },
      text: r.map(x => (x.econ * 100).toFixed(1) + '%'), textposition: 'middle right', textfont: { color: P.ink, size: 11 }, cliponaxis: false,
      hovertemplate: `<b>%{y}</b><br>${names.econ || 'Economic'}: ${pct}<extra></extra>` }
  ];
  const withTarget = r.filter(x => isNum(x.target));
  if (withTarget.length) data.push({
    type: 'scatter', mode: 'markers', name: names.target || 'Target', y: withTarget.map(x => x.label), x: withTarget.map(x => x.target),
    marker: { symbol: 'line-ns-open', size: 22, color: P.accent, line: { width: 3, color: P.accent } },
    hovertemplate: `<b>%{y}</b><br>${names.target || 'Target'}: ${pct}<extra></extra>`
  });
  const shapes = r.map((x, i) => (isNum(x.min) || isNum(x.max)) ? {
    type: 'rect', xref: 'x', yref: 'y', x0: isNum(x.min) ? x.min : 0, x1: isNum(x.max) ? x.max : Math.max(1, x.econ), y0: i - 0.45, y1: i + 0.45,
    fillcolor: rgba(P.accent, 0.08), line: { color: rgba(P.accent, 0.35), width: 1, dash: 'dot' }, layer: 'below'
  } : null).filter(Boolean);
  return {
    data,
    layout: baseLayout(th, {
      barmode: 'relative', bargap: 0.35, showlegend: true, shapes,
      height: height || Math.max(220, 44 * rows.length + 80),
      legend: { orientation: 'h', y: 1.02, x: 0, yanchor: 'bottom', font: { color: P.ink2, size: 11 } },
      margin: { l: 8, r: 50, t: 30, b: 28 },
      xaxis: axis(P, { ...pctTick, zeroline: true }),
      yaxis: axis(P, { gridcolor: 'rgba(0,0,0,0)', tickfont: { color: P.ink2, size: 12 } })
    })
  };
}

// Class → group → holding as a sunburst or treemap. nodes: [{ id, parent, label, size, signed, weight,
// color, short }]; sizes are absolute, shorts are drawn hatched so they stand out from longs.
export function hierarchySpec(nodes, { th = currentTheme(), kind = 'sunburst', height = 460, shortLabel = 'short' } = {}) {
  const P = THEMES[th];
  const trace = {
    type: kind, ids: nodes.map(n => n.id), parents: nodes.map(n => n.parent), values: nodes.map(n => n.size),
    labels: nodes.map(n => n.label), branchvalues: 'total', sort: true,
    customdata: nodes.map(n => [n.weight, n.short ? ` (${shortLabel})` : '']),
    marker: {
      colors: nodes.map(n => rgba(n.color, n.parent === '' ? 0.92 : n.short ? 0.35 : n.kind === 'group' ? 0.7 : 0.5)),
      line: { color: th === 'dark' ? '#0b0b12' : '#ffffff', width: 1.5 },
      ...(kind === 'treemap' ? { pattern: { shape: nodes.map(n => (n.short ? '/' : '')), fgcolor: P.neg, size: 7 } } : {})
    },
    insidetextfont: { family: FONT, color: th === 'dark' ? '#f8fafc' : '#0f172a' },
    hovertemplate: '<b>%{label}</b>%{customdata[1]}<br>%{customdata[0]:+.2%} NAV<br>%{percentRoot:.1%}<extra></extra>',
    texttemplate: '%{label}<br>%{customdata[0]:.1%}'
  };
  if (kind === 'sunburst') Object.assign(trace, { maxdepth: 3, insidetextorientation: 'radial', leaf: { opacity: 1 } });
  else Object.assign(trace, { maxdepth: 3, tiling: { pad: 2 }, pathbar: { visible: true, textfont: { family: FONT } }, textposition: 'middle center' });
  return { data: [trace], layout: baseLayout(th, { height, margin: { l: 4, r: 4, t: kind === 'treemap' ? 28 : 4, b: 4 } }) };
}

// ---- donut ---------------------------------------------------------------------------------------------
// items: [{ label, value, color? }] — share of total, centre shows `center` / `centerSub`.
export function donutSpec(items, { th = currentTheme(), height = 300, center = '', centerSub = '' } = {}) {
  const P = THEMES[th];
  const kept = items.filter(i => i.value > 0);
  return {
    data: [{
      type: 'pie', hole: 0.64, sort: false, direction: 'clockwise',
      labels: kept.map(i => i.label), values: kept.map(i => i.value),
      marker: { colors: kept.map((i, k) => i.color || P.series[k % 8]), line: { color: th === 'dark' ? '#0b0b12' : '#ffffff', width: 3 } },
      textinfo: 'none', hovertemplate: '<b>%{label}</b><br>%{percent:.1%}<extra></extra>'
    }],
    layout: baseLayout(th, {
      height, margin: { l: 8, r: 8, t: 8, b: 8 }, showlegend: true,
      legend: { orientation: 'v', x: 1.02, y: 0.5, yanchor: 'middle', font: { color: P.ink2, size: 12 }, itemclick: false, itemdoubleclick: false },
      annotations: [
        { text: `<b>${center}</b>`, x: 0.5, y: 0.54, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 20, color: P.ink, family: FONT } },
        { text: centerSub, x: 0.5, y: 0.42, xref: 'paper', yref: 'paper', showarrow: false, font: { size: 11, color: P.muted, family: FONT } }
      ]
    })
  };
}

// ---- lines ---------------------------------------------------------------------------------------------
// series: [{ name, y, color?, dash? }] against shared dates. area: gradient fill under the first series
// ('down' fades from the zero line downwards, for drawdowns). rangeButtons adds 1M…All selectors.
export function lineSpec(x, series, { th = currentTheme(), fmt = 'pct', height = 300, area = false, zero = false, rangeButtons = false, endMarkers = true } = {}) {
  const P = THEMES[th];
  const traces = [];
  series.forEach((s, i) => {
    const c = s.color || P.series[i];
    const y = s.y.map(v => (isNum(v) ? v : null));
    const t = {
      type: 'scatter', mode: 'lines', name: s.name, x, y,
      line: { color: c, width: i === 0 ? 2.6 : 1.8, dash: s.dash || 'solid', shape: 'linear' },
      hovertemplate: `${s.name}: <b>${fmt === 'num' ? '%{y:,.2f}' : '%{y:.2%}'}</b><extra></extra>`
    };
    if (area && i === 0) {
      t.fill = 'tozeroy';
      t.fillgradient = area === 'down'
        ? { type: 'vertical', colorscale: [[0, rgba(c, 0.45)], [1, rgba(c, 0)]] }
        : { type: 'vertical', colorscale: [[0, rgba(c, 0)], [1, rgba(c, th === 'dark' ? 0.32 : 0.22)]] };
    }
    traces.push(t);
    if (endMarkers) {
      let k = y.length - 1;
      while (k >= 0 && y[k] == null) k--;
      if (k >= 0) traces.push({ type: 'scatter', mode: 'markers', x: [x[k]], y: [y[k]], showlegend: false, hoverinfo: 'skip', marker: { size: 9, color: c, line: { color: th === 'dark' ? '#0b0b12' : '#ffffff', width: 2 } } });
    }
  });
  const xa = axis(P, {
    type: 'date', gridcolor: 'rgba(0,0,0,0)', showspikes: true, spikemode: 'across', spikesnap: 'cursor',
    spikecolor: rgba(P.accent, 0.5), spikethickness: 1, spikedash: 'dot'
  });
  if (rangeButtons) {
    xa.rangeselector = {
      x: 0, y: 1.02, yanchor: 'bottom',
      bgcolor: th === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)', activecolor: rgba(P.accent, 0.35),
      bordercolor: 'rgba(0,0,0,0)', font: { color: P.ink2, size: 11 },
      buttons: [
        { count: 1, label: lang() === 'sv' ? '1 mån' : '1M', step: 'month', stepmode: 'backward' },
        { count: 3, label: lang() === 'sv' ? '3 mån' : '3M', step: 'month', stepmode: 'backward' },
        { count: 6, label: lang() === 'sv' ? '6 mån' : '6M', step: 'month', stepmode: 'backward' },
        { count: 1, label: lang() === 'sv' ? 'I år' : 'YTD', step: 'year', stepmode: 'todate' },
        { count: 1, label: lang() === 'sv' ? '1 år' : '1Y', step: 'year', stepmode: 'backward' },
        { step: 'all', label: lang() === 'sv' ? 'Allt' : 'All' }
      ]
    };
  }
  return {
    data: traces,
    layout: baseLayout(th, {
      height, hovermode: 'x unified', showlegend: series.length > 1,
      legend: { orientation: 'h', y: rangeButtons ? 1.02 : 1.08, x: 1, xanchor: 'right', yanchor: 'bottom', font: { color: P.ink2, size: 11 } },
      margin: { l: 8, r: 16, t: rangeButtons ? 38 : series.length > 1 ? 28 : 10, b: 28 },
      xaxis: xa,
      yaxis: axis(P, { ...(fmt !== 'num' ? { tickformat: '.0%' } : {}), zeroline: zero })
    })
  };
}

// ---- heatmap / histogram ---------------------------------------------------------------------------------
export function heatmapSpec(labels, matrix, { th = currentTheme(), height = null, showValues = true } = {}) {
  const P = THEMES[th];
  return {
    data: [{
      type: 'heatmap', x: labels, y: labels, z: matrix, zmin: -1, zmax: 1,
      colorscale: [[0, P.neg], [0.5, P.mid], [1, th === 'dark' ? '#6366f1' : '#4f46e5']], xgap: 3, ygap: 3,
      texttemplate: showValues && labels.length <= 14 ? '%{z:.2f}' : '', textfont: { size: 10, color: th === 'dark' ? '#e2e8f0' : '#0f172a' },
      hovertemplate: '<b>%{y}</b> × <b>%{x}</b><br>ρ = %{z:.2f}<extra></extra>',
      colorbar: { thickness: 10, outlinewidth: 0, tickfont: { color: P.muted, size: 10 }, len: 0.8 }
    }],
    layout: baseLayout(th, {
      height: height || Math.max(340, 34 * labels.length + 130), margin: { l: 8, r: 8, t: 8, b: 8 },
      xaxis: axis(P, { tickangle: -40, gridcolor: 'rgba(0,0,0,0)', tickfont: { color: P.ink2, size: 11 } }),
      yaxis: axis(P, { autorange: 'reversed', gridcolor: 'rgba(0,0,0,0)', tickfont: { color: P.ink2, size: 11 } })
    })
  };
}

// Binned by hand so gains and losses get their own colour.
export function histogramSpec(values, { th = currentTheme(), height = 260, markers = [], bins = 50 } = {}) {
  const P = THEMES[th];
  const v = values.filter(isNum);
  if (!v.length) return { data: [], layout: baseLayout(th, { height }) };
  const lo = Math.min(...v), hi = Math.max(...v), w = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  v.forEach(x => { counts[Math.min(bins - 1, Math.max(0, Math.floor((x - lo) / w)))]++; });
  const mids = counts.map((_, i) => lo + (i + 0.5) * w);
  return {
    data: [{
      type: 'bar', x: mids, y: counts, width: w * 0.9,
      marker: { color: mids.map(m => rgba(m >= 0 ? P.pos : P.neg, 0.75)), line: { width: 0 } },
      hovertemplate: '%{x:.2%}: %{y}<extra></extra>'
    }],
    layout: baseLayout(th, {
      height, bargap: 0.05, barcornerradius: 2,
      xaxis: axis(P, { tickformat: '.1%', zeroline: false }),
      yaxis: axis(P),
      shapes: markers.map(m => ({ type: 'line', x0: m.x, x1: m.x, yref: 'paper', y0: 0, y1: 1, line: { color: P.neg, width: 1.5, dash: 'dot' } })),
      annotations: markers.map(m => ({ x: m.x, yref: 'paper', y: 1, text: m.label, showarrow: false, xanchor: 'right', font: { color: P.neg, size: 11 } }))
    })
  };
}

// ---- rendering -------------------------------------------------------------------------------------------
const CONFIG = { displayModeBar: false, responsive: true, locale: 'en' };
export function plotlyReady() { return typeof window !== 'undefined' && !!window.Plotly; }

export function render(el, spec) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el) return;
  if (!plotlyReady()) {
    el.innerHTML = `<div class="chart-fallback">${lang() === 'sv' ? 'Diagrambiblioteket kunde inte laddas (offline?). Siffrorna i tabellerna gäller fortfarande.' : 'The chart library could not load (offline?). The numbers in the tables still apply.'}</div>`;
    return;
  }
  window.Plotly.react(el, spec.data, { ...spec.layout, autosize: true }, CONFIG);
}

export async function toImage(spec, width = 900, height = null) {
  if (!plotlyReady()) return null;
  const h = height || spec.layout.height || 300;
  const layout = { ...spec.layout, width, height: h, paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff' };
  if (layout.xaxis && layout.xaxis.rangeselector) layout.xaxis = { ...layout.xaxis, rangeselector: { visible: false } };
  return window.Plotly.toImage({ data: spec.data, layout }, { format: 'png', width, height: h, scale: 2 });
}

export function purgeAll(root) {
  if (!plotlyReady()) return;
  root.querySelectorAll('.js-plotly-plot').forEach(el => window.Plotly.purge(el));
}

export { locale };
