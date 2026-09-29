import * as store from '../store.js';
import { t, L } from '../i18n.js';
import { esc, card, pageHead, table, toast, selectHtml, segmented, fmtNum, fmtPct, openModal, closeModal, confirmDialog, privacyCallout } from '../ui.js';
import { loadModels, suggestColumns, suggestType } from '../suggest.js';
import { checkHoldings } from '../datachecks.js';
import { dataChecksCard } from './datachecks-card.js';
import { INSTRUMENTS, FIELDS, OPTION_LABELS, allFieldKeys, fieldLabel, typeLabel } from '../instruments.js';
import {
  readFile, parseText, findHeaderRow, autoMapping, rowsToPositions, mergePositions, templateCSV, templateColumns, TEMPLATE_EXAMPLES, XLSX_URL,
  typeValues, mandatoryFields, buildTemplate, applyTemplateMapping, detectTemplate, validateTemplate, DATE_FORMATS, mergeHistory
} from '../importer.js';
import { downloadBlob, loadScript, slug, todayISO } from '../util.js';
import { datedLayout, splitSnapshots, snapshotHistory } from '../sourcefile.js';
import { MAX_SAVED } from '../snapshots.js';
import { sourceCardHtml, bindSourceCard } from './source-card.js';

// Import state survives re-renders but not a page reload.
const FRESH = () => ({
  name: '', parsed: null, sheet: 0, headerRow: 0, mapping: [], decimal: '.', dateFormat: 'auto', defaultType: 'auto',
  transforms: {}, constants: {}, typeMap: {}, skipPattern: '', templateId: '', autoApplied: '',
  onlyErrors: false, includeInvalid: false, date: '', asOf: '', ignored: []
});
const st = { ...FRESH(), mode: 'append' };
// Trained suggestion model (js/suggest.js), fetched the first time a file is open here.
let models = null;
let lastSuggestions = [];
function reset() { Object.assign(st, FRESH()); }

const SCALES = [[1, '×1'], [100, '×100'], [0.01, '÷100'], [1000, '×1 000'], [0.001, '÷1 000'], [-1, '×−1']];
const ACCEPT = '.csv,.txt,.tsv,.prn,.dat,.json,.xml,.xlsx,.xlsm,.xls,.ods';

function currentRows() {
  const rows = st.parsed?.sheets[st.sheet]?.rows || [];
  return { header: (rows[st.headerRow] || []).map(h => (h instanceof Date ? h.toISOString().slice(0, 10) : h)), body: rows.slice(st.headerRow + 1) };
}

// A dated file: date column (mandatory in a holdings file — either in the file or set below) and an
// optional portfolio column. Every row is one holding of one portfolio on one date.
function datedInfo() {
  const rows = st.parsed?.sheets[st.sheet]?.rows || [];
  const lay = datedLayout(rows, st.headerRow);
  if (lay.dateCol < 0) return null;
  const { groups, skipped } = splitSnapshots(rows, lay);
  const dates = [...new Set(groups.flatMap(g => g.dates.map(d => d.date)))].sort();
  return dates.length ? { ...lay, groups, dates, skipped } : null;
}
const parseOpts = () => ({ decimal: st.decimal, defaultType: st.defaultType, constants: st.constants, transforms: st.transforms, typeMap: st.typeMap, skipPattern: st.skipPattern, dateFormat: st.dateFormat });

function applyTemplate(tpl) {
  const { header } = currentRows();
  st.mapping = applyTemplateMapping(tpl, header);
  st.transforms = JSON.parse(JSON.stringify(tpl.transforms || {}));
  st.constants = { ...(tpl.constants || {}) };
  st.typeMap = { ...(tpl.typeMap || {}) };
  st.skipPattern = tpl.skipPattern || '';
  st.decimal = tpl.decimal || st.decimal;
  st.dateFormat = tpl.dateFormat || 'auto';
  st.defaultType = tpl.defaultType || 'auto';
  if (tpl.mode) st.mode = tpl.mode;
  st.templateId = tpl.id;
}

function setParsed(name, parsed) {
  reset();
  st.name = name; st.parsed = parsed; st.decimal = parsed.decimal;
  // A saved template that matches the headers wins; otherwise guess from the column names.
  const hit = detectTemplate(store.templates(), parsed.sheets);
  if (hit) {
    st.sheet = hit.sheet; st.headerRow = hit.headerRow;
    applyTemplate(hit.template);
    st.autoApplied = hit.template.name;
    return;
  }
  st.sheet = Math.max(0, parsed.sheets.findIndex(s => s.rows.length > 1));
  st.headerRow = findHeaderRow(parsed.sheets[st.sheet].rows);
  st.mapping = autoMapping(currentRows().header);
}

export function errText(e, type) {
  const [code, arg] = e.code.split(':');
  const f = fieldLabel(type, e.field);
  if (code === 'one_of') return t('val.oneOf', { fields: arg.split('|').map(k => fieldLabel(type, k)).join(' / ') });
  if (code === 'type_guessed') return t('val.typeGuessed', { raw: arg });
  if (code === 'unknown_type' && arg) return t('val.unknownTypeRaw', { raw: arg });
  return t('val.' + code, { field: f });
}

const fieldName = f => (FIELDS[f] ? FIELDS[f].en : f);

