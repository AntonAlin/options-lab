import * as store from '../store.js';
import { t, L } from '../i18n.js';
import { esc, card, pageHead, fmtMoney, fmtPct, fmtNum, table, openModal, closeModal, confirmDialog, toast, selectHtml, empty } from '../ui.js';
import { INSTRUMENTS, GROUPS, FIELDS, OPTION_LABELS, fieldLabel, typeLabel, validatePosition } from '../instruments.js';
import { makeCtx } from '../analytics.js';
import { uid, isNum, sum, downloadBlob, slug, loadScript, todayISO } from '../util.js';
import { toCSV, positionRows, XLSX_URL, XLSX_SRI } from '../importer.js';
import { checkHoldings } from '../datachecks.js';
import { snapshots } from '../snapshots.js';
import { dataChecksCard } from './datachecks-card.js';

// Today's holdings against the latest earlier snapshot (a connected file's previous date, or a
// saved snapshot): the checks that catch a bad daily file. Cached per portfolio version.
let checkCache = { key: '', res: null, prevDate: '' };
function holdingChecks(p) {
  const date = p.source?.shown || p.valDate || todayISO();
  const key = p.id + '|' + p.updatedAt + '|' + date;
  if (checkCache.key !== key) {
    const prev = snapshots(p).filter(s => s.date < date).pop();
    checkCache = { key, prevDate: prev?.date || '', res: prev && p.positions.length ? checkHoldings(prev.positions, p.positions, { p, prevDate: prev.date, nextDate: date, complete: true }) : null };
  }
  return checkCache;
}

const ui = { q: '', type: '', sort: 'mv', dir: -1, selected: new Set() };

function errorText(e, type) {
  const f = fieldLabel(type, e.field);
  const [code, arg] = e.code.split(':');
  if (code === 'one_of') return t('val.oneOf', { fields: arg.split('|').map(k => fieldLabel(type, k)).join(' / ') });
  if (code === 'type_guessed') return t('val.typeGuessed', { raw: arg });
  if (code === 'unknown_type' && arg) return t('val.unknownTypeRaw', { raw: arg });
  return t('val.' + code, { field: f });
}

function extraCell(x) {
  const r = x.r;
  if (r.fi && !r.fi.derivative && !r.fi.fund) return `${fmtPct(r.fi.ytm, 2)} · D ${fmtNum(r.fi.modDur, 2)}`;
  if (r.option) return `Δ ${fmtNum(r.option.delta, 2)}`;
  if (x.pos.type === 'future' || x.pos.type === 'irs' || x.pos.type === 'cds') return `${t('col.notional')} ${fmtMoney(r.exposure, '', { compact: true })}`;
  if (x.pos.type === 'fx_forward') return `${esc(x.pos.buyCcy)}/${esc(x.pos.sellCcy)} ${esc(x.pos.maturity || '')}`;
  if (isNum(x.pos.beta) && r.eqDelta) return `β ${fmtNum(x.pos.beta, 2)}`;
  return '';
}

