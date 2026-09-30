// Control log: sign off the daily limit check, handle breaches as cases, and read or export the
// chained log of everything done to the controls. The log itself lives in js/auditlog.js.
import * as store from '../store.js';
import { t } from '../i18n.js';
import { esc, card, pageHead, kpi, fmtNum, fmtDate, statusChip, table, openModal, closeModal, selectHtml, toast } from '../ui.js';
import { ruleName, unitVal, ruleLimit } from '../labels.js';
import { breachHistory } from '../insights.js';
import { snapshots } from '../snapshots.js';
import { caseId, caseList, unhandled, verify, lastSignoff, exportRows, fmtLimitValue } from '../auditlog.js';
import { toCSV } from '../importer.js';
import { downloadBlob, slug, todayISO } from '../util.js';

let cache = { key: '', value: null };
const CAUSES = ['active', 'passive', 'unknown'];

// Episodes from the limit history (cached like the compliance page does).
function episodes(p) {
  const snaps = snapshots(p);
  if (snaps.length < 2) return [];
  const key = [p.id, p.updatedAt, snaps.length, snaps[snaps.length - 1].date].join('|');
  if (cache.key !== key) cache = { key, value: breachHistory(p, snaps) };
  return cache.value?.episodes || [];
}

export function state(p, comp) {
  const log = p.controlLog || [];
  const valDate = store.valuationDate(p);
  const current = comp.rules.filter(r => r.status === 'breach');
  return {
    log, valDate, current,
    cases: caseList(log),
    todo: unhandled({ current, episodes: episodes(p), log, valDate }),
    chain: verify(log),
    signed: lastSignoff(log)
  };
}

const name = (id, data = {}) => (data.name ? data.name : ruleName(id));
const when = iso => `${fmtDate(iso.slice(0, 10))} ${iso.slice(11, 16)} UTC`;

