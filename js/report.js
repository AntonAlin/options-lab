// PDF report: jsPDF + AutoTable, charts rendered by Plotly into PNGs in the light print theme.
// Everything runs in the browser; the file is generated locally and downloaded.
import { t, L, lang } from './i18n.js';
import { fmtMoney, fmtPct, fmtNum, fmtDate } from './ui.js';
import { ASSET_CLASSES, REGIONS, typeLabel } from './instruments.js';
import { monthlyReturns, RATING_BUCKETS } from './analytics.js';
import * as charts from './charts.js';
import { loadScript, isNum, slug } from './util.js';

export const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
export const AUTOTABLE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';

export const SECTIONS = ['summary', 'holdings', 'exposure', 'risk', 'riskClass', 'fixedIncome', 'performance', 'stress', 'liquidity', 'cashflow', 'nav', 'compliance'];

// Standard PDF fonts are WinAnsi; map the few characters Intl and our labels produce that it lacks.
function clean(s) {
  return String(s ?? '')
    .replace(/[−‒–—]/g, '-').replace(/[   ]/g, ' ')
    .replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/Δ/g, 'Delta ').replace(/β/g, 'beta ')
    .replace(/[✓✔]/g, 'OK').replace(/[✕✖]/g, 'X').replace(/…/g, '...').replace(/→/g, '->').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^\x00-\xff]/g, '');
}

const INK = [11, 11, 11], INK2 = [82, 81, 78], MUTED = [137, 135, 129], ACCENT = [42, 120, 214], RULE = [225, 224, 217], NEG = [196, 50, 50], POS = [0, 110, 0];