export default {
  render(root, app) {
    const p = store.active();
    const a = app.analysis();
    const v = a.v;
    const base = p.baseCcy;
    const q = ui.q.toLowerCase();
    let rows = v.rows.filter(x => (!ui.type || x.pos.type === ui.type) &&
      (!q || [x.name, x.pos.ticker, x.pos.isin, x.pos.issuer, x.pos.sector, x.pos.strategy].some(s => String(s || '').toLowerCase().includes(q))));
    const sorters = {
      name: x => x.name.toLowerCase(), type: x => typeLabel(x.pos.type), mv: x => x.r?.mv ?? -Infinity,
      weight: x => x.weight ?? -Infinity, exposure: x => x.r?.exposure ?? -Infinity, ccy: x => x.pos.ccy || '', qty: x => x.pos.qty ?? 0
    };
    const sf = sorters[ui.sort] || sorters.mv;
    rows = [...rows].sort((x, y) => { const A = sf(x), B = sf(y); return (A > B ? 1 : A < B ? -1 : 0) * ui.dir; });
    ui.selected.forEach(id => { if (!p.positions.some(x => x.id === id)) ui.selected.delete(id); });

    const typesPresent = [...new Set(p.positions.map(x => x.type))];
    const cols = [
      { key: 'sel', label: '', fmt: x => `<input type="checkbox" class="rowsel" data-id="${x.pos.id}" ${ui.selected.has(x.pos.id) ? 'checked' : ''} aria-label="${esc(t('hold.select'))}">` },
      { key: 'name', label: t('col.name'), sort: 1, fmt: x => `<button class="linkish cell-name" data-edit="${x.pos.id}">${esc(x.name)}</button><div class="cell-sub">${esc([x.pos.ticker, x.pos.isin].filter(Boolean).join(' · '))}${x.pos.strategy ? `<span class="strategy-tag">${esc(x.pos.strategy)}</span>` : ''}</div>` },
      { key: 'type', label: t('col.type'), sort: 1, cls: 'nowrap', fmt: x => `<span class="type-tag">${esc(INSTRUMENTS[x.pos.type]?.icon || '?')}</span> ${esc(typeLabel(x.pos.type))}` },
      { key: 'qty', label: t('col.qty'), align: 'right', sort: 1, fmt: x => fmtNum(x.pos.qty ?? x.pos.buyAmount, isNum(x.pos.qty) && Math.abs(x.pos.qty) < 100 && x.pos.qty % 1 ? 2 : 0) },
      { key: 'price', label: t('col.price'), align: 'right', fmt: x => isNum(x.pos.price) ? fmtNum(x.pos.price, x.pos.price < 10 ? 4 : 2) : (isNum(x.pos.yield) ? fmtPct(x.pos.yield / 100, 2) : '—') },
      { key: 'ccy', label: t('col.ccy'), sort: 1, fmt: x => esc(x.pos.ccy || '') },
      { key: 'mv', label: t('col.mv', { base }), align: 'right', sort: 1, fmt: x => x.r ? fmtMoney(x.r.mv) : '—' },
      { key: 'weight', label: t('col.weight'), align: 'right', sort: 1, fmt: x => x.r ? fmtPct(x.weight, 2) : '—' },
      { key: 'exposure', label: t('col.exposure'), align: 'right', sort: 1, fmt: x => x.r ? fmtPct(x.expWeight, 1) : '—' },
      { key: 'extra', label: t('col.keyFigures'), align: 'right', cls: 'nowrap', fmt: x => x.r ? extraCell(x) : '' },
      { key: 'st', label: '', fmt: x => x.errors.length ? `<span class="chip chip-breach" title="${esc(x.errors.map(e => errorText(e, x.pos.type)).join('\n'))}">✕ ${x.errors.length}</span>` : x.warnings.length ? `<span class="chip chip-warn" title="${esc(x.warnings.map(w => t('warn.' + w.split(':')[0], { x: w.split(':')[1] || '' })).join('\n'))}">!</span>` : '' },
      { key: 'act', label: '', fmt: x => `<div class="row-actions"><button class="icon-btn sm" data-dup="${x.pos.id}" title="${esc(t('common.duplicate'))}" aria-label="${esc(t('common.duplicate'))}">⧉</button><button class="icon-btn sm" data-del="${x.pos.id}" title="${esc(t('common.delete'))}" aria-label="${esc(t('common.delete'))}">✕</button></div>` }
    ];

    root.innerHTML = `
      ${pageHead(t('nav.holdings'), esc(t('hold.sub', { n: v.rows.length, nav: fmtMoney(v.nav, base, { compact: true }) })),
        `<button class="btn" data-act="csv">${esc(t('hold.exportCsv'))}</button><button class="btn" data-act="xlsx">${esc(t('hold.exportXlsx'))}</button><a class="btn" href="#/import">${esc(t('nav.import'))}</a><button class="btn btn-primary" data-act="add">+ ${esc(t('hold.add'))}</button>`)}
      ${p.source && p.source.file ? `<div class="alert alert-info"><span>${esc(t('src.holdingsNote', { name: p.source.fileName, d: p.source.shown || p.valDate }))}</span></div>` : ''}
      ${(() => { const c = holdingChecks(p); return dataChecksCard(c.res, { sub: t('dc.subHoldings', { d: c.prevDate }), compact: true }); })()}
      <div class="toolbar">
        <input type="search" id="hq" placeholder="${esc(t('hold.search'))}" value="${esc(ui.q)}" aria-label="${esc(t('hold.search'))}">
        ${selectHtml('id="htype" aria-label="' + esc(t('col.type')) + '"', [['', t('hold.allTypes')], ...typesPresent.map(k => [k, typeLabel(k)])], ui.type)}
        ${ui.selected.size ? `<button class="btn btn-danger btn-sm" data-act="delsel">${esc(t('hold.deleteSelected', { n: ui.selected.size }))}</button>` : ''}
        <span class="muted small">${esc(t('hold.showing', { n: rows.length, total: v.rows.length }))}</span>
      </div>
      ${v.rows.length ? card('', table(cols, rows, {
        sortKey: ui.sort, sortDir: ui.dir,
        rowAttr: x => x.errors.length ? 'class="row-error"' : '',
        foot: ['', t('common.total'), '', '', '', '', fmtMoney(sum(rows.map(x => x.r?.mv || 0))), fmtPct(sum(rows.map(x => x.weight || 0)), 1), fmtPct(sum(rows.map(x => x.expWeight || 0)), 1), '', '', '']
      }), { cls: 'flush' }) : empty(esc(t('hold.empty')), `<div class="btn-row"><button class="btn btn-primary" data-act="add">+ ${esc(t('hold.add'))}</button><a class="btn" href="#/import">${esc(t('nav.import'))}</a></div>`)}
    `;

    const onSearch = e => { ui.q = e.target.value; const pos = e.target.selectionStart; app.rerender(); const el = document.getElementById('hq'); el.focus(); el.setSelectionRange(pos, pos); };
    root.querySelector('#hq')?.addEventListener('input', onSearch);
    root.querySelector('#htype')?.addEventListener('change', e => { ui.type = e.target.value; app.rerender(); });
    root.onclick = async e => {
      const el = e.target.closest('button,[data-sort],input.rowsel');
      if (!el) return;
      if (el.matches('input.rowsel')) { el.checked ? ui.selected.add(el.dataset.id) : ui.selected.delete(el.dataset.id); app.rerender(); return; }
      if (el.dataset.sort) { if (ui.sort === el.dataset.sort) ui.dir *= -1; else { ui.sort = el.dataset.sort; ui.dir = el.dataset.sort === 'name' || el.dataset.sort === 'type' ? 1 : -1; } app.rerender(); return; }
      if (el.dataset.edit) return openForm(p.positions.find(x => x.id === el.dataset.edit));
      if (el.dataset.dup) {
        const src = p.positions.find(x => x.id === el.dataset.dup);
        store.update(pp => { const i = pp.positions.findIndex(x => x.id === src.id); pp.positions.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(src)), id: uid(), name: (src.name || '') + ' ' + t('pf.copySuffix') }); }, t('common.duplicate'));
        return;
      }
      if (el.dataset.del) {
        const pos = p.positions.find(x => x.id === el.dataset.del);
        store.update(pp => { pp.positions = pp.positions.filter(x => x.id !== pos.id); }, t('common.delete'));
        toast(t('hold.deleted', { name: pos.name || '' }), { action: () => store.undo(), actionLabel: t('common.undo') });
        return;
      }
      const act = el.dataset.act;
      if (act === 'add') return typePicker();
      if (act === 'delsel') {
        const n = ui.selected.size;
        if (!(await confirmDialog(t('hold.deleteSelectedConfirm', { n }), { ok: t('common.delete'), danger: true }))) return;
        const ids = new Set(ui.selected);
        store.update(pp => { pp.positions = pp.positions.filter(x => !ids.has(x.id)); }, t('common.delete'));
        ui.selected.clear();
        toast(t('hold.deletedN', { n }), { action: () => store.undo(), actionLabel: t('common.undo') });
      }
      if (act === 'csv') exportHoldings(p, v, 'csv');
      if (act === 'xlsx') exportHoldings(p, v, 'xlsx');
    };
  }
};

