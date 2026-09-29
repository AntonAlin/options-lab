import * as store from '../store.js';
import { t, L, lang } from '../i18n.js';
import { esc, card, pageHead, table, toast, selectHtml, segmented, fmtNum, openModal, closeModal, confirmDialog } from '../ui.js';
import { INSTRUMENTS, FIELDS, OPTION_LABELS, allFieldKeys, fieldLabel, typeLabel } from '../instruments.js';
import {
  readFile, parseText, findHeaderRow, autoMapping, rowsToPositions, mergePositions, templateCSV, templateColumns, TEMPLATE_EXAMPLES, XLSX_URL,
  typeValues, mandatoryFields, buildTemplate, applyTemplateMapping, detectTemplate, validateTemplate, DATE_FORMATS
} from '../importer.js';
import { downloadBlob, loadScript, slug } from '../util.js';
import { sourceCardHtml, bindSourceCard } from './source-card.js';

// Import state survives re-renders (language switch etc.) but not a page reload.
const FRESH = () => ({
  name: '', parsed: null, sheet: 0, headerRow: 0, mapping: [], decimal: '.', dateFormat: 'auto', defaultType: 'auto',
  transforms: {}, constants: {}, typeMap: {}, skipPattern: '', templateId: '', autoApplied: '',
  onlyErrors: false, includeInvalid: false
});
const st = { ...FRESH(), mode: 'append' };
function reset() { Object.assign(st, FRESH()); }

const SCALES = [[1, '×1'], [100, '×100'], [0.01, '÷100'], [1000, '×1 000'], [0.001, '÷1 000'], [-1, '×−1']];
const ACCEPT = '.csv,.txt,.tsv,.prn,.dat,.json,.xml,.xlsx,.xlsm,.xls,.ods';

function currentRows() {
  const rows = st.parsed?.sheets[st.sheet]?.rows || [];
  return { header: (rows[st.headerRow] || []).map(h => (h instanceof Date ? h.toISOString().slice(0, 10) : h)), body: rows.slice(st.headerRow + 1) };
}

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
  const f = fieldLabel(type, e.field, lang());
  if (code === 'one_of') return t('val.oneOf', { fields: arg.split('|').map(k => fieldLabel(type, k, lang())).join(' / ') });
  if (code === 'type_guessed') return t('val.typeGuessed', { raw: arg });
  return t('val.' + code, { field: f });
}

const fieldName = f => (FIELDS[f] ? FIELDS[f][lang()] || FIELDS[f].en : f);

// Input for a constant value, shaped by the field type.
function constantInput(field, value) {
  const spec = FIELDS[field];
  const attrs = `data-const="${field}" aria-label="${esc(fieldName(field))}"`;
  if (field === 'type') return selectHtml(attrs, [['', '—'], ...Object.keys(INSTRUMENTS).map(k => [k, typeLabel(k, lang())])], value || '');
  if (spec?.type === 'select') return selectHtml(attrs, [['', '—'], ...(spec.options || []).map(o => [o, L(OPTION_LABELS[o] || { en: o })])], value || '');
  if (spec?.type === 'date') return `<input type="date" ${attrs} value="${esc(value || '')}">`;
  if (spec?.type === 'ccy') return `<input ${attrs} class="upper w-80" maxlength="3" value="${esc(value || '')}" placeholder="SEK">`;
  return `<input ${attrs} value="${esc(value ?? '')}" placeholder="${esc(t('imp.constantPh'))}">`;
}