export async function generateReport(p, a, opts) {
  await loadScript(JSPDF_URL);
  await loadScript(AUTOTABLE_URL);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210, H = 297, M = 16, CW = W - 2 * M;
  const base = p.baseCcy;
  const { v, fi, fx, risk, liq, liqStressed, comp, stress, conc, perf, alloc, bench } = a;
  const sections = new Set(opts.sections);
  let y = M;

  const txt = (s, x, yy, o = {}) => doc.text(clean(s), x, yy, o);
  const setInk = c => doc.setTextColor(...c);
  const font = (size, style = 'normal', color = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); setInk(color); };
  const ensure = h => { if (y + h > H - 18) { doc.addPage(); y = M + 6; } };
  const heading = (s, sub = '') => {
    ensure(22);
    font(14, 'bold');
    txt(s, M, y + 5);
    doc.setDrawColor(...ACCENT); doc.setLineWidth(0.6); doc.line(M, y + 7.5, M + 18, y + 7.5);
    y += 11;
    if (sub) { font(8.5, 'normal', MUTED); const lines = doc.splitTextToSize(clean(sub), CW); txt(lines, M, y); y += lines.length * 3.8 + 1.5; }
  };
  const para = (s, size = 9.5, color = INK2) => {
    font(size, 'normal', color);
    const lines = doc.splitTextToSize(clean(s), CW);
    for (const line of lines) { ensure(5); txt(line, M, y); y += size * 0.42; }
    y += 2;
  };
  const tableAt = (head, body, o = {}) => {
    ensure(22); // never leave a header row orphaned at the bottom of a page
    doc.autoTable({
      startY: y, margin: { left: o.left ?? M, right: o.right ?? M, top: M + 6, bottom: 20 }, tableWidth: o.width ?? 'auto',
      head: [head.map(clean)], body: body.map(r => r.map(c => (typeof c === 'object' && c !== null ? { ...c, content: clean(c.content) } : clean(c)))),
      styles: { font: 'helvetica', fontSize: o.fontSize ?? 8, cellPadding: 1.6, textColor: INK, lineColor: RULE, lineWidth: 0 },
      headStyles: { fillColor: [244, 244, 241], textColor: INK2, fontStyle: 'bold', lineWidth: 0 },
      alternateRowStyles: { fillColor: [251, 251, 249] },
      columnStyles: o.columnStyles || Object.fromEntries(head.map((_, i) => [i, { halign: i === 0 ? 'left' : 'right' }])),
      didParseCell: o.didParseCell,
      theme: 'plain'
    });
    y = doc.lastAutoTable.finalY + 6;
  };
  const chart = async (spec, h = 62, w = CW, x = M) => {
    const img = await charts.toImage(spec, Math.round(w * 5.2), Math.round(h * 5.2));
    if (!img) return;
    ensure(h + 2);
    doc.addImage(img, 'PNG', x, y, w, h);
    y += h + 4;
  };
  const kpiGrid = items => {
    const cols = 4, gap = 3, bw = (CW - gap * (cols - 1)) / cols, bh = 17;
    items.forEach((it, i) => {
      const cx = M + (i % cols) * (bw + gap), cy = y + Math.floor(i / cols) * (bh + gap);
      if (i % cols === 0) ensure(bh + gap);
      doc.setDrawColor(...RULE); doc.setFillColor(250, 250, 248); doc.roundedRect(cx, cy, bw, bh, 1.5, 1.5, 'FD');
      font(7, 'normal', MUTED); txt(it[0], cx + 3, cy + 5);
      font(12, 'bold', it[3] || INK); txt(it[1], cx + 3, cy + 11.5);
      if (it[2]) { font(6.5, 'normal', MUTED); txt(doc.splitTextToSize(clean(it[2]), bw - 5)[0], cx + 3, cy + 15.2); }
    });
    y += Math.ceil(items.length / cols) * (bh + gap) + 3;
  };
  const th = 'light';
  const pnlColor = x => (x < 0 ? NEG : x > 0 ? POS : INK);
  const colorPnl = cols => data => { if (data.section === 'body' && cols.includes(data.column.index)) { const raw = data.row.raw[data.column.index]; if (raw && raw._v !== undefined) data.cell.styles.textColor = pnlColor(raw._v); } };
  const cellV = (content, val) => ({ content, _v: val });

  // ---- cover / summary ------------------------------------------------------------------------------
  doc.setFillColor(...ACCENT); doc.rect(0, 0, W, 3, 'F');
  font(8, 'bold', ACCENT); txt('NEXUS PORTFOLIO LAB', M, y + 2);
  y += 10;
  font(22, 'bold'); txt(opts.title || t('rep.defaultTitle'), M, y + 4); y += 11;
  font(11, 'normal', INK2);
  txt([p.name, opts.manager || p.manager].filter(Boolean).join('  ·  '), M, y); y += 5.5;
  font(9, 'normal', MUTED);
  txt(`${t('rep.valDate')}: ${fmtDate(v.ctx.valDate)}  ·  ${t('rep.base')}: ${base}  ·  ${t('rep.generated')}: ${fmtDate(new Date().toISOString().slice(0, 10))}`, M, y); y += 9;

  if (sections.has('summary')) {
    const H0 = risk.headline, liq7 = liq.buckets.find(b => b.h === 7);
    const worst = [...stress].sort((x1, x2) => x1.total - x2.total)[0];
    kpiGrid([
      [t('kpi.nav'), fmtMoney(v.nav, base, { compact: true }), t('kpi.navSub', { n: v.valid.length })],
      [t('kpi.var', { c: fmtNum(H0.confidence * 100, 0), h: H0.horizonDays }), fmtPct(H0.varPct, 2), `${fmtMoney(H0.var, base, { compact: true })} · ${t('method.' + H0.method)}`],
      [t('kpi.vol'), fmtPct(H0.volPct, 1), t('kpi.volSub')],
      [t('kpi.commitment'), fmtPct(v.nav ? v.derivCommit / v.nav : 0, 1), t('kpi.grossSub', { g: fmtPct(v.leverage, 0) })],
      [t('kpi.duration'), fmtNum(fi.portfolioDuration, 2), `${t('kpi.ytm')} ${fmtPct(fi.ytm, 2)}`],
      [t('kpi.fxOpen'), fmtPct(fx.totalNetW, 1), t('kpi.fxOpenSub', { base })],
      [t('kpi.liq7'), fmtPct(liq7 && liq.assets ? liq7.value / liq.assets : 0, 0), t('kpi.liq7Sub')],
      [t('kpi.compliance'), comp.breaches ? `${comp.breaches} ${t('kpi.breaches')}` : t('kpi.allClear'), worst ? `${t('rep.worstStress')}: ${fmtPct(worst.pct, 1)}` : '', comp.breaches ? NEG : POS]
    ]);
    if (opts.commentary && opts.commentary.trim()) {
      heading(t('rep.commentary'));
      opts.commentary.split(/\n{2,}/).forEach(par => para(par.replace(/\n/g, ' ')));
    }
    heading(t('dash.alloc'));
    const half = (CW - 6) / 2, top = y;
    await chart(charts.donutSpec(alloc.assetClass.filter(x => x.weight >= 0.0005).map(x => ({ label: `${L(ASSET_CLASSES[x.key] || { en: x.key })}  ${fmtPct(x.weight, 1)}`, value: x.value, color: charts.classColor(x.key, th) })), { th, height: 260, center: fmtMoney(v.nav, '', { compact: true }), centerSub: base }), 58, half);
    const afterChart = y;
    y = top;
    tableAt([t('dash.top10'), t('col.weight')], conc.top10Rows.map(x => [x.name.slice(0, 38), fmtPct(x.weight, 1)]), { left: M + half + 6, width: half, fontSize: 7.5 });
    y = Math.max(y, afterChart);
  }

  // ---- holdings ---------------------------------------------------------------------------------------
  if (sections.has('holdings')) {
    doc.addPage(); y = M + 6;
    heading(t('nav.holdings'), t('rep.holdingsSub', { n: v.rows.length }));
    const rows = [...v.valid].sort((x1, x2) => (x1.def.group > x2.def.group ? 1 : x1.def.group < x2.def.group ? -1 : x2.r.mv - x1.r.mv));
    tableAt([t('col.name'), t('col.type'), t('col.qty'), t('col.price'), t('col.ccy'), t('col.mv', { base }), t('col.weight'), t('col.exposure')],
      rows.map(x => [x.name.slice(0, 40), typeLabel(x.pos.type, lang()), fmtNum(x.pos.qty ?? x.pos.buyAmount, 0), isNum(x.pos.price) ? fmtNum(x.pos.price, 2) : (isNum(x.pos.yield) ? fmtPct(x.pos.yield / 100, 2) : ''), x.pos.ccy || '', fmtNum(x.r.mv, 0), fmtPct(x.weight, 2), fmtPct(x.expWeight, 1)]),
      { fontSize: 7, columnStyles: { 0: { halign: 'left', cellWidth: 52 }, 1: { halign: 'left' }, 4: { halign: 'left' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } } });
    font(8.5, 'bold'); ensure(6); txt(`${t('common.total')}: ${fmtMoney(v.nav, base)}`, M, y); y += 6;
  }

  // ---- exposure ----------------------------------------------------------------------------------------
  if (sections.has('exposure')) {
    doc.addPage(); y = M + 6;
    heading(t('nav.exposure'), t('exp.byClassSub'));
    const classes = [...new Set([...alloc.assetClass.map(x => x.key), ...alloc.exposureByClass.map(x => x.key)])];
    await chart(charts.barHGroupedSpec(classes.map(k => L(ASSET_CLASSES[k] || { en: k })), [
      { name: t('exp.mvWeight'), values: classes.map(k => alloc.assetClass.find(x => x.key === k)?.weight || 0) },
      { name: t('exp.netWeight'), values: classes.map(k => alloc.exposureByClass.find(x => x.key === k)?.weight || 0) }
    ], { th }), 70);
    const half = (CW - 6) / 2, top = y;
    font(10, 'bold'); txt(t('exp.sector'), M, y + 3); y += 5;
    await chart(charts.barHSpec(alloc.sector.slice(0, 10).map(x => ({ label: x.key, value: x.weight, text: fmtPct(x.weight, 1) })), { th }), 62, half);
    const yl = y; y = top;
    font(10, 'bold'); txt(t('exp.region'), M + half + 6, y + 3); y += 5;
    await chart(charts.barHSpec(alloc.region.map(x => ({ label: L(REGIONS[x.key] || { en: x.key }), value: x.weight, text: fmtPct(x.weight, 1) })), { th }), 62, half, M + half + 6);
    y = Math.max(y, yl);
    heading(t('exp.currency'), t('exp.currencySub', { base }));
    tableAt([t('col.ccy'), t('exp.ccyGross'), t('exp.ccyHedge'), t('exp.ccyNet'), t('exp.hedgeRatio')],
      fx.rows.map(r => [r.ccy, fmtPct(r.grossW, 1), fmtPct(v.nav ? r.hedge / v.nav : 0, 1), fmtPct(r.netW, 1), r.gross ? fmtPct(r.hedgeRatio, 0) : '-']));
    tableAt([t('exp.top10'), t('exp.effN'), 'HHI'], [[fmtPct(conc.top10, 1), fmtNum(conc.effectiveN, 1), fmtNum(conc.hhi * 10000, 0)]], { width: CW / 2 });
  }

  // ---- risk ------------------------------------------------------------------------------------------------
  if (sections.has('risk')) {
    doc.addPage(); y = M + 6;
    const P = risk.param, Hs = risk.hist, H0 = risk.headline;
    heading(t('nav.risk'), t('risk.sub'));
    tableAt([t('rep.measure'), t('method.parametric'), t('method.historical')], [
      [t('kpi.var', { c: fmtNum(P.confidence * 100, 1), h: P.horizonDays }), `${fmtPct(P.varPct, 2)} (${fmtMoney(P.var, base, { compact: true })})`, Hs ? `${fmtPct(Hs.varPct, 2)} (${fmtMoney(Hs.var, base, { compact: true })})` : '-'],
      [t('risk.es'), fmtPct(P.esPct, 2), Hs ? fmtPct(Hs.esPct, 2) : '-'],
      [t('kpi.vol'), fmtPct(P.volPct, 1), Hs ? fmtPct(Hs.volPct, 1) : '-'],
      [t('rep.headline'), H0 === P ? 'X' : '', Hs && H0 === Hs ? 'X' : '']
    ]);
    const groups = Object.entries(P.byFactorGroup).filter(([, x]) => Math.abs(x) > 1e-9).sort((x1, x2) => x2[1] - x1[1]);
    heading(t('risk.byFactor'), t('risk.byFactorSub'));
    await chart(charts.barHSpec(groups.map(([g, c]) => ({ label: t('factor.' + g), value: P.sigmaAnnual ? c / P.sigmaAnnual : 0, text: fmtPct(P.sigmaAnnual ? c / P.sigmaAnnual : 0, 0) })), { th, diverging: true }), 55);
    const contrib = (Hs && H0 === Hs ? Hs.byPosition : P.byPosition).slice(0, 12);
    heading(t('risk.topContrib'));
    tableAt([t('col.name'), t('col.weight'), t('risk.contribVol'), t('risk.share')], contrib.map(x => [x.row.name.slice(0, 44), fmtPct(x.row.weight, 1), fmtPct(v.nav ? x.contrib / v.nav : 0, 2), fmtPct(x.pct, 1)]));
    para(t('risk.assumptionsBody'), 7.5, MUTED);
  }

  // ---- fixed income ----------------------------------------------------------------------------------------
  if (sections.has('fixedIncome') && (fi.rows.length || v.valid.some(x => x.r.fi))) {
    doc.addPage(); y = M + 6;
    heading(t('nav.fi'), t('fi.sub'));
    kpiGrid([
      [t('fi.weight'), fmtPct(fi.fiWeight, 1), fmtMoney(fi.fiMv, base, { compact: true })],
      [t('kpi.ytm'), fmtPct(fi.ytm, 2), t('fi.ytmSub')],
      [t('fi.modDur'), fmtNum(fi.modDur, 2), t('fi.modDurSub')],
      [t('fi.portDur'), fmtNum(fi.portfolioDuration, 2), t('fi.portDurSub')],
      [t('fi.spreadDur'), fmtNum(fi.portfolioSpreadDuration, 2), t('fi.spreadDurSub')],
      ['DV01', fmtMoney(fi.ir01, base, { compact: true }), t('fi.dv01Sub')],
      ['CS01', fmtMoney(fi.cs01, base, { compact: true }), t('fi.cs01Sub')],
      [t('fi.avgRating'), fi.avgRating || '-', t('fi.hySub', { p: fmtPct(fi.highYieldWeight, 1) })]
    ]);
    const half = (CW - 6) / 2, top = y;
    font(10, 'bold'); txt(t('fi.maturity'), M, y + 3); y += 5;
    await chart(charts.barVSpec(fi.maturity.map(m => m.key), fi.maturity.map(m => m.share), { th, fmt: 'pct', height: 240 }), 50, half);
    const yl = y; y = top;
    font(10, 'bold'); txt(t('fi.rating'), M + half + 6, y + 3); y += 5;
    const ratings = RATING_BUCKETS.map(b => ({ key: b, share: fi.fiMv ? (alloc.rating.find(x => x.key === b)?.value || 0) / fi.fiMv : 0 })).filter(x => x.share > 0);
    await chart(charts.barVSpec(ratings.map(r => r.key), ratings.map(r => r.share), { th, fmt: 'pct', height: 240 }), 50, half, M + half + 6);
    y = Math.max(y, yl);
    tableAt([t('col.name'), t('fi.maturityCol'), t('fi.coupon'), 'Rating', t('kpi.ytm'), t('fi.modDurShort'), t('col.weight')],
      fi.rows.sort((x1, x2) => x1.r.fi.years - x2.r.fi.years).map(x => [x.name.slice(0, 40), x.pos.maturity || '', x.pos.coupon != null ? fmtNum(x.pos.coupon, 3) : '-', x.pos.rating || '-', fmtPct(x.r.fi.ytm, 2), fmtNum(x.r.fi.modDur, 2), fmtPct(x.weight, 2)]),
      { fontSize: 7.5, columnStyles: { 0: { halign: 'left', cellWidth: 60 }, 1: { halign: 'left' }, 3: { halign: 'left' }, 2: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } } });
  }

  // ---- performance -------------------------------------------------------------------------------------------
  if (sections.has('performance') && perf) {
    doc.addPage(); y = M + 6;
    heading(t('nav.performance'), t('perf.backcast', { c: fmtPct(risk.hp.coverage, 0) }));
    const dates = risk.hp.dates;
    const cum = [{ name: p.name, y: perf.nav.map(x => x - 1) }];
    if (bench && perf.bench) { let g = 1; cum.push({ name: p.benchmark, y: [0, ...bench.slice(1).map(r => (g *= 1 + (isNum(r) ? r : 0)) - 1)] }); }
    await chart(charts.lineSpec(dates.slice(dates.length - cum[0].y.length), cum, { th, height: 300, zero: true }), 70);
    const B = perf.bench;
    const r2 = (l, x, b, f = q => fmtPct(q, 2)) => [l, f(x), B ? (b == null ? '' : f(b)) : ''];
    tableAt([t('rep.measure'), t('perf.portfolio'), B ? p.benchmark : ''], [
      r2(t('perf.total'), perf.total, B?.total), r2(t('perf.cagr'), perf.cagr, B?.cagr), r2(t('perf.vol'), perf.vol, B?.vol),
      r2(t('perf.sharpe'), perf.sharpe, B?.sharpe, q => fmtNum(q, 2)), r2(t('perf.sortino'), perf.sortino, B?.sortino, q => fmtNum(q, 2)),
      r2(t('perf.maxDD'), perf.maxDD, B?.maxDD), r2(t('perf.var95'), perf.var95, B?.var95), r2(t('perf.es95'), perf.es95, B?.es95),
      ...(B ? [[t('perf.beta'), fmtNum(perf.beta, 2), ''], [t('perf.te'), fmtPct(perf.trackingError, 2), ''], [t('perf.ir'), fmtNum(perf.infoRatio, 2), '']] : [])
    ], { width: CW * 0.7 });
    const monthly = monthlyReturns(dates, risk.hp.portfolioRet);
    const mNames = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2020, i, 1)).toLocaleString(lang() === 'sv' ? 'sv-SE' : 'en-GB', { month: 'short', timeZone: 'UTC' }));
    heading(t('perf.monthly'));
    tableAt(['', ...mNames, t('perf.ytd')], Object.keys(monthly).sort().reverse().map(yr => [yr, ...Array.from({ length: 12 }, (_, i) => isNum(monthly[yr][i + 1]) ? cellV(fmtNum(monthly[yr][i + 1] * 100, 1), monthly[yr][i + 1]) : ''), cellV(fmtNum(monthly[yr].ytd * 100, 1), monthly[yr].ytd)]),
      { fontSize: 6.8, didParseCell: colorPnl([...Array(14).keys()].slice(1)) });
  }

  // ---- stress -------------------------------------------------------------------------------------------------
  if (sections.has('stress')) {
    doc.addPage(); y = M + 6;
    heading(t('nav.stress'), t('stress.scenariosSub'));
    const sorted = [...stress].sort((x1, x2) => x1.total - x2.total);
    await chart(charts.barHSpec(sorted.map(s => ({ label: L(s.scenario), value: s.pct, text: fmtPct(s.pct, 1, { sign: true }) })), { th, diverging: true }), 72);
    tableAt([t('col.scenario'), t('col.pnl', { base }), '% NAV'], sorted.map(s => [L(s.scenario), cellV(fmtMoney(s.total, '', { compact: true }), s.total), cellV(fmtPct(s.pct, 2, { sign: true }), s.total)]), { didParseCell: colorPnl([1, 2]) });
    para(t('stress.method'), 7.5, MUTED);
  }

  // ---- liquidity ------------------------------------------------------------------------------------------------
  if (sections.has('liquidity')) {
    if (!sections.has('stress')) { doc.addPage(); y = M + 6; }
    heading(t('nav.liquidity'), t('liq.sub'));
    const lbl = h => h === 1 ? t('liq.1d') : h === 365 ? t('liq.1y') : t('liq.nd', { n: h });
    tableAt([t('liq.horizon'), t('liq.normal'), t('liq.stressed')], liq.buckets.map((b, i) => [lbl(b.h), fmtPct(b.pct, 1), fmtPct(liqStressed.buckets[i].pct, 1)]), { width: CW * 0.6 });
    tableAt([t('col.name'), t('col.weight'), t('liq.days'), t('liq.basis')], liq.rows.slice(0, 10).map(q => [q.row.name.slice(0, 44), fmtPct(q.row.weight, 2), fmtNum(q.days, 0), t('liq.basis.' + q.basis)]));
  }

  // ---- risk class (SRI / SRRI) ------------------------------------------------------------------------------------
  if (sections.has('riskClass') && a.ri) {
    doc.addPage(); y = M + 6;
    const ri = a.ri;
    heading(t('nav.riskClass'), t('ri.sub'));
    const boxes = (cls, label) => {
      ensure(24);
      font(9, 'bold', INK2); txt(label, M, y + 3); y += 6;
      const bw = 14, gap = 2.5;
      for (let i = 1; i <= 7; i++) {
        const x = M + (i - 1) * (bw + gap);
        if (i === cls) { doc.setFillColor(...ACCENT); doc.roundedRect(x, y, bw, 10, 1.5, 1.5, 'F'); font(11, 'bold', [255, 255, 255]); }
        else { doc.setFillColor(241, 241, 237); doc.roundedRect(x, y, bw, 10, 1.5, 1.5, 'F'); font(11, 'bold', MUTED); }
        txt(String(i), x + bw / 2, y + 6.8, { align: 'center' });
      }
      y += 15;
    };
    boxes(ri.sri, `SRI (PRIIPs KID): ${ri.sri} / 7`);
    boxes(ri.srri, `SRRI (UCITS): ${ri.srri} / 7`);
    tableAt([t('rep.measure'), ''], [
      [t('ri.vev'), fmtPct(ri.vev, 2)], ['MRM / CRM', `${ri.mrm} / ${ri.crm}`], [t('ri.weeklyVol'), fmtPct(ri.srriVol, 2)],
      [t('ri.rhp'), `${ri.rhpYears} ${t('ri.years')}`], [t('ri.period'), `${fmtDate(ri.from)} - ${fmtDate(ri.to)}`],
      [t('ri.source'), p.risk?.sriSource || t('ri.srcPortfolio')]
    ], { width: CW * 0.7 });
    if (!ri.srriFull || !ri.sriEnough) para(t('ri.short', { y: fmtNum(ri.yearsAvail, 1) }), 8, [170, 110, 0]);
    para(t('ri.method'), 7.5, MUTED);
  }

  // ---- cash-flow calendar ------------------------------------------------------------------------------------------
  if (sections.has('cashflow') && a.cf && a.cf.events.length) {
    doc.addPage(); y = M + 6;
    const cf = a.cf;
    heading(t('nav.cashflow'), t('cf.chartSub', { base }));
    const P = charts.palette(th);
    const KC = { coupon: 2, redemption: 0, fx_settle: 1, swap: 5, cds_premium: 7, option_expiry: 3, future_expiry: 6 };
    const kinds = Object.keys(KC).filter(k => cf.buckets.some(b => b.byKind[k]));
    const ml = m => new Date(m + '-01T00:00:00Z').toLocaleDateString(lang() === 'sv' ? 'sv-SE' : 'en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    await chart(charts.stackedBarSpec(cf.buckets.map(b => ml(b.month)), kinds.map(k => ({ name: t('cf.kind.' + k), values: cf.buckets.map(b => b.byKind[k] || 0), color: P.series[KC[k] % 8] })), { th, line: { name: t('cf.projected'), values: cf.buckets.map(b => b.cashAfter) } }), 70);
    tableAt([t('cf.date'), t('cf.event'), t('col.name'), t('col.ccy'), t('cf.amountBase', { base })],
      cf.events.slice(0, 40).map(e => [e.date, t('cf.kind.' + e.kind) + (e.estimate ? ' *' : ''), e.name.slice(0, 40), e.ccy, cellV(fmtNum(e.amountBase, 0), e.cash ? e.amountBase : 0)]),
      { fontSize: 7.5, didParseCell: colorPnl([4]), columnStyles: { 0: { halign: 'left' }, 1: { halign: 'left' }, 2: { halign: 'left' }, 3: { halign: 'left' }, 4: { halign: 'right' } } });
    para(t('cf.method'), 7.5, MUTED);
  }

  // ---- indicative NAV per unit -------------------------------------------------------------------------------------
  if (sections.has('nav') && a.nav && a.nav.ok) {
    if (!sections.has('cashflow')) { doc.addPage(); y = M + 6; }
    const nv = a.nav;
    heading(t('nav.nav'), t('navp.honest'));
    tableAt([t('navp.className'), t('col.ccy'), t('navp.units'), t('navp.navUnit'), t('navp.lastNav'), t('navp.vsLastShort')],
      nv.classes.map(c => [c.name || c.ccy, c.ccy, fmtNum(c.units, 2), fmtNum(c.navPerUnit, 4), c.lastNav ? fmtNum(c.lastNav, 4) : '-', c.vsLast != null ? cellV(fmtPct(c.vsLast, 2, { sign: true }), c.vsLast) : '-']),
      { didParseCell: colorPnl([5]) });
    tableAt(['', base], [[t('navp.gross'), fmtMoney(nv.gross)], [t('navp.minusLiab'), fmtMoney(-nv.liabilities)], [t('navp.plusRec'), fmtMoney(nv.receivables)], [t('navp.minusFees'), fmtMoney(-nv.accruedFees)], [t('navp.net'), fmtMoney(nv.net)]], { width: CW * 0.6 });
  }

  // ---- compliance -----------------------------------------------------------------------------------------------
  if (sections.has('compliance')) {
    doc.addPage(); y = M + 6;
    heading(t('nav.compliance'), t('comp.sub', { type: p.fundType || 'UCITS' }));
    const stColor = { ok: POS, warn: [170, 110, 0], breach: NEG };
    tableAt([t('comp.rule'), t('comp.actual'), t('comp.limit'), t('comp.status')],
      comp.rules.map(r => [t('limit.' + r.id), fmtNum(r.value, 2) + ' %', (r.dir === 'max' ? '<= ' : '>= ') + fmtNum(r.limit, 1) + ' %', { content: t('status.' + r.status), _s: r.status }]),
      { didParseCell: d => { if (d.section === 'body' && d.column.index === 3) { d.cell.styles.textColor = stColor[d.row.raw[3]._s]; d.cell.styles.fontStyle = 'bold'; } }, columnStyles: { 0: { halign: 'left', cellWidth: 90 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'left' } } });
    const breached = comp.rules.filter(r => r.status !== 'ok' && r.details.length);
    for (const r of breached) {
      font(9, 'bold'); ensure(8); txt(t('limit.' + r.id), M, y); y += 2;
      tableAt([t('col.name'), '% NAV'], r.details.slice(0, 8).map(d => [d.name, fmtNum(d.value, 2) + ' %']), { width: CW * 0.6, fontSize: 7.5 });
    }
    para(t('comp.disclaimer'), 7.5, MUTED);
  }

  // ---- disclaimer, header & footer on every page -------------------------------------------------------------
  ensure(30);
  y += 4;
  doc.setDrawColor(...RULE); doc.line(M, y, W - M, y); y += 5;
  font(8, 'bold', INK2); txt(t('rep.disclaimerTitle'), M, y); y += 4;
  para(t('rep.disclaimer'), 7.5, MUTED);

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    if (i > 1) {
      doc.setFillColor(...ACCENT); doc.rect(0, 0, W, 1.5, 'F');
      font(7.5, 'normal', MUTED); txt(`${p.name}  ·  ${fmtDate(v.ctx.valDate)}`, M, 9);
      txt(opts.title || t('rep.defaultTitle'), W - M, 9, { align: 'right' });
    }
    doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M, H - 13, W - M, H - 13);
    font(7, 'normal', MUTED);
    txt(t('rep.footer'), M, H - 8.5);
    txt(`${i} / ${n}`, W - M, H - 8.5, { align: 'right' });
  }
  doc.setProperties({ title: clean(`${opts.title || t('rep.defaultTitle')} - ${p.name}`), subject: 'Portfolio report', creator: 'Nexus Portfolio Lab', author: clean(opts.manager || p.manager || '') });
  return doc;
}

export function reportFilename(p, v) {
  return `${slug(p.name)}-report-${v.ctx.valDate}.pdf`;
}
