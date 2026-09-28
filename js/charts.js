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

// Binned by hand so gains and losses get their own colour, like the Options Lab P/L histogram.
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