// The importable position columns plus three computed ones.
function exportRows(p, v) {
  const [head, ...body] = positionRows(p);
  const byId = new Map(v.rows.map(x => [x.pos.id, x]));
  return [[...head, 'marketValue_' + p.baseCcy, 'weightPct', 'exposurePct'],
    ...body.map((row, i) => { const x = byId.get(p.positions[i].id); return [...row, x?.r ? Math.round(x.r.mv * 100) / 100 : '', x?.r ? +(x.weight * 100).toFixed(4) : '', x?.r ? +(x.expWeight * 100).toFixed(4) : '']; })];
}
async function exportHoldings(p, v, kind) {
  const rows = exportRows(p, v);
  if (kind === 'csv') { downloadBlob('﻿' + toCSV(rows, ','), 'text/csv;charset=utf-8', slug(p.name) + '-holdings.csv'); return; }
  try {
    await loadScript(XLSX_URL, { integrity: XLSX_SRI });
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Holdings');
    XLSX.writeFile(wb, slug(p.name) + '-holdings.xlsx');
  } catch (e) { toast(t('err.lib'), { tone: 'warn' }); }
}

// ---- type picker & form ------------------------------------------------------------------------------
function typePicker() {
  const byGroup = {};
  Object.entries(INSTRUMENTS).forEach(([id, d]) => (byGroup[d.group] ||= []).push([id, d]));
  const m = openModal(`<div class="modal-head"><h2>${esc(t('hold.pickType'))}</h2><button class="icon-btn" data-close aria-label="${esc(t('common.close'))}">✕</button></div>
    <div class="modal-body">${Object.entries(byGroup).map(([g, list]) => `<h3 class="picker-group">${esc(L(GROUPS[g]))}</h3>
      <div class="type-grid">${list.map(([id, d]) => `<button class="type-card" data-type="${id}"><span class="type-tag">${esc(d.icon)}</span><strong>${esc(L(d))}</strong><small>${esc(L(d.hint))}</small></button>`).join('')}</div>`).join('')}
    </div>`, { wide: true });
  m.addEventListener('click', e => { const b = e.target.closest('[data-type]'); if (b) { closeModal(); openForm({ type: b.dataset.type }); } });
}