// One line of text per entry, for the table and the CSV.
export function describe(e) {
  const d = e.data || {};
  const undo = d.undo ? ` (${t('cl.undo')})` : '';
  switch (e.kind) {
    case 'signoff': return t('cl.d.signoff', { n: d.checked, b: d.breaches, w: d.warnings }) + (d.unhandled ? ' ' + t('cl.d.signoffOpen', { n: d.unhandled }) : '') + (d.text ? ` — ${d.text}` : '');
    case 'case.open': return t('cl.d.open', { rule: name(d.rule, d), d: fmtDate(d.start), cause: t('cl.cause.' + (d.cause || 'unknown')) }) + (d.text ? ` — ${d.text}` : '') + (d.action ? ` · ${t('cl.action')}: ${d.action}` : '');
    case 'case.note': return t('cl.d.note', { rule: name(d.rule, d) }) + (d.cause ? ` [${t('cl.cause.' + d.cause)}]` : '') + (d.text ? ` — ${d.text}` : '') + (d.action ? ` · ${t('cl.action')}: ${d.action}` : '');
    case 'case.close': return t('cl.d.close', { rule: name(d.rule, d) }) + (d.text ? ` — ${d.text}` : '');
    case 'case.reopen': return t('cl.d.reopen', { rule: name(d.rule, d) }) + (d.text ? ` — ${d.text}` : '');
    case 'limit': return (d.field === 'on' ? t('cl.d.limitOn', { rule: t('limit.' + d.limit), v: t(d.to ? 'cl.on' : 'cl.off') }) : t('cl.d.limit', { rule: t('limit.' + d.limit), a: fmtLimitValue(d.from), b: fmtLimitValue(d.to) })) + undo;
    case 'rule': {
      const r = d.to || d.from || {};
      const lim = r2 => `${r2.dir === 'min' ? '≥' : '≤'} ${fmtLimitValue(r2.limit)}${r2.on === false ? ' (' + t('cl.off') + ')' : ''}`;
      return t('cl.d.rule.' + d.change, { name: r.name || '', a: d.from ? lim(d.from) : '', b: d.to ? lim(d.to) : '' }) + undo;
    }
    case 'ge': return t('cl.d.ge') + undo;
    case 'lmt': return t('cl.d.lmt') + undo;
    default: return e.kind;
  }
}

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const S = store.settings();
    const st = state(p, a.comp);
    const me = S.userName || '';
    const signedToday = st.signed && st.signed.valDate === st.valDate;
    const openCases = st.cases.filter(c => c.status === 'open');

    root.innerHTML = `
      ${pageHead(t('nav.controlLog'), esc(t('cl.sub')))}
      <div class="kpi-grid">
        ${kpi(t('cl.todo'), String(st.todo.length), { tone: st.todo.length ? 'breach' : 'ok', sub: t('cl.todoSub') })}
        ${kpi(t('cl.openCases'), String(openCases.length), { tone: openCases.length ? 'warn' : 'ok', sub: t('cl.casesTotal', { n: st.cases.length }) })}
        ${kpi(t('cl.lastSignoff'), st.signed ? esc(fmtDate(st.signed.valDate)) : '–', { tone: signedToday ? 'ok' : 'warn', sub: st.signed ? t('cl.byAt', { by: st.signed.by || t('cl.noName'), at: when(st.signed.at) }) : t('cl.never') })}
        ${kpi(t('cl.chain'), st.chain.ok ? esc(t('cl.chainOk')) : esc(t('cl.chainBroken')), { tone: st.chain.ok ? 'ok' : 'breach', sub: t('cl.entries', { n: st.chain.n }), help: t('cl.chainHelp') })}
      </div>
      ${!st.chain.ok ? `<div class="alert alert-breach" role="alert"><span>${esc(t('cl.chainBrokenAt', { n: st.chain.brokenAt }))}</span></div>` : ''}

      ${card(t('cl.who'), `
        <label class="form-inline"><span>${esc(t('cl.name'))}</span><input id="clName" value="${esc(me)}" placeholder="${esc(t('cl.namePh'))}" autocomplete="name"></label>
        <p class="muted small">${esc(t('cl.whoHelp'))}</p>`)}

      ${card(t('cl.signoff'), `
        <p>${t('cl.signoffStatus', { d: `<strong>${esc(fmtDate(st.valDate))}</strong>`, n: a.comp.rules.length, b: a.comp.breaches, w: a.comp.warnings })}</p>
        ${signedToday ? `<p class="small">${statusChip('ok')} ${esc(t('cl.signedAlready', { by: st.signed.by || t('cl.noName'), at: when(st.signed.at) }))}</p>` : ''}
        ${st.todo.length ? `<p class="small warn-text">${esc(t('cl.signoffTodo', { n: st.todo.length }))}</p>` : ''}
        <label class="form-stack"><span class="small">${esc(t('cl.comment'))}</span><textarea id="signText" rows="2" placeholder="${esc(t('cl.commentPh'))}"></textarea></label>
        <div class="btn-row"><button class="btn btn-primary" data-act="signoff" ${me ? '' : 'disabled'}>${esc(t('cl.signBtn', { d: fmtDate(st.valDate) }))}</button>${me ? '' : `<span class="muted small">${esc(t('cl.needName'))}</span>`}</div>`, { sub: esc(t('cl.signoffSub')) })}

      ${card(t('cl.todoTitle'), st.todo.length ? table([
        { key: 'r', label: t('cmp.rule'), fmt: x => esc(ruleName(x.rule)) },
        { key: 's', label: t('bh.start'), fmt: x => esc(fmtDate(x.start)) },
        { key: 'e', label: t('bh.end'), fmt: x => x.ongoing ? `<span class="chip chip-breach">${esc(t('bh.stillOpen'))}</span>` : esc(fmtDate(x.end)) },
        { key: 'c', label: t('bh.cause'), fmt: x => `<span class="chip ${x.cause === 'active' ? 'chip-breach' : x.cause === 'passive' ? 'chip-warn' : ''}">${esc(t('cl.cause.' + x.cause))}</span>` },
        { key: 'v', label: t('bh.worst'), align: 'right', fmt: x => `${esc(unitVal(x.peak, x.rule))} <span class="muted small">(${esc(ruleLimit({ id: x.rule, dir: x.dir, limit: x.limit }))})</span>` },
        { key: 'b', label: '', align: 'right', fmt: x => `<button class="btn btn-sm" data-open="${esc(x.rule)}|${esc(x.start)}" ${me ? '' : 'disabled'}>${esc(t('cl.openCase'))}</button>` }
      ], st.todo, { dense: true }) : `<p class="muted small">${esc(t('cl.todoNone'))}</p>`, { sub: esc(t('cl.todoTitleSub')) })}

      ${card(t('cl.cases'), st.cases.length ? `<div class="cl-cases">${st.cases.map(c => `
        <article class="cl-case ${c.status}">
          <div class="cl-case-head">
            <span class="chip ${c.status === 'open' ? 'chip-warn' : 'chip-ok'}">${esc(t('cl.status.' + c.status))}</span>
            <strong>${esc(name(c.rule, c))}</strong>
            <span class="muted small">${esc(t('cl.since', { d: fmtDate(c.start) }))} · ${esc(t('cl.cause.' + c.cause))}${c.peak != null ? ' · ' + esc(t('bh.worst')) + ' ' + esc(unitVal(c.peak, c.rule)) : ''}</span>
            <span class="row-actions">
              <button class="btn btn-sm" data-note="${esc(c.id)}" ${me ? '' : 'disabled'}>${esc(t('cl.addNote'))}</button>
              ${c.status === 'open' ? `<button class="btn btn-sm btn-primary" data-close="${esc(c.id)}" ${me ? '' : 'disabled'}>${esc(t('cl.closeCase'))}</button>` : `<button class="btn btn-sm" data-reopen="${esc(c.id)}" ${me ? '' : 'disabled'}>${esc(t('cl.reopen'))}</button>`}
            </span>
          </div>
          <ul class="cl-notes small">
            <li><span class="muted">${esc(when(c.opened.at))} · ${esc(c.opened.by || t('cl.noName'))}</span> ${esc(t('cl.opened'))}</li>
            ${c.notes.map(n => `<li><span class="muted">${esc(when(n.at))} · ${esc(n.by || t('cl.noName'))}</span> ${n.cause && n.kind !== 'case.open' ? `[${esc(t('cl.cause.' + n.cause))}] ` : ''}${esc(n.text)}${n.action ? ` <em>${esc(t('cl.action'))}: ${esc(n.action)}</em>` : ''}</li>`).join('')}
            ${c.closed ? `<li><span class="muted">${esc(when(c.closed.at))} · ${esc(c.closed.by || t('cl.noName'))}</span> <strong>${esc(t('cl.closed'))}</strong>${c.closed.text ? ' — ' + esc(c.closed.text) : ''}</li>` : ''}
          </ul>
        </article>`).join('')}</div>` : `<p class="muted small">${esc(t('cl.casesNone'))}</p>`, { sub: esc(t('cl.casesSub')) })}

      ${card(t('cl.log'), `
        <p class="small">${st.chain.ok ? statusChip('ok') : statusChip('breach')} ${esc(st.chain.ok ? t('cl.chainOkLong', { n: st.chain.n }) : t('cl.chainBrokenAt', { n: st.chain.brokenAt }))}</p>
        <p class="small">${esc(t('cl.head'))} <code class="hash">${esc(st.chain.head)}</code></p>
        <div class="btn-row"><button class="btn btn-sm" data-act="csv" ${st.log.length ? '' : 'disabled'}>${esc(t('cl.exportCsv'))}</button><button class="btn btn-sm" data-act="json" ${st.log.length ? '' : 'disabled'}>${esc(t('cl.exportJson'))}</button></div>
        ${st.log.length ? table([
          { key: 'seq', label: '#', align: 'right', fmt: e => String(e.seq) },
          { key: 'at', label: t('cl.time'), fmt: e => esc(when(e.at)) },
          { key: 'by', label: t('cl.by'), fmt: e => esc(e.by || t('cl.noName')) },
          { key: 'vd', label: t('top.valdate'), fmt: e => esc(fmtDate(e.valDate)) },
          { key: 'k', label: t('cl.kind'), fmt: e => `<span class="chip">${esc(t('cl.kind.' + e.kind.replace('.', '_')))}</span>` },
          { key: 'd', label: t('cl.what'), fmt: e => esc(describe(e)) }
        ], [...st.log].reverse(), { dense: true, maxRows: 300 }) : `<p class="muted small">${esc(t('cl.logEmpty'))}</p>`}
        <p class="muted small">${esc(t('cl.logHelp'))}</p>`, { sub: esc(t('cl.logSub')) })}
    `;

    root.querySelector('#clName').addEventListener('change', e => { store.setSetting('userName', e.target.value.trim()); });

    root.onclick = e => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      const act = b.dataset.act;
      if (act === 'signoff') {
        store.logControl([{ kind: 'signoff', valDate: st.valDate, data: { checked: a.comp.rules.length, breaches: a.comp.breaches, warnings: a.comp.warnings, breached: st.current.map(r => r.id), unhandled: st.todo.length, text: root.querySelector('#signText').value.trim() } }]);
        toast(t('cl.signedDone', { d: fmtDate(st.valDate) }));
      }
      if (act === 'csv') downloadBlob(toCSV(exportRows(st.log, describe)), 'text/csv', `${slug(p.name)}-control-log-${todayISO()}.csv`);
      if (act === 'json') downloadBlob(JSON.stringify({ app: 'nexus-portfolio-lab', portfolio: p.name, exportedAt: new Date().toISOString(), head: st.chain.head, intact: st.chain.ok, entries: st.log }, null, 2), 'application/json', `${slug(p.name)}-control-log-${todayISO()}.json`);
      if (b.dataset.open) {
        const [rule, start] = b.dataset.open.split('|');
        const x = st.todo.find(y => y.rule === rule && y.start === start);
        if (x) caseDialog({ mode: 'open', item: x });
      }
      const find = id => st.cases.find(c => c.id === id);
      if (b.dataset.note) caseDialog({ mode: 'note', c: find(b.dataset.note) });
      if (b.dataset.close) caseDialog({ mode: 'close', c: find(b.dataset.close) });
      if (b.dataset.reopen) caseDialog({ mode: 'reopen', c: find(b.dataset.reopen) });
    };
  }
};

