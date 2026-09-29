// Global exposure: commitment or VaR approach (absolute or relative), and the backtest of the VaR
// model. The reading of the rules behind it is the developer's; see the note at the top.
import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, kpi, fmtNum, fmtPct, fmtDate, table, segmented, selectHtml, statusChip, numIn } from '../ui.js';
import { geSettings, usesVar, fundVar, referenceVar, backtest, backcast } from '../globalexposure.js';
import { regNote } from './regnote.js';
import * as charts from '../charts.js';

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const v = a.v;
    const cfg = geSettings(p);
    const hp = backcast(v);
    const fv = fundVar(v, cfg, hp);
    const ref = cfg.method === 'relativeVar' ? referenceVar(v, cfg) : null;
    const bt = backtest(v, cfg, hp);
    const rule = a.comp.rules.find(r => r.id === 'varAbs' || r.id === 'varRel');
    const commit = v.nav ? v.derivCommit / v.nav : 0;
    const series = Object.keys(p.history?.series || {});
    const V = usesVar(p);

    root.innerHTML = `
      ${pageHead(t('nav.globalExposure'), esc(t('ge.sub')))}
      ${regNote('globalExposure')}
      <div class="toolbar wrap settings-strip">
        <span>${esc(t('ge.method'))}</span>${segmented('gem', [['commitment', t('ge.method.commitment')], ['absoluteVar', t('ge.method.absoluteVar')], ['relativeVar', t('ge.method.relativeVar')]], cfg.method)}
        ${V ? `<span>${esc(t('ge.model'))}</span>${segmented('gemodel', [['historical', t('method.historical')], ['ewma', t('method.ewma')]], cfg.model)}
        <label class="inline">${esc(t('ge.window'))} ${selectHtml('id="geWin"', [[250, '250'], [500, '500'], [750, '750']], cfg.window)}</label>` : ''}
        ${cfg.method === 'absoluteVar' ? `<label class="inline">${esc(t('ge.absLimit'))} <input id="geAbs" class="w-80" inputmode="decimal" value="${cfg.absLimit}"> %</label>` : ''}
        ${cfg.method === 'relativeVar' ? `<label class="inline">${esc(t('ge.relLimit'))} <input id="geRel" class="w-80" inputmode="decimal" value="${cfg.relLimit}"> ×</label>
          <label class="inline">${esc(t('ge.reference'))} ${selectHtml('id="geRef"', [['', t('ge.pickRef')], ...series.map(k => [k, k])], cfg.reference)}</label>` : ''}
      </div>
      ${!V ? card(t('ge.commitTitle'), `<div class="kpi-grid">
          ${kpi(t('ge.commitment'), fmtPct(commit, 1), { sub: t('ge.commitSub', { l: fmtNum(p.limits?.commitment?.value ?? 100, 0) }), tone: commit * 100 > (p.limits?.commitment?.value ?? 100) ? 'breach' : '' })}
          ${kpi(t('ge.gross'), fmtPct(v.leverage, 0), { sub: t('ge.grossSub') })}
        </div><p class="muted small">${esc(t('ge.commitHelp'))}</p>`) : `
      <div class="kpi-grid">
        ${kpi(t('ge.var'), fmtPct(fv.pct / 100, 2), { sub: t('ge.varSub', { c: fmtNum(cfg.confidence * 100, 0), h: cfg.horizon, n: fv.obs, m: t('method.' + fv.model) }), tone: rule?.status === 'breach' ? 'breach' : rule?.status === 'warn' ? 'warn' : '' })}
        ${cfg.method === 'absoluteVar' ? kpi(t('ge.utilisation'), fmtPct(fv.pct / cfg.absLimit, 0), { sub: t('ge.ofLimit', { l: fmtNum(cfg.absLimit, 0) + ' %' }) }) : ''}
        ${cfg.method === 'relativeVar' ? kpi(t('ge.refVar'), ref ? fmtPct(ref.pct / 100, 2) : '—', { sub: ref ? ref.key : t('ge.noRef') }) : ''}
        ${cfg.method === 'relativeVar' ? kpi(t('ge.ratio'), ref ? fmtNum(fv.pct / ref.pct, 2) + '×' : '—', { sub: t('ge.ofLimit', { l: fmtNum(cfg.relLimit, 1) + '×' }), tone: rule?.status === 'breach' ? 'breach' : '' }) : ''}
        ${kpi(t('ge.status'), rule ? statusChip(rule.status) : '—')}
        ${kpi(t('ge.gross'), fmtPct(v.leverage, 0), { sub: t('ge.grossSubVar') })}
      </div>
      ${fv.model === 'parametric' ? `<div class="alert alert-warn">${esc(t('ge.noHistory'))} <a href="#/history">${esc(t('nav.history'))} →</a></div>` : fv.short ? `<div class="alert alert-warn">${esc(t('ge.shortHistory', { n: fv.obs }))}</div>` : ''}
      ${bt ? card(t('ge.backtest'), `<div class="kpi-grid">
          ${kpi(t('ge.exceptions'), `${bt.exceptions} <small>/ ${bt.n}</small>`, { sub: t('ge.expected', { e: fmtNum(bt.expected, 1) }), tone: bt.review ? 'breach' : '' })}
          ${kpi(t('ge.zone'), `<span class="zone zone-${bt.zone}">${esc(t('ge.zone.' + bt.zone))}</span>`, { help: t('help.zone') })}
          ${kpi(t('ge.kupiec'), fmtNum(bt.pValue, 3), { sub: bt.pValue < 0.05 ? t('ge.kupiecReject') : t('ge.kupiecOk'), help: t('help.kupiec') })}
          ${kpi(t('ge.avgVar'), fmtPct(bt.avgVarPct / 100, 2), { sub: t('ge.avgVarSub') })}
        </div>
        ${bt.review ? `<div class="alert alert-breach">${esc(t('ge.reviewNote', { n: bt.exceptions }))}</div>` : ''}
        ${!bt.full ? `<div class="alert alert-warn">${esc(t('ge.btShort', { n: bt.n }))}</div>` : ''}
        <div id="chBt" class="chart"></div>
        ${bt.exceptions ? table([
          { key: 'd', label: t('col.date'), fmt: r => esc(fmtDate(r.date)) },
          { key: 'p', label: t('ge.pnl'), align: 'right', fmt: r => `<span class="neg">${fmtPct(r.pnl / v.nav, 2)}</span>` },
          { key: 'v', label: t('ge.varDay'), align: 'right', fmt: r => fmtPct(-r.var / v.nav, 2) }
        ], bt.rows.filter(r => r.exception).reverse(), { dense: true }) : ''}
        <p class="muted small">${esc(t('ge.btMethod', { w: cfg.window }))}</p>`, { sub: esc(t('ge.backtestSub')) }) : card(t('ge.backtest'), `<p class="muted small">${esc(t('ge.btNeed', { w: cfg.window }))} <a href="#/history">${esc(t('nav.history'))} →</a></p>`)}
      `}
      ${card(t('ge.aboutTitle'), `<p class="muted small">${esc(t('ge.about'))}</p>`)}
    `;

    if (bt && V) charts.render('chBt', charts.backtestSpec(bt.rows, v.nav, { labels: { pnl: t('ge.pnl'), var: t('ge.varLine'), exc: t('ge.exception') } }));

    const save = (fn, what) => store.update(pp => { pp.globalExposure = { ...geSettings(pp), ...(pp.globalExposure || {}) }; fn(pp.globalExposure); }, what || t('nav.globalExposure'));
    root.onclick = e => {
      const s = e.target.closest('[data-seg]');
      if (!s) return;
      if (s.dataset.seg === 'gem') save(g => { g.method = s.dataset.value; });
      if (s.dataset.seg === 'gemodel') save(g => { g.model = s.dataset.value; });
    };
    root.querySelector('#geWin')?.addEventListener('change', e => save(g => { g.window = +e.target.value; }));
    root.querySelector('#geAbs')?.addEventListener('change', e => { const x = numIn(e.target.value); if (x > 0) save(g => { g.absLimit = x; }); });
    root.querySelector('#geRel')?.addEventListener('change', e => { const x = numIn(e.target.value); if (x > 0) save(g => { g.relLimit = x; }); });
    root.querySelector('#geRef')?.addEventListener('change', e => save(g => { g.reference = e.target.value; }));
  }
};
