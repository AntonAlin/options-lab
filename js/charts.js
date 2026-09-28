// Plotly wrappers. Spec builders are pure ({ data, layout }) so the same chart renders on
// screen in the current theme and into the PDF in the light print theme.
import { locale, lang } from './i18n.js';
import { isNum } from './util.js';

// Validated categorical palette (fixed order, entity-consistent), diverging pair and inks.
// Light/dark steps per the house data-viz palette.
const THEMES = {
  light: {
    surface: '#ffffff', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7',
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    pos: '#2a78d6', neg: '#e34948', mid: '#f0efec', seq: ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b']
  },
  dark: {
    surface: '#1a1a19', ink: '#ffffff', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835',
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
    pos: '#3987e5', neg: '#e66767', mid: '#383835', seq: ['#104281', '#1c5cab', '#3987e5', '#86b6ef', '#cde2fb']
  }
};
export function currentTheme() {
  return document.documentElement.dataset.resolvedTheme === 'dark' ? 'dark' : 'light';
}
export const palette = (theme = currentTheme()) => THEMES[theme];

// Asset classes keep the same colour on every chart.
export const CLASS_ORDER = ['equity', 'fixed_income', 'money_market', 'cash', 'commodity', 'currency', 'alternative', 'mixed'];
export const classColor = (cls, theme) => palette(theme).series[Math.max(0, CLASS_ORDER.indexOf(cls)) % 8];

function baseLayout(th, extra = {}) {
  const P = THEMES[th];
  return {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', size: 12, color: P.ink2 },
    margin: { l: 10, r: 16, t: 8, b: 30 },
    xaxis: { gridcolor: P.grid, zerolinecolor: P.axis, linecolor: P.axis, tickfont: { color: P.muted }, automargin: true, separatethousands: true },
    yaxis: { gridcolor: P.grid, zerolinecolor: P.axis, linecolor: P.axis, tickfont: { color: P.muted }, automargin: true },
    hoverlabel: { bgcolor: P.surface, bordercolor: P.axis, font: { color: P.ink, size: 12 } },
    legend: { orientation: 'h', y: -0.18, x: 0, font: { color: P.ink2 } },
    showlegend: false,
    separators: lang() === 'sv' ? ', ' : '.,',
    ...extra
  };
}

const pctTick = { tickformat: '.0%' };

// ---- spec builders --------------------------------------------------------------------------------
// items: [{ label, value, color? }], fmt: 'pct' | 'num'
export function barHSpec(items, { th = currentTheme(), fmt = 'pct', color = null, height = null, colorFn = null, diverging = false } = {}) {
  const P = THEMES[th];
  const rev = [...items].reverse();
  const colors = rev.map(it => it.color || (colorFn ? colorFn(it) : diverging ? (it.value >= 0 ? P.pos : P.neg) : color || P.series[0]));
  return {
    data: [{
      type: 'bar', orientation: 'h', y: rev.map(i => i.label), x: rev.map(i => i.value),
      marker: { color: colors, line: { width: 0 } },
      text: rev.map(i => i.text ?? ''), textposition: diverging ? 'auto' : 'outside', insidetextfont: { color: '#ffffff', size: 11 }, cliponaxis: false, textfont: { color: P.ink2, size: 11 },
      hovertemplate: fmt === 'pct' ? '%{y}: %{x:.2%}<extra></extra>' : '%{y}: %{x:,.0f}<extra></extra>'
    }],
    layout: baseLayout(th, {
      height: height || Math.max(160, 26 * items.length + 50), bargap: 0.35,
      xaxis: { ...baseLayout(th).xaxis, ...(fmt === 'pct' ? pctTick : {}), zeroline: true },
      yaxis: { ...baseLayout(th).yaxis, gridcolor: 'rgba(0,0,0,0)' }
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
      marker: { color: P.series[i], line: { width: 0 } },
      hovertemplate: `${s.name} · %{y}: ${fmt === 'pct' ? '%{x:.2%}' : '%{x:,.0f}'}<extra></extra>`
    })),
    layout: baseLayout(th, {
      barmode: 'group', bargap: 0.3, bargroupgap: 0.08, showlegend: true,
      height: height || Math.max(200, 38 * labels.length + 70),
      xaxis: { ...baseLayout(th).xaxis, ...(fmt === 'pct' ? pctTick : {}) },
      yaxis: { ...baseLayout(th).yaxis, gridcolor: 'rgba(0,0,0,0)' }
    })
  };
}