// Open a case, add a note, close or reopen one. Every save is one log entry.
function caseDialog({ mode, item = null, c = null }) {
  if (mode !== 'open' && !c) return;
  const rule = item ? item.rule : c.rule;
  const cause = item ? item.cause : c.cause;
  const needsText = mode === 'close' || mode === 'reopen';
  const m = openModal(`<div class="modal-head"><h2>${esc(t('cl.dlg.' + mode))}</h2><p class="muted small">${esc(name(rule, c || {}))}${item ? ' · ' + esc(t('cl.since', { d: fmtDate(item.start) })) : ''}</p></div>
    <form class="modal-body form-stack" id="caseForm">
      ${mode === 'open' || mode === 'note' ? `<label><span>${esc(t('bh.cause'))}</span>${selectHtml('name="cause"', CAUSES.map(k => [k, t('cl.cause.' + k)]), cause)}<small class="muted">${esc(t('cl.causeHelp'))}</small></label>` : ''}
      <label><span>${esc(t(mode === 'close' ? 'cl.closeText' : mode === 'reopen' ? 'cl.reopenText' : 'cl.text'))}</span><textarea name="text" rows="3" ${needsText ? 'required' : ''} placeholder="${esc(t(mode === 'close' ? 'cl.closePh' : 'cl.textPh'))}"></textarea></label>
      ${mode === 'open' || mode === 'note' ? `<label><span>${esc(t('cl.action'))}</span><textarea name="action" rows="2" placeholder="${esc(t('cl.actionPh'))}"></textarea></label>` : ''}
      <p class="muted small">${esc(t('cl.dlgHelp'))}</p>
    </form>
    <div class="modal-foot"><button class="btn" data-close>${esc(t('common.cancel'))}</button><button class="btn btn-primary" form="caseForm" type="submit">${esc(t('common.save'))}</button></div>`);
  m.querySelector('#caseForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const text = f.text.value.trim(), action = f.action?.value.trim() || '';
    if (needsText && !text) return;
    if (mode === 'open') {
      store.logControl([{ kind: 'case.open', data: { case: caseId(item.rule, item.start), rule: item.rule, name: ruleName(item.rule), start: item.start, cause: f.cause.value, peak: item.peak, limit: item.limit, text, action } }]);
    } else {
      const data = { case: c.id, rule: c.rule, name: name(c.rule, c), text };
      if (mode === 'note') { if (f.cause.value !== c.cause) data.cause = f.cause.value; if (action) data.action = action; if (!text && !action && !data.cause) { closeModal(); return; } }
      store.logControl([{ kind: 'case.' + mode, data }]);
    }
    closeModal();
    toast(t('cl.saved'));
  });
}