function inputFor(type, key, val) {
  const spec = FIELDS[key];
  const req = INSTRUMENTS[type].required.includes(key);
  const label = `${esc(fieldLabel(type, key))}${req ? ' <span class="req" aria-hidden="true">*</span>' : ''}`;
  const name = `name="${key}" ${req ? 'aria-required="true"' : ''}`;
  let control;
  if (spec.type === 'select') {
    const opts = (spec.options || []).map(o => [o, L(OPTION_LABELS[o] || { en: o })]);
    control = selectHtml(name, [['', '—'], ...opts], val ?? '');
  } else if (spec.type === 'number') control = `<input ${name} type="text" inputmode="decimal" value="${isNum(val) ? val : esc(val ?? '')}" autocomplete="off">`;
  else if (spec.type === 'date') control = `<input ${name} type="date" value="${esc(val ?? '')}">`;
  else if (spec.type === 'ccy') control = `<input ${name} list="ccyList" maxlength="3" value="${esc(val ?? '')}" class="upper" autocomplete="off">`;
  else if (key === 'rating') control = `<input ${name} list="ratingList" value="${esc(val ?? '')}" class="upper" autocomplete="off">`;
  else control = `<input ${name} value="${esc(val ?? '')}" autocomplete="off">`;
  return `<label class="${key === 'notes' || key === 'name' ? 'span-2' : ''}" data-field="${key}"><span>${label}</span>${control}<small class="field-err" aria-live="polite"></small></label>`;
}

function readForm(form, type) {
  const pos = { type };
  const dec = '.';
  for (const key of INSTRUMENTS[type].fields) {
    const el = form.elements[key];
    if (!el) continue;
    let v = el.value.trim();
    if (v === '') continue;
    const spec = FIELDS[key];
    if (spec.type === 'number') {
      // Accept either decimal separator — people paste from everywhere. In English, "1,250" is thousands.
      const s = v.replace(/[\s\u00a0\u202f]/g, '').replace(/\u2212/g, '-');
      const enThousands = dec === '.' && /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s);
      const n = !enThousands && /,\d+$/.test(s) && !/\.\d*,/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/,/g, ''));
      pos[key] = Number.isFinite(n) ? n : v;
    } else if (spec.type === 'ccy' || key === 'rating') pos[key] = v.toUpperCase();
    else pos[key] = v;
  }
  return pos;
}