// Input for a constant value, shaped by the field type.
function constantInput(field, value) {
  const spec = FIELDS[field];
  const attrs = `data-const="${field}" aria-label="${esc(fieldName(field))}"`;
  if (field === 'type') return selectHtml(attrs, [['', '—'], ...Object.keys(INSTRUMENTS).map(k => [k, typeLabel(k)])], value || '');
  if (spec?.type === 'select') return selectHtml(attrs, [['', '—'], ...(spec.options || []).map(o => [o, L(OPTION_LABELS[o] || { en: o })])], value || '');
  if (spec?.type === 'date') return `<input type="date" ${attrs} value="${esc(value || '')}">`;
  if (spec?.type === 'ccy') return `<input ${attrs} class="upper w-80" maxlength="3" value="${esc(value || '')}" placeholder="SEK">`;
  return `<input ${attrs} value="${esc(value ?? '')}" placeholder="${esc(t('imp.constantPh'))}">`;
}

// The file against the portfolio's current holdings, before it is imported. A dated file and
// "replace" deliver the whole portfolio, so a large holding missing from them is flagged too.
const usable = r => !r.errors.some(e => !e.code.startsWith('type_guessed'));
function importChecks(p, D, valid) {
  if (!p.positions.length || (!D && st.mode === 'append')) return null;
  let next = valid.map(r => r.pos);
  if (D) {
    const g = D.groups.find(x => !x.key || x.key.trim().toLowerCase() === p.name.trim().toLowerCase());
    if (!g) return null;
    next = rowsToPositions(g.dates.find(d => d.date === st.date)?.rows || [], st.mapping, parseOpts()).filter(usable).map(r => r.pos);
  }
  return checkHoldings(p.positions, next, { p, prevDate: p.source?.shown || p.valDate || '', nextDate: D ? st.date : st.asOf, complete: !!D || st.mode === 'replace' });
}

// What a dated file contains and where each portfolio in it will go.
function datedCard(D, p) {
  const byName = name => store.listPortfolios().find(x => x.name.trim().toLowerCase() === name.trim().toLowerCase());
  const targets = D.groups.map(g => {
    const target = g.key ? byName(g.key) : p;
    return `<li><strong>${esc(g.key || p.name)}</strong> <span class="muted small">· ${esc(t('imp.datedDates', { n: g.dates.length }))} · ${esc(target ? t('imp.datedInto', { name: target.name }) : t('imp.datedNew'))}</span></li>`;
  }).join('');
  return card(t('imp.datedTitle'), `
    <p>${esc(t('imp.datedBody', { n: D.dates.length, a: D.dates[0], b: D.dates[D.dates.length - 1], p: D.groups.length }))}</p>
    <div class="toolbar wrap"><label class="inline"><strong>${esc(t('imp.datedPick'))}</strong> ${selectHtml('id="impDate"', [...D.dates].reverse().map(d => [d, d === D.dates[D.dates.length - 1] ? t('imp.datedLatest', { d }) : d]), st.date)}</label></div>
    <ul class="guide-list">${targets}</ul>
    <p class="muted small">${esc(t('imp.datedHelp'))}${D.skipped ? ' ' + esc(t('src.skipped', { n: D.skipped })) : ''}</p>`, { sub: esc(t('imp.datedSub')), cls: 'card-info' });
}