function mandatoryCard(header, results) {
  const types = [...new Set(results.map(r => r.pos.type))];
  if (!types.length && st.defaultType !== 'auto') types.push(st.defaultType);
  const reqs = mandatoryFields(types);
  const colOf = f => { const c = st.mapping.indexOf(f); return c >= 0 ? String(header[c] ?? t('imp.col', { n: c + 1 })) : null; };
  const missingRows = f => results.filter(r => r.errors.some(e => e.field === f && (e.code === 'required' || e.code.startsWith('one_of')))).length;
  const typeCol = colOf('type');
  const rows = [
    { key: 'type', label: t('col.type'), types: t('imp.allRows'), status: typeCol ? 'col' : st.defaultType !== 'auto' ? 'const' : 'auto', src: typeCol || (st.defaultType !== 'auto' ? typeLabel(st.defaultType, lang()) : t('imp.autoDetect')), miss: 0 },
    ...reqs.map(r => {
      const fields = r.oneOf || [r.field];
      const col = fields.map(colOf).find(Boolean);
      const cf = fields.find(f => st.constants[f] !== undefined && st.constants[f] !== '');
      return {
        key: fields[0], fields, label: fields.map(fieldName).join(` ${t('imp.or')} `),
        types: r.types.map(x => typeLabel(x, lang())).join(', '),
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
          : `<span class="chip chip-breach">✕ ${esc(t('imp.missing'))}</span>`}</td>
        <td>${r.key === 'type' ? selectHtml('id="typeSel2" aria-label="' + esc(t('col.type')) + '"', [['auto', t('imp.autoDetect')], ...Object.keys(INSTRUMENTS).map(k => [k, typeLabel(k, lang())])], st.defaultType) : constantInput(r.key, st.constants[r.key])}</td>
      </tr>`).join('')}</tbody>
    </table></div>`, {
    sub: esc(nMissing ? t('imp.mandatorySubMissing', { n: nMissing }) : t('imp.mandatorySubOk')),
    cls: nMissing ? 'card-alert' : ''
  });
}

function typeMapCard(body) {
  const vals = typeValues(body, st.mapping);
  if (!vals.length) return '';
  const opts = [['', ''], ...Object.keys(INSTRUMENTS).map(k => [k, typeLabel(k, lang())]), ['__skip', t('imp.skipRows')]];
  return card(t('imp.typeMap'), `<div class="map-grid">${vals.slice(0, 60).map(v => {
    const o = opts.map(([k, l]) => (k === '' ? ['', `${t('imp.auto')}: ${v.auto ? typeLabel(v.auto, lang()) : '?'}`] : [k, l]));
    return `<div class="map-row ${st.typeMap[v.value] || v.auto ? 'mapped' : 'unmapped'}">
      <div><div class="map-head">${esc(v.value)}</div><div class="map-sample">${esc(t('imp.nRows', { n: v.count }))}</div></div>
      ${selectHtml(`data-typemap="${esc(v.value)}" aria-label="${esc(v.value)}"`, o, st.typeMap[v.value] || '')}
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
    const { header, body } = currentRows();
    const results = hasFile ? rowsToPositions(body, st.mapping, {
      decimal: st.decimal, defaultType: st.defaultType, constants: st.constants, transforms: st.transforms,
      typeMap: st.typeMap, skipPattern: st.skipPattern, dateFormat: st.dateFormat
    }) : [];
    const skipped = hasFile ? body.length - results.length : 0;
    const valid = results.filter(r => !r.errors.some(e => !e.code.startsWith('type_guessed')));
    const invalid = results.length - valid.length;
    const mappedCount = st.mapping.filter(Boolean).length;
    const fieldOpts = [['', t('imp.ignore')], ...allFieldKeys().map(k => [k, fieldName(k)])];
    const tplOpts = [['', t('imp.noTemplate')], ...store.templates().map(x => [x.id, x.name])];
    const dateOpts = DATE_FORMATS.map(f => [f, t('imp.date.' + f)]);

    root.innerHTML = `
      ${pageHead(t('nav.import'), esc(t('imp.sub')))}
      ${sourceCardHtml()}
      <div class="grid-2 import-top">
        ${card(t('imp.step1'), `
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
            ${selectHtml('id="tplType" aria-label="' + esc(t('col.type')) + '"', Object.keys(INSTRUMENTS).map(k => [k, typeLabel(k, lang())]), 'equity')}
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
        <div class="map-grid">${header.map((h, c) => {
          const f = st.mapping[c];
          const spec = f && FIELDS[f];
          const tr = (f && st.transforms[f]) || {};
          const extra = spec?.type === 'number' ? selectHtml(`data-scale="${f}" class="scale-sel" title="${esc(t('imp.scale'))}" aria-label="${esc(t('imp.scale'))}"`, SCALES.map(([v, l]) => [v, l]), tr.scale ?? 1)
            : spec?.type === 'date' ? selectHtml(`data-datefmt="${f}" class="scale-sel" title="${esc(t('imp.dateFormat'))}" aria-label="${esc(t('imp.dateFormat'))}"`, [['', t('imp.date.inherit')], ...dateOpts], tr.dateFormat || '') : '';
          return `<div class="map-row ${f ? 'mapped' : ''}">
            <div><div class="map-head">${esc(String(h ?? '') || t('imp.col', { n: c + 1 }))}</div><div class="map-sample">${esc(body.slice(0, 3).map(r => r[c] instanceof Date ? r[c].toISOString().slice(0, 10) : String(r[c] ?? '')).filter(Boolean).join(' · ').slice(0, 60))}</div></div>
            <div class="map-ctl">${selectHtml(`data-map="${c}" aria-label="${esc(String(h))}"`, fieldOpts, f || '')}${extra}</div>
          </div>`;
        }).join('')}</div>
      `)}
      <div class="grid-2">
        ${mandatoryCard(header, results)}
        ${typeMapCard(body) || card(t('imp.typeMap'), `<p class="muted small">${esc(t('imp.typeMapNone'))}</p>`)}
      </div>
      ${card(t('imp.step3'), `
        <div class="import-summary">
          <div class="stat"><span class="big pos">${fmtNum(valid.length)}</span><span>${esc(t('imp.valid'))}</span></div>
          <div class="stat"><span class="big ${invalid ? 'neg' : ''}">${fmtNum(invalid)}</span><span>${esc(t('imp.invalid'))}</span></div>
          ${skipped ? `<div class="stat"><span class="big muted">${fmtNum(skipped)}</span><span>${esc(t('imp.skipped'))}</span></div>` : ''}
          <div class="stat types">${Object.entries(results.reduce((m, r) => (m[r.pos.type] = (m[r.pos.type] || 0) + 1, m), {})).map(([k, n]) => `<span class="type-pill">${esc(typeLabel(k, lang()))} · ${n}</span>`).join('')}</div>
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
          { key: 'type', label: t('col.type'), fmt: r => esc(typeLabel(r.pos.type, lang())) },
          { key: 'name', label: t('col.name'), fmt: r => esc(r.pos.name || r.pos.ticker || r.pos.isin || r.pos.issuer || '—') },
          { key: 'qty', label: t('col.qty'), align: 'right', fmt: r => fmtNum(r.pos.qty ?? r.pos.buyAmount, 2) },
          { key: 'price', label: t('col.price'), align: 'right', fmt: r => r.pos.price != null ? fmtNum(r.pos.price, 4) : '' },
          { key: 'ccy', label: t('col.ccy'), fmt: r => esc(r.pos.ccy || '') },
          { key: 'st', label: t('imp.status'), fmt: r => r.errors.length ? `<span class="${r.errors.some(e => !e.code.startsWith('type_guessed')) ? 'neg' : 'warn-text'}">${r.errors.map(e => esc(errText(e, r.pos.type))).join('<br>')}</span>` : '<span class="pos">✓</span>' }
        ], st.onlyErrors ? results.filter(r => r.errors.length) : results, { dense: true, maxRows: 200 })}
        ${results.length > 200 ? `<p class="muted small">${esc(t('imp.previewCap'))}</p>` : ''}
        <div class="btn-row end">
          <button class="btn btn-primary btn-lg" data-act="import" ${!(st.includeInvalid ? results.length : valid.length) ? 'disabled' : ''}>${esc(t('imp.doImport', { n: st.includeInvalid ? results.length : valid.length, pf: p.name }))}</button>
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
      if (act === 'import') {
        const chosen = (st.includeInvalid ? results : valid).map(r => r.pos);
        if (st.mode === 'replace' && p.positions.length && !(await confirmDialog(t('imp.replaceConfirm', { n: p.positions.length }), { danger: true, ok: t('imp.replace') }))) return;
        let res;
        store.update(pp => { res = mergePositions(pp.positions, chosen, st.mode); pp.positions = res.positions; }, t('nav.import'));
        toast(t('imp.done', { added: res.added, updated: res.updated }), { action: () => store.undo(), actionLabel: t('common.undo') });
        const keepMode = st.mode;
        reset(); st.mode = keepMode;
        app.navigate('holdings');
      }
    };
    return bindSourceCard(root);
  }
};

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
  const lg = lang();
  const info = [[t('imp.x.field'), t('imp.x.label'), t('imp.x.format'), t('imp.x.required'), t('imp.x.optional')]];
  for (const k of cols) {
    if (k === 'type') { info.push(['type', FIELDS.type[lg], Object.keys(INSTRUMENTS).join(', '), t('imp.x.all'), '']); continue; }
    const f = FIELDS[k];
    const req = Object.entries(INSTRUMENTS).filter(([, d]) => d.required.includes(k)).map(([id]) => id);
    const opt = Object.entries(INSTRUMENTS).filter(([, d]) => d.fields.includes(k) && !d.required.includes(k)).map(([id]) => id);
    info.push([k, f[lg] || f.en, f.options ? f.options.join(' | ') : t('imp.x.fmt.' + f.type), req.join(', '), opt.join(', ')]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(info);
  ws2['!cols'] = [{ wch: 16 }, { wch: 26 }, { wch: 40 }, { wch: 50 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, ws2, lg === 'sv' ? 'Instruktioner' : 'Instructions');
  const types = [[t('col.type'), 'id', t('imp.x.required'), t('imp.x.hint')], ...Object.entries(INSTRUMENTS).map(([id, d]) => [L(d), id, d.required.join(', '), L(d.hint)])];
  const ws3 = XLSX.utils.aoa_to_sheet(types);
  ws3['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 50 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, ws3, lg === 'sv' ? 'Instrumenttyper' : 'Instrument types');
  XLSX.writeFile(wb, 'holdings-template.xlsx');
}