// `onSave(pos)` makes the form hand the validated position back instead of saving it (Pre-trade uses it).
export function openForm(existing, { onSave = null } = {}) {
  const p = store.active();
  let type = INSTRUMENTS[existing.type] ? existing.type : 'equity';
  const isNew = !existing.id;
  const draft = { ...(INSTRUMENTS[type].defaults || {}), ccy: p.baseCcy, ...existing };

  const renderForm = () => `
    <div class="modal-head"><h2>${esc(isNew ? t('hold.addTitle', { type: typeLabel(type) }) : t('hold.editTitle'))}</h2><button class="icon-btn" data-close aria-label="${esc(t('common.close'))}">✕</button></div>
    <form class="modal-body" id="posForm" novalidate>
      <div class="form-top">
        <label><span>${esc(t('col.type'))}</span>${selectHtml('name="__type"', Object.keys(INSTRUMENTS).map(k => [k, typeLabel(k)]), type)}</label>
        <p class="hint">${esc(L(INSTRUMENTS[type].hint))}</p>
      </div>
      <div class="form-grid">${INSTRUMENTS[type].fields.map(k => inputFor(type, k, draft[k])).join('')}</div>
      <div class="preview" id="posPreview"></div>
      <datalist id="ccyList">${store.CURRENCIES.map(c => `<option value="${c}">`).join('')}</datalist>
      <datalist id="ratingList">${['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC'].map(c => `<option value="${c}">`).join('')}</datalist>
    </form>
    <div class="modal-foot">
      <span class="muted small"><span class="req">*</span> ${esc(t('hold.required'))}</span>
      <button class="btn" data-close>${esc(t('common.cancel'))}</button>
      ${isNew && !onSave ? `<button class="btn" data-save="again">${esc(t('hold.saveAddAnother'))}</button>` : ''}
      <button class="btn btn-primary" data-save="close">${esc(t('common.save'))}</button>
    </div>`;

  const m = openModal(renderForm(), { wide: true });
  const wire = () => {
    const form = m.querySelector('#posForm');
    const preview = () => {
      const pos = readForm(form, type);
      const errs = validatePosition(pos);
      form.querySelectorAll('[data-field]').forEach(l => { l.classList.remove('invalid'); l.querySelector('.field-err').textContent = ''; });
      const box = m.querySelector('#posPreview');
      if (errs.length) { box.innerHTML = `<span class="muted">${esc(t('hold.previewNeeds', { n: errs.length }))}</span>`; return errs; }
      const ctx = makeCtx(p);
      let r;
      try { r = INSTRUMENTS[type].risk(pos, ctx); } catch (e) { r = null; }
      if (!r) { box.textContent = ''; return errs; }
      const bits = [`${esc(t('col.mv', { base: p.baseCcy }))}: <strong>${fmtMoney(r.mv, p.baseCcy)}</strong>`, `${esc(t('col.exposure'))}: ${fmtMoney(r.exposure, p.baseCcy, { compact: true })}`];
      if (r.fi && isNum(r.fi.ytm)) bits.push(`${esc(t('kpi.ytm'))}: ${fmtPct(r.fi.ytm, 3)}`);
      if (r.fi && isNum(r.fi.modDur)) bits.push(`${esc(t('fi.modDur'))}: ${fmtNum(r.fi.modDur, 2)}`);
      if (r.option) bits.push(`${esc(t('risk.modelPrice'))}: ${fmtNum(r.option.model, 2)} · Δ ${fmtNum(r.option.delta, 3)}`);
      if (r.warnings.length) bits.push(`<span class="warn-text">${r.warnings.map(w => esc(t('warn.' + w.split(':')[0], { x: w.split(':')[1] || '' }))).join(', ')}</span>`);
      box.innerHTML = bits.join(' · ');
      return errs;
    };
    form.addEventListener('input', preview);
    form.addEventListener('change', e => {
      if (e.target.name === '__type') {
        Object.assign(draft, readForm(form, type));
        type = e.target.value;
        for (const [k, val] of Object.entries(INSTRUMENTS[type].defaults || {})) if (draft[k] === undefined || draft[k] === '') draft[k] = val;
        m.innerHTML = renderForm();
        m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
        wire();
      }
    });
    preview();
    m.querySelectorAll('[data-save]').forEach(btn => btn.onclick = () => {
      const pos = readForm(form, type);
      const errs = validatePosition(pos);
      if (errs.length) {
        errs.forEach(er => {
          const l = form.querySelector(`[data-field="${er.field}"]`);
          if (l) { l.classList.add('invalid'); l.querySelector('.field-err').textContent = errorText(er, type); }
        });
        form.querySelector('.invalid input, .invalid select')?.focus();
        return;
      }
      if (onSave) { pos.id = existing.id || uid(); closeModal(); onSave(pos); return; }
      if (isNew) {
        pos.id = uid();
        store.update(pp => pp.positions.push(pos), t('hold.add'));
        toast(t('hold.added', { name: pos.name || typeLabel(type) }));
      } else {
        pos.id = existing.id;
        if (existing.seriesKey) pos.seriesKey = existing.seriesKey;
        store.update(pp => { const i = pp.positions.findIndex(x => x.id === existing.id); pp.positions[i] = pos; }, t('hold.editTitle'));
        toast(t('common.saved'));
      }
      if (btn.dataset.save === 'again') { closeModal(); openForm({ type, ccy: pos.ccy }); }
      else closeModal();
    });
  };
  wire();
}