function mandatoryCard(header, results, D, p) {
  const types = [...new Set(results.map(r => r.pos.type))];
  if (!types.length && st.defaultType !== 'auto') types.push(st.defaultType);
  const reqs = mandatoryFields(types);
  const colOf = f => { const c = st.mapping.indexOf(f); return c >= 0 ? String(header[c] ?? t('imp.col', { n: c + 1 })) : null; };
  const missingRows = f => results.filter(r => r.errors.some(e => e.field === f && (e.code === 'required' || e.code.startsWith('one_of')))).length;
  const typeCol = colOf('type');
  const rows = [
    { key: '__date', label: t('imp.asOf'), types: t('imp.allRows'), status: D ? 'col' : 'const', src: D ? String(header[D.dateCol] ?? '') : '', miss: 0 },
    { key: '__pf', label: t('imp.portfolioCol'), types: t('imp.optional'), status: 'info', src: D && D.pfCol >= 0 ? t('imp.pfFromCol', { col: header[D.pfCol], n: D.groups.length }) : t('imp.pfActive', { name: p.name }), miss: 0 },
    { key: 'type', label: t('col.type'), types: t('imp.allRows'), status: typeCol ? 'col' : st.defaultType !== 'auto' ? 'const' : 'auto', src: typeCol || (st.defaultType !== 'auto' ? typeLabel(st.defaultType) : t('imp.autoDetect')), miss: 0 },
    ...reqs.map(r => {
      const fields = r.oneOf || [r.field];
      const col = fields.map(colOf).find(Boolean);
      const cf = fields.find(f => st.constants[f] !== undefined && st.constants[f] !== '');
      return {
        key: fields[0], fields, label: fields.map(fieldName).join(` ${t('imp.or')} `),
        types: r.types.map(x => typeLabel(x)).join(', '),
        status: col ? 'col' : cf ? 'const' : 'missing', src: col || '', miss: missingRows(fields[0])
      };
    })
  ];
  const nMissing = rows.filter(r => r.status === 'missing').length;
  return card(t('imp.mandatory'), `
    <div class="table-wrap"><table class="tbl dense mand">
      <thead><tr><th>${esc(t('imp.datapoint'))}</th><th>${esc(t('imp.requiredFor'))}</th><th>${esc(t('imp.source'))}</th><th>${esc(t('imp.constant'))}</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.status === 'missing' ? 'row-error' : ''}">
        <td><strong>${esc(r.label)}</strong></td>
        <td class="small muted">${esc(r.types)}</td>
        <td>${r.status === 'col' ? `<span class="chip chip-ok">✓ ${esc(t('imp.fromColumn'))}</span> <span class="small">${esc(r.src)}</span>${r.miss ? `<div class="small warn-text">${esc(t('imp.rowsEmpty', { n: r.miss }))}</div>` : ''}`
          : r.status === 'const' ? `<span class="chip chip-ok">✓ ${esc(t('imp.fromConstant'))}</span>`
          : r.status === 'auto' ? `<span class="chip chip-warn">${esc(t('imp.autoDetect'))}</span>`
          : r.status === 'info' ? `<span class="small">${esc(r.src)}</span>`
          : `<span class="chip chip-breach">✕ ${esc(t('imp.missing'))}</span>`}</td>
        <td>${r.key === '__date' ? (D ? `<span class="muted small">—</span>` : `<input type="date" id="asOf" required value="${esc(st.asOf)}" aria-label="${esc(t('imp.asOf'))}">`) : r.key === '__pf' ? '' : r.key === 'type' ? selectHtml('id="typeSel2" aria-label="' + esc(t('col.type')) + '"', [['auto', t('imp.autoDetect')], ...Object.keys(INSTRUMENTS).map(k => [k, typeLabel(k)])], st.defaultType) : constantInput(r.key, st.constants[r.key])}</td>
      </tr>`).join('')}</tbody>
    </table></div>`, {
    sub: esc(nMissing ? t('imp.mandatorySubMissing', { n: nMissing }) : t('imp.mandatorySubOk')),
    cls: nMissing ? 'card-alert' : ''
  });
}

function typeMapCard(body) {
  const vals = typeValues(body, st.mapping);
  if (!vals.length) return '';
  const opts = [['', ''], ...Object.keys(INSTRUMENTS).map(k => [k, typeLabel(k)]), ['__skip', t('imp.skipRows')]];
  return card(t('imp.typeMap'), `<div class="map-grid">${vals.slice(0, 60).map(v => {
    const o = opts.map(([k, l]) => (k === '' ? ['', `${t('imp.auto')}: ${v.auto ? typeLabel(v.auto) : '?'}`] : [k, l]));
    const sug = !v.auto && !st.typeMap[v.value] && models ? suggestType(models.types, v.value) : null;
    return `<div class="map-row ${st.typeMap[v.value] || v.auto ? 'mapped' : sug ? 'suggested' : 'unmapped'}">
      <div><div class="map-head">${esc(v.value)}</div><div class="map-sample">${esc(t('imp.nRows', { n: v.count }))}</div></div>
      <div class="map-ctl">${selectHtml(`data-typemap="${esc(v.value)}" aria-label="${esc(v.value)}"`, o, st.typeMap[v.value] || '')}${sug ? `<button class="chip chip-suggest" data-sugtype="${esc(v.value)}" data-type="${esc(sug.type)}" title="${esc(t('imp.useSuggestion'))}">${esc(t('imp.suggested', { f: typeLabel(sug.type), p: fmtPct(sug.p, 0) }))}</button>` : ''}</div>
    </div>`;
  }).join('')}</div>`, { sub: esc(t('imp.typeMapSub')) });
}

function templatesList() {
  const list = store.templates();
  return `
    <h3 class="h3">${esc(t('imp.myTemplates'))}</h3>
    ${list.length ? `<ul class="tpl-list">${list.map(x => `<li>
        <div><strong>${esc(x.name)}</strong><div class="small muted">${esc(t('imp.tplInfo', { n: Object.keys(x.mapping || {}).length, c: Object.keys(x.constants || {}).length }))}</div></div>
        <div class="row-actions">
          ${st.parsed ? `<button class="btn btn-sm" data-tplapply="${esc(x.id)}">${esc(t('imp.apply'))}</button>` : ''}
          <button class="icon-btn sm" data-tpldl="${esc(x.id)}" title="${esc(t('imp.download'))}" aria-label="${esc(t('imp.download'))}">⤓</button>
          <button class="icon-btn sm" data-tpldel="${esc(x.id)}" title="${esc(t('common.delete'))}" aria-label="${esc(t('common.delete'))}">✕</button>
        </div></li>`).join('')}</ul>` : `<p class="muted small">${esc(t('imp.noTemplates'))}</p>`}
    <div class="btn-row">
      <button class="btn btn-sm" data-act="tplupload">${esc(t('imp.uploadTemplate'))}</button>
      <input type="file" id="tplFile" accept=".json,application/json" hidden>
    </div>`;
}

function saveTemplateDialog(header) {
  const cur = store.templates().find(x => x.id === st.templateId);
  const m = openModal(`<div class="modal-head"><h2>${esc(t('imp.saveTemplate'))}</h2></div>
    <form class="modal-body form-stack" id="tplForm">
      <label><span>${esc(t('imp.tplName'))}</span><input name="name" required value="${esc(cur ? cur.name : (st.name || '').replace(/\.[a-z0-9]+$/i, ''))}"></label>
      ${cur ? `<label class="inline"><input type="checkbox" name="overwrite" checked> ${esc(t('imp.tplOverwrite', { name: cur.name }))}</label>` : ''}
      <p class="muted small">${esc(t('imp.tplSaveHelp'))}</p>
    </form>
    <div class="modal-foot"><button class="btn" data-close>${esc(t('common.cancel'))}</button><button class="btn btn-primary" form="tplForm" type="submit">${esc(t('common.save'))}</button></div>`);
  m.querySelector('#tplForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const tpl = buildTemplate({
      id: cur && f.get('overwrite') ? cur.id : null, name: f.get('name'), header, mapping: st.mapping, headerRow: st.headerRow,
      sheet: st.parsed.sheets[st.sheet]?.name || '', decimal: st.decimal, dateFormat: st.dateFormat, transforms: st.transforms,
      constants: st.constants, typeMap: st.typeMap, skipPattern: st.skipPattern, defaultType: st.defaultType, mode: st.mode
    });
    st.templateId = tpl.id;
    st.autoApplied = '';
    closeModal();
    store.saveTemplate(tpl);
    toast(t('imp.tplSaved', { name: tpl.name }));
  });
}

export default {
  render(root, app) {
    const p = store.active();
    const hasFile = !!st.parsed;
    const D = hasFile ? datedInfo() : null;
    if (D) {
      if (!D.dates.includes(st.date)) st.date = D.dates[D.dates.length - 1];
      st.mapping[D.dateCol] = '';
      if (D.pfCol >= 0) st.mapping[D.pfCol] = '';
    }
    if (!st.asOf) st.asOf = p.valDate || todayISO();
    const { header, body: allRows } = currentRows();
    // A dated file previews and imports one date; the others become history.
    const body = D ? D.groups.flatMap(g => g.dates.find(d => d.date === st.date)?.rows || []) : allRows;
    const results = hasFile ? rowsToPositions(body, st.mapping, parseOpts()) : [];
    const skipped = hasFile ? body.length - results.length : 0;
    const valid = results.filter(usable);
    const checks = hasFile ? importChecks(p, D, valid) : null;
    const invalid = results.length - valid.length;
    const mappedCount = st.mapping.filter(Boolean).length;
    if (hasFile && !models) loadModels().then(m => { if (m && !models) { models = m; if (st.parsed && app.route() === 'import') app.rerender(); } });
    const colSug = hasFile && models ? suggestColumns(models.columns, header, body, st.mapping, { skipCols: [...st.ignored, ...(D ? [D.dateCol, D.pfCol] : [])] }) : [];
    const sugOf = c => colSug.find(x => x.col === c);
    lastSuggestions = colSug;
    const fieldOpts = [['', t('imp.ignore')], ...allFieldKeys().map(k => [k, fieldName(k)])];
    const tplOpts = [['', t('imp.noTemplate')], ...store.templates().map(x => [x.id, x.name])];
    const dateOpts = DATE_FORMATS.map(f => [f, t('imp.date.' + f)]);

    root.innerHTML = `
      ${pageHead(t('nav.import'), esc(t('imp.sub')))}
      ${sourceCardHtml()}
      <div class="grid-2 import-top">
        ${card(t('imp.step1'), `
          ${privacyCallout(t('imp.privacy'))}
          <div class="drop" id="drop" tabindex="0" role="button" aria-label="${esc(t('imp.drop'))}">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v4h16v-4"/></svg>
            <p><strong>${esc(t('imp.drop'))}</strong></p><p class="muted small">${esc(t('imp.formats'))}</p>
            <input type="file" id="file" accept="${ACCEPT}" hidden>
          </div>
          <details class="paste"><summary>${esc(t('imp.paste'))}</summary>
            <textarea id="pasteBox" rows="6" placeholder="${esc(t('imp.pastePh'))}"></textarea>
            <button class="btn btn-sm" data-act="paste">${esc(t('imp.parsePaste'))}</button>
          </details>
          ${hasFile ? `<p class="file-line">📄 <strong>${esc(st.name)}</strong> · ${esc(st.parsed.kind.toUpperCase())} · ${fmtNum(body.length)} ${esc(t('imp.rows'))} <button class="linkish" data-act="reset">${esc(t('imp.clear'))}</button></p>` : ''}
        `)}
        ${card(t('imp.templates'), `
          <p class="muted small">${esc(t('imp.templatesBody'))}</p>
          <div class="btn-row">
            <button class="btn btn-sm" data-act="tplxlsx">${esc(t('imp.tplXlsx'))}</button>
            <button class="btn btn-sm" data-act="tplcsv">${esc(t('imp.tplCsv'))}</button>
          </div>
          <div class="inline-form">
            ${selectHtml('id="tplType" aria-label="' + esc(t('col.type')) + '"', Object.keys(INSTRUMENTS).map(k => [k, typeLabel(k)]), 'equity')}
            <button class="btn btn-sm" data-act="tpltype">${esc(t('imp.tplType'))}</button>
          </div>
          <hr class="sep">
          ${templatesList()}
        `)}
      </div>
      ${hasFile ? `
      ${st.autoApplied ? `<div class="alert alert-info"><span>${esc(t('imp.autoApplied', { name: st.autoApplied }))}</span></div>` : ''}
      ${card(t('imp.step2'), `
        <div class="tpl-bar">
          <label class="inline"><strong>${esc(t('imp.template'))}</strong> ${selectHtml('id="tplSel"', tplOpts, st.templateId)}</label>
          <button class="btn btn-sm btn-primary" data-act="tplsave">${esc(st.templateId ? t('imp.saveTemplateChanges') : t('imp.saveTemplate'))}</button>
          <span class="muted small">${esc(t('imp.templateHelp'))}</span>
        </div>
        <div class="toolbar wrap">
          ${st.parsed.sheets.length > 1 ? `<label class="inline">${esc(t('imp.sheet'))} ${selectHtml('id="sheetSel"', st.parsed.sheets.map((s, i) => [i, s.name]), st.sheet)}</label>` : ''}
          <label class="inline">${esc(t('imp.headerRow'))} ${selectHtml('id="hdrSel"', (st.parsed.sheets[st.sheet].rows.slice(0, 20)).map((_, i) => [i, String(i + 1)]), st.headerRow)}</label>
          <label class="inline">${esc(t('imp.decimal'))} ${selectHtml('id="decSel"', [['.', '1,234.56'], [',', '1 234,56']], st.decimal)}</label>
          <label class="inline">${esc(t('imp.dateFormat'))} ${selectHtml('id="dateSel"', dateOpts, st.dateFormat)}</label>
          <label class="inline">${esc(t('imp.skipIf'))} <input id="skipIn" value="${esc(st.skipPattern)}" placeholder="${esc(t('imp.skipPh'))}" class="w-160"></label>
        </div>
        <p class="muted small">${esc(t('imp.mapHelp', { n: mappedCount, total: header.length }))}</p>
        ${colSug.length ? `<div class="alert alert-info suggest-bar"><span>${esc(t('imp.suggestHelp', { n: colSug.length }))}</span><button class="btn btn-sm" data-act="sugall">${esc(t('imp.useAll', { n: colSug.length }))}</button></div>` : ''}
        <div class="map-grid">${header.map((h, c) => {
          const f = st.mapping[c];
          const spec = f && FIELDS[f];
          const tr = (f && st.transforms[f]) || {};
          const extra = spec?.type === 'number' ? selectHtml(`data-scale="${f}" class="scale-sel" title="${esc(t('imp.scale'))}" aria-label="${esc(t('imp.scale'))}"`, SCALES.map(([v, l]) => [v, l]), tr.scale ?? 1)
            : spec?.type === 'date' ? selectHtml(`data-datefmt="${f}" class="scale-sel" title="${esc(t('imp.dateFormat'))}" aria-label="${esc(t('imp.dateFormat'))}"`, [['', t('imp.date.inherit')], ...dateOpts], tr.dateFormat || '') : '';
          const sug = !f && sugOf(c);
          return `<div class="map-row ${f ? 'mapped' : sug ? 'suggested' : ''}">
            <div><div class="map-head">${esc(String(h ?? '') || t('imp.col', { n: c + 1 }))}</div><div class="map-sample">${esc(body.slice(0, 3).map(r => r[c] instanceof Date ? r[c].toISOString().slice(0, 10) : String(r[c] ?? '')).filter(Boolean).join(' · ').slice(0, 60))}</div></div>
            <div class="map-ctl">${selectHtml(`data-map="${c}" aria-label="${esc(String(h))}"`, fieldOpts, f || '')}${extra}${sug ? `<button class="chip chip-suggest" data-sugcol="${c}" data-field="${esc(sug.field)}" title="${esc(t('imp.useSuggestion'))}">${esc(t('imp.suggested', { f: fieldName(sug.field), p: fmtPct(sug.p, 0) }))}</button>` : ''}</div>
          </div>`;
        }).join('')}</div>
      `)}
      ${D ? datedCard(D, p) : ''}
      <div class="grid-2">
        ${mandatoryCard(header, results, D, p)}
        ${typeMapCard(body) || card(t('imp.typeMap'), `<p class="muted small">${esc(t('imp.typeMapNone'))}</p>`)}
      </div>
      ${checks ? dataChecksCard(checks, { sub: t('dc.subImport', { name: p.name }) }) : ''}
      ${card(t('imp.step3'), `
        <div class="import-summary">
          <div class="stat"><span class="big pos">${fmtNum(valid.length)}</span><span>${esc(t('imp.valid'))}</span></div>
          <div class="stat"><span class="big ${invalid ? 'neg' : ''}">${fmtNum(invalid)}</span><span>${esc(t('imp.invalid'))}</span></div>
          ${skipped ? `<div class="stat"><span class="big muted">${fmtNum(skipped)}</span><span>${esc(t('imp.skipped'))}</span></div>` : ''}
          <div class="stat types">${Object.entries(results.reduce((m, r) => (m[r.pos.type] = (m[r.pos.type] || 0) + 1, m), {})).map(([k, n]) => `<span class="type-pill">${esc(typeLabel(k))} · ${n}</span>`).join('')}</div>
        </div>
        <div class="toolbar wrap">
          <span>${esc(t('imp.mode'))}</span>
          ${segmented('mode', [['append', t('imp.append')], ['update', t('imp.update')], ['replace', t('imp.replace')]], st.mode)}
          <label class="inline"><input type="checkbox" id="onlyErr" ${st.onlyErrors ? 'checked' : ''}> ${esc(t('imp.onlyErrors'))}</label>
          <label class="inline"><input type="checkbox" id="inclInv" ${st.includeInvalid ? 'checked' : ''}> ${esc(t('imp.includeInvalid'))}</label>
        </div>
        <p class="muted small">${esc(t('imp.modeHelp.' + st.mode))}</p>
        ${table([
          { key: 'line', label: '#', fmt: r => String(r.line + st.headerRow + 1) },
          { key: 'type', label: t('col.type'), fmt: r => esc(typeLabel(r.pos.type)) },
          { key: 'name', label: t('col.name'), fmt: r => esc(r.pos.name || r.pos.ticker || r.pos.isin || r.pos.issuer || '—') },
          { key: 'qty', label: t('col.qty'), align: 'right', fmt: r => fmtNum(r.pos.qty ?? r.pos.buyAmount, 2) },
          { key: 'price', label: t('col.price'), align: 'right', fmt: r => r.pos.price != null ? fmtNum(r.pos.price, 4) : '' },
          { key: 'ccy', label: t('col.ccy'), fmt: r => esc(r.pos.ccy || '') },
          { key: 'st', label: t('imp.status'), fmt: r => r.errors.length ? `<span class="${r.errors.some(e => !e.code.startsWith('type_guessed')) ? 'neg' : 'warn-text'}">${r.errors.map(e => esc(errText(e, r.pos.type))).join('<br>')}</span>` : '<span class="pos">✓</span>' }
        ], st.onlyErrors ? results.filter(r => r.errors.length) : results, { dense: true, maxRows: 200 })}
        ${results.length > 200 ? `<p class="muted small">${esc(t('imp.previewCap'))}</p>` : ''}
        <div class="btn-row end">
          <button class="btn btn-primary btn-lg" data-act="import" ${!(st.includeInvalid ? results.length : valid.length) ? 'disabled' : ''}>${D ? esc(t('imp.doImportDated', { n: D.groups.length, k: D.dates.length })) : esc(t('imp.doImport', { n: st.includeInvalid ? results.length : valid.length, pf: p.name }))}</button>
        </div>
      `)}` : ''}
    `;

    const drop = root.querySelector('#drop');
    const fileIn = root.querySelector('#file');
    const handle = async file => {
      try {
        setParsed(file.name, await readFile(file, loadScript));
        app.rerender();
      } catch (e) { console.error(e); toast(t('imp.readError'), { tone: 'warn' }); }
    };
    drop.onclick = () => fileIn.click();
    drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } };
    fileIn.onchange = () => fileIn.files[0] && handle(fileIn.files[0]);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) handle(f); };

    const on = (sel, ev, fn) => root.querySelector(sel)?.addEventListener(ev, fn);
    const touched = () => { st.autoApplied = ''; app.rerender(); };
    on('#sheetSel', 'change', e => { st.sheet = +e.target.value; const rows = st.parsed.sheets[st.sheet].rows; st.headerRow = findHeaderRow(rows); st.mapping = autoMapping(currentRows().header); touched(); });
    on('#hdrSel', 'change', e => { st.headerRow = +e.target.value; const tpl = store.templates().find(x => x.id === st.templateId); st.mapping = tpl ? applyTemplateMapping(tpl, currentRows().header) : autoMapping(currentRows().header); touched(); });
    on('#decSel', 'change', e => { st.decimal = e.target.value; touched(); });
    on('#dateSel', 'change', e => { st.dateFormat = e.target.value; touched(); });
    on('#skipIn', 'change', e => { st.skipPattern = e.target.value; touched(); });
    on('#typeSel2', 'change', e => { st.defaultType = e.target.value; touched(); });
    on('#impDate', 'change', e => { st.date = e.target.value; app.rerender(); });
    on('#asOf', 'change', e => { st.asOf = e.target.value || todayISO(); app.rerender(); });
    on('#onlyErr', 'change', e => { st.onlyErrors = e.target.checked; app.rerender(); });
    on('#inclInv', 'change', e => { st.includeInvalid = e.target.checked; app.rerender(); });
    on('#tplSel', 'change', e => {
      const tpl = store.templates().find(x => x.id === e.target.value);
      if (tpl) applyTemplate(tpl);
      else { st.templateId = ''; st.mapping = autoMapping(currentRows().header); st.transforms = {}; st.constants = {}; st.typeMap = {}; st.skipPattern = ''; }
      touched();
    });
    root.querySelectorAll('[data-map]').forEach(s => s.addEventListener('change', e => {
      const c = +e.target.dataset.map, f = e.target.value;
      // A field can only come from one column.
      if (f) st.mapping = st.mapping.map((x, i) => (x === f && i !== c ? '' : x));
      st.mapping[c] = f;
      // A column set to "ignore" by hand is not suggested again.
      st.ignored = f ? st.ignored.filter(i => i !== c) : [...new Set([...st.ignored, c])];
      touched();
    }));
    root.querySelectorAll('[data-scale]').forEach(s => s.addEventListener('change', e => { const f = e.target.dataset.scale; st.transforms[f] = { ...(st.transforms[f] || {}), scale: +e.target.value }; touched(); }));
    root.querySelectorAll('[data-datefmt]').forEach(s => s.addEventListener('change', e => { const f = e.target.dataset.datefmt; st.transforms[f] = { ...(st.transforms[f] || {}), dateFormat: e.target.value || undefined }; touched(); }));
    root.querySelectorAll('[data-const]').forEach(s => s.addEventListener('change', e => {
      const f = e.target.dataset.const;
      const v = FIELDS[f]?.type === 'ccy' ? e.target.value.trim().toUpperCase() : e.target.value.trim();
      if (v === '') delete st.constants[f]; else st.constants[f] = v;
      touched();
    }));
    root.querySelectorAll('[data-typemap]').forEach(s => s.addEventListener('change', e => {
      const k = e.target.dataset.typemap;
      if (e.target.value) st.typeMap[k] = e.target.value; else delete st.typeMap[k];
      touched();
    }));
    on('#tplFile', 'change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        const list = Array.isArray(obj) ? obj : obj.templates && Array.isArray(obj.templates) ? obj.templates : [obj];
        const clean = list.map(validateTemplate);
        clean.forEach(x => store.saveTemplate(x));
        if (st.parsed && clean.length === 1) { applyTemplate(clean[0]); app.rerender(); }
        toast(t('imp.tplImported', { n: clean.length }));
      } catch (err) { toast(t('imp.tplInvalid'), { tone: 'warn' }); }
    });

    root.onclick = async e => {
      const sc = e.target.closest('[data-sugcol]');
      if (sc) { const c = +sc.dataset.sugcol, f = sc.dataset.field; st.mapping = st.mapping.map((x, i) => (x === f && i !== c ? '' : x)); st.mapping[c] = f; touched(); return; }
      const stp = e.target.closest('[data-sugtype]');
      if (stp) { st.typeMap[stp.dataset.sugtype] = stp.dataset.type; touched(); return; }
      if (e.target.closest('[data-act="sugall"]')) { for (const x of lastSuggestions) if (!st.mapping.includes(x.field)) st.mapping[x.col] = x.field; touched(); return; }
      const seg = e.target.closest('[data-seg="mode"]');
      if (seg) { st.mode = seg.dataset.value; app.rerender(); return; }
      const apply = e.target.closest('[data-tplapply]')?.dataset.tplapply;
      if (apply) { const tpl = store.templates().find(x => x.id === apply); if (tpl) { applyTemplate(tpl); st.autoApplied = ''; app.rerender(); } return; }
      const dl = e.target.closest('[data-tpldl]')?.dataset.tpldl;
      if (dl) { const tpl = store.templates().find(x => x.id === dl); if (tpl) downloadBlob(JSON.stringify({ app: 'nexus-portfolio-lab', kind: 'import-template', ...tpl }, null, 2), 'application/json', `import-template-${slug(tpl.name)}.json`); return; }
      const del = e.target.closest('[data-tpldel]')?.dataset.tpldel;
      if (del) {
        const tpl = store.templates().find(x => x.id === del);
        if (tpl && await confirmDialog(t('imp.tplDeleteConfirm', { name: esc(tpl.name) }), { danger: true, ok: t('common.delete') })) {
          if (st.templateId === del) st.templateId = '';
          store.deleteTemplate(del);
        }
        return;
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'reset') { reset(); app.rerender(); }
      if (act === 'paste') {
        const txt = root.querySelector('#pasteBox').value;
        if (!txt.trim()) return;
        try { setParsed(t('imp.pasted'), parseText(txt)); app.rerender(); } catch (err) { toast(t('imp.readError'), { tone: 'warn' }); }
      }
      if (act === 'tplupload') root.querySelector('#tplFile').click();
      if (act === 'tplsave') saveTemplateDialog(header);
      if (act === 'tplcsv') downloadBlob('﻿' + templateCSV(), 'text/csv;charset=utf-8', 'holdings-template.csv');
      if (act === 'tpltype') { const ty = root.querySelector('#tplType').value; downloadBlob('﻿' + templateCSV(ty), 'text/csv;charset=utf-8', `template-${ty}.csv`); }
      if (act === 'tplxlsx') xlsxTemplate();
      if (act === 'import' && D) { await importDated(D, p, app); return; }
      if (act === 'import') {
        const chosen = (st.includeInvalid ? results : valid).map(r => r.pos);
        if (st.mode === 'replace' && p.positions.length && !(await confirmDialog(t('imp.replaceConfirm', { n: p.positions.length }), { danger: true, ok: t('imp.replace') }))) return;
        let res;
        // The date is mandatory: the holdings are as of st.asOf, and each import is kept as a snapshot
        // of that date so Changes & track record builds up without a connected file.
        const asOf = st.asOf || todayISO();
        store.update(pp => {
          res = mergePositions(pp.positions, chosen, st.mode); pp.positions = res.positions;
          pp.valDate = asOf === todayISO() ? '' : asOf;
          const list = (Array.isArray(pp.snapshots) ? pp.snapshots : []).filter(s => s.date !== asOf);
          list.push({ date: asOf, positions: JSON.parse(JSON.stringify(pp.positions)), savedAt: new Date().toISOString() });
          pp.snapshots = list.sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_SAVED);
        }, t('nav.import'));
        toast(t('imp.done', { added: res.added, updated: res.updated }), { action: () => store.undo(), actionLabel: t('common.undo') });
        const keepMode = st.mode;
        reset(); st.mode = keepMode;
        app.navigate('holdings');
      }
    };
    return bindSourceCard(root);
  }
};

// Import a dated file: per portfolio in the file, the holdings of the chosen date (or its latest
// before it) go into that portfolio by the chosen mode; every date is kept as a snapshot and the
// prices across dates join the price history. Portfolios not in the workspace are created.
async function importDated(D, p, app) {
  const opts = parseOpts();
  const keep = r => st.includeInvalid || !r.errors.some(e => !e.code.startsWith('type_guessed'));
  const holdings = rows => rowsToPositions(rows, st.mapping, opts).filter(keep).map(r => r.pos);
  const byName = name => store.listPortfolios().find(x => x.name.trim().toLowerCase() === name.trim().toLowerCase());
  const plan = D.groups.map(g => ({ g, target: g.key ? byName(g.key) : p }));
  const replacing = plan.filter(x => x.target?.positions.length).length;
  if (st.mode === 'replace' && replacing && !(await confirmDialog(t('imp.replaceConfirmMany', { n: replacing }), { danger: true, ok: t('imp.replace') }))) return;
  let added = 0, updated = 0, created = 0, first = null;
  const now = new Date().toISOString();
  for (const { g, target } of plan) {
    let pf = target;
    if (!pf) {
      pf = store.newPortfolio({ name: g.key, baseCcy: p.baseCcy, manager: p.manager, fundType: p.fundType, fxEur: p.fxEur, fxSource: p.fxSource, fxDate: p.fxDate });
      store.upsertPortfolio(pf);
      created++;
    }
    first ||= pf.id;
    const use = [...g.dates].reverse().find(d => d.date <= st.date) || g.dates[0];
    const chosen = holdings(use.rows);
    const hist = snapshotHistory(g, st.mapping, opts);
    store.mutatePortfolio(pf.id, pp => {
      const res = mergePositions(pp.positions, chosen, st.mode);
      pp.positions = res.positions; added += res.added; updated += res.updated;
      pp.valDate = use.date;
      const list = (Array.isArray(pp.snapshots) ? pp.snapshots : []).filter(s => !g.dates.some(d => d.date === s.date));
      g.dates.forEach(d => list.push({ date: d.date, positions: d === use ? JSON.parse(JSON.stringify(pp.positions)) : holdings(d.rows), savedAt: now }));
      pp.snapshots = list.sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_SAVED);
      if (hist) pp.history = mergeHistory(pp.history, hist);
    });
  }
  // The empty placeholder the welcome page creates is not needed when the file names its portfolios.
  if (!plan.some(x => x.target === p) && !p.positions.length && !(p.snapshots || []).length) store.deletePortfolio(p.id);
  toast(t('imp.doneDated', { p: plan.length, c: created, d: D.dates.length, added, updated }), { ms: 6000 });
  const keepMode = st.mode;
  reset(); st.mode = keepMode;
  if (first) store.setActive(first);
  app.navigate(D.dates.length > 1 ? 'changes' : 'holdings');
}

async function xlsxTemplate() {
  try {
    await loadScript(XLSX_URL);
  } catch (e) { toast(t('err.lib'), { tone: 'warn' }); return; }
  const XLSX = window.XLSX;
  const cols = templateColumns();
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([cols, ...TEMPLATE_EXAMPLES.map(e => cols.map(c => e[c] ?? ''))]);
  ws['!cols'] = cols.map(c => ({ wch: Math.max(10, c.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Holdings');
  // Instruction sheet: one row per field, which types use it, which require it.
  const info = [[t('imp.x.field'), t('imp.x.label'), t('imp.x.format'), t('imp.x.required'), t('imp.x.optional')]];
  for (const k of cols) {
    if (k === 'type') { info.push(['type', FIELDS.type.en, Object.keys(INSTRUMENTS).join(', '), t('imp.x.all'), '']); continue; }
    const f = FIELDS[k];
    const req = Object.entries(INSTRUMENTS).filter(([, d]) => d.required.includes(k)).map(([id]) => id);
    const opt = Object.entries(INSTRUMENTS).filter(([, d]) => d.fields.includes(k) && !d.required.includes(k)).map(([id]) => id);
    info.push([k, f.en, f.options ? f.options.join(' | ') : t('imp.x.fmt.' + f.type), req.join(', '), opt.join(', ')]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(info);
  ws2['!cols'] = [{ wch: 16 }, { wch: 26 }, { wch: 40 }, { wch: 50 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Instructions');
  const types = [[t('col.type'), 'id', t('imp.x.required'), t('imp.x.hint')], ...Object.entries(INSTRUMENTS).map(([id, d]) => [L(d), id, d.required.join(', '), L(d.hint)])];
  const ws3 = XLSX.utils.aoa_to_sheet(types);
  ws3['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 50 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Instrument types');
  XLSX.writeFile(wb, 'holdings-template.xlsx');
}