export function barVSpec(labels, values, { th = currentTheme(), fmt = 'num', diverging = false, color = null, height = 260, names = null } = {}) {
  const P = THEMES[th];
  return {
    data: [{
      type: 'bar', x: labels, y: values,
      marker: { color: values.map(v => diverging ? (v >= 0 ? P.pos : P.neg) : color || P.series[0]), line: { width: 0 } },
      hovertemplate: fmt === 'pct' ? '%{x}: %{y:.2%}<extra></extra>' : '%{x}: %{y:,.0f}<extra></extra>',
      customdata: names
    }],
    layout: baseLayout(th, { height, bargap: 0.35, yaxis: { ...baseLayout(th).yaxis, ...(fmt === 'pct' ? pctTick : {}) }, xaxis: { ...baseLayout(th).xaxis, gridcolor: 'rgba(0,0,0,0)', type: 'category' } })
  };
}

// series: [{ name, y, dash? }] against shared dates
export function lineSpec(x, series, { th = currentTheme(), fmt = 'pct', height = 300, area = false, zero = false } = {}) {
  const P = THEMES[th];
  return {
    data: series.map((s, i) => ({
      type: 'scatter', mode: 'lines', name: s.name, x, y: s.y.map(v => (isNum(v) ? v : null)),
      line: { color: s.color || P.series[i], width: 2, dash: s.dash || 'solid' },
      fill: area && i === 0 ? 'tozeroy' : 'none', fillcolor: area ? hexA(s.color || (fmt === 'dd' ? P.neg : P.series[0]), 0.15) : undefined,
      hovertemplate: `${s.name}: ${fmt === 'num' ? '%{y:,.2f}' : '%{y:.2%}'}<extra></extra>`
    })),
    layout: baseLayout(th, {
      height, hovermode: 'x unified', showlegend: series.length > 1,
      xaxis: { ...baseLayout(th).xaxis, type: 'date', gridcolor: 'rgba(0,0,0,0)', spikemode: 'across', spikecolor: P.axis, spikethickness: 1, spikedash: 'solid' },
      yaxis: { ...baseLayout(th).yaxis, ...(fmt !== 'num' ? { tickformat: '.0%' } : {}), zeroline: zero }
    })
  };
}

export function heatmapSpec(labels, matrix, { th = currentTheme(), height = null } = {}) {
  const P = THEMES[th];
  return {
    data: [{
      type: 'heatmap', x: labels, y: labels, z: matrix, zmin: -1, zmax: 1,
      colorscale: [[0, P.neg], [0.5, P.mid], [1, P.pos]], xgap: 2, ygap: 2,
      hovertemplate: '%{y} × %{x}: %{z:.2f}<extra></extra>', colorbar: { thickness: 10, outlinewidth: 0, tickfont: { color: P.muted } }
    }],
    layout: baseLayout(th, {
      height: height || Math.max(320, 30 * labels.length + 120), margin: { l: 10, r: 10, t: 8, b: 10 },
      xaxis: { ...baseLayout(th).xaxis, tickangle: -40, gridcolor: 'rgba(0,0,0,0)' },
      yaxis: { ...baseLayout(th).yaxis, autorange: 'reversed', gridcolor: 'rgba(0,0,0,0)' }
    })
  };
}

export function histogramSpec(values, { th = currentTheme(), height = 260, markers = [] } = {}) {
  const P = THEMES[th];
  return {
    data: [{ type: 'histogram', x: values.filter(isNum), nbinsx: 60, marker: { color: P.series[0], line: { width: 1, color: P.surface } }, hovertemplate: '%{x:.2%}: %{y}<extra></extra>' }],
    layout: baseLayout(th, {
      height, bargap: 0.02,
      xaxis: { ...baseLayout(th).xaxis, tickformat: '.1%' },
      shapes: markers.map(m => ({ type: 'line', x0: m.x, x1: m.x, yref: 'paper', y0: 0, y1: 1, line: { color: P.neg, width: 2, dash: 'dot' } })),
      annotations: markers.map(m => ({ x: m.x, yref: 'paper', y: 1, text: m.label, showarrow: false, xanchor: 'right', font: { color: P.ink2, size: 11 } }))
    })
  };
}

function hexA(hex, a) {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map(c => c + c).join('') : m, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---- rendering -------------------------------------------------------------------------------------
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
  return window.Plotly.toImage({ data: spec.data, layout: { ...spec.layout, width, height: h, paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff' } }, { format: 'png', width, height: h, scale: 2 });
}

export function purgeAll(root) {
  if (!plotlyReady()) return;
  root.querySelectorAll('.js-plotly-plot').forEach(el => window.Plotly.purge(el));
}

export { locale };
