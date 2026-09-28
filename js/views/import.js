import * as store from '../store.js';
import { t, L, lang } from '../i18n.js';
import { esc, card, pageHead, table, toast, selectHtml, segmented, fmtNum } from '../ui.js';
import { INSTRUMENTS, FIELDS, allFieldKeys, fieldLabel, typeLabel } from '../instruments.js';
import { readFile, parseText, findHeaderRow, autoMapping, rowsToPositions, mergePositions, templateCSV, templateColumns, TEMPLATE_EXAMPLES, XLSX_URL } from '../importer.js';
import { downloadBlob, loadScript } from '../util.js';

// Import state survives re-renders (language switch etc.) but not a page reload.
const st = { name: '', parsed: null, sheet: 0, headerRow: 0, mapping: [], decimal: '.', defaultType: 'auto', mode: 'append', onlyErrors: false, includeInvalid: false };

function reset() { Object.assign(st, { name: '', parsed: null, sheet: 0, headerRow: 0, mapping: [], decimal: '.', defaultType: 'auto', onlyErrors: false, includeInvalid: false }); }

function currentRows() {
  const rows = st.parsed?.sheets[st.sheet]?.rows || [];
  return { header: rows[st.headerRow] || [], body: rows.slice(st.headerRow + 1) };
}

function setParsed(name, parsed) {
  st.name = name; st.parsed = parsed; st.decimal = parsed.decimal;
  // Pick the first sheet that looks like holdings.
  st.sheet = Math.max(0, parsed.sheets.findIndex(s => s.rows.length > 1));
  st.headerRow = findHeaderRow(parsed.sheets[st.sheet].rows);
  st.mapping = autoMapping(parsed.sheets[st.sheet].rows[st.headerRow] || []);
}

export function errText(e, type) {
  const [code, arg] = e.code.split(':');
  const f = fieldLabel(type, e.field, lang());
  if (code === 'one_of') return t('val.oneOf', { fields: arg.split('|').map(k => fieldLabel(type, k, lang())).join(' / ') });
  if (code === 'type_guessed') return t('val.typeGuessed', { raw: arg });
  return t('val.' + code, { field: f });
}

export default {
  render(root, app) {
    const p = store.active();
    const hasFile = !!st.parsed;
    const { header, body } = currentRows();
    const results = hasFile ? rowsToPositions(body, st.mapping, { decimal: st.decimal, defaultType: st.defaultType }) : [];
    const valid = results.filter(r => !r.errors.some(e => !e.code.startsWith('type_guessed')));
    const invalid = results.length - valid.length;
    const mappedCount = st.mapping.filter(Boolean).length;
    const fieldOpts = [['', t('imp.ignore')], ...allFieldKeys().map(k => [k, FIELDS[k] ? (FIELDS[k][lang()] || FIELDS[k].en) : k])];

    root.innerHTML = `
      ${pageHead(t('nav.import'), esc(t('imp.sub')))}
      <div class="grid-2 import-top">
        ${card(t('imp.step1'), `
          <div class="drop" id="drop" tabindex="0" role="button" aria-label="${esc(t('imp.drop'))}">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v4h16v-4"/></svg>
            <p><strong>${esc(t('imp.drop'))}</strong></p><p class="muted small">${esc(t('imp.formats'))}</p>
            <input type="file" id="file" accept=".csv,.txt,.tsv,.xlsx,.xlsm,.xls,.ods" hidden>
          </div>
          <details class="paste"><summary>${esc(t('imp.paste'))}</summary>
            <textarea id="pasteBox" rows="6" placeholder="${esc(t('imp.pastePh'))}"></textarea>
            <button class="btn btn-sm" data-act="paste">${esc(t('imp.parsePaste'))}</button>
          </details>
          ${hasFile ? `<p class="file-line">📄 <strong>${esc(st.name)}</strong> · ${fmtNum(body.length)} ${esc(t('imp.rows'))} <button class="linkish" data-act="reset">${esc(t('imp.clear'))}</button></p>` : ''}
        `)}
        ${card(t('imp.templates'), `
          <p class="muted">${esc(t('imp.templatesBody'))}</p>
          <div class="btn-row">
            <button class="btn" data-act="tplxlsx">${esc(t('imp.tplXlsx'))}</button>
            <button class="btn" data-act="tplcsv">${esc(t('imp.tplCsv'))}</button>
          </div>
          <div class="inline-form">
            ${selectHtml('id="tplType" aria-label="' + esc(t('col.type')) + '"', Object.keys(INSTRUMENTS).map(k => [k, typeLabel(k, lang())]), 'equity')}
            <button class="btn btn-sm" data-act="tpltype">${esc(t('imp.tplType'))}</button>
          </div>
          <p class="muted small">${esc(t('imp.tips'))}</p>
        `)}
      </div>
      ${hasFile ? card(t('imp.step2'), `
        <div class="toolbar wrap">
          ${st.parsed.sheets.length > 1 ? `<label class="inline">${esc(t('imp.sheet'))} ${selectHtml('id="sheetSel"', st.parsed.sheets.map((s, i) => [i, s.name]), st.sheet)}</label>` : ''}
          <label class="inline">${esc(t('imp.headerRow'))} ${selectHtml('id="hdrSel"', (st.parsed.sheets[st.sheet].rows.slice(0, 15)).map((_, i) => [i, String(i + 1)]), st.headerRow)}</label>
          <label class="inline">${esc(t('imp.decimal'))} ${selectHtml('id="decSel"', [['.', '1,234.56'], [',', '1 234,56']], st.decimal)}</label>
          <label class="inline">${esc(t('imp.defaultType'))} ${selectHtml('id="typeSel"', [['auto', t('imp.autoDetect')], ...Object.keys(INSTRUMENTS).map(k => [k, typeLabel(k, lang())])], st.defaultType)}</label>
        </div>
        <p class="muted small">${esc(t('imp.mapHelp', { n: mappedCount, total: header.length }))}</p>
        <div class="map-grid">${header.map((h, c) => `
          <div class="map-row ${st.mapping[c] ? 'mapped' : ''}">
            <div><div class="map-head">${esc(String(h ?? '') || t('imp.col', { n: c + 1 }))}</div><div class="map-sample">${esc(body.slice(0, 3).map(r => r[c] instanceof Date ? r[c].toISOString().slice(0, 10) : String(r[c] ?? '')).filter(Boolean).join(' · ').slice(0, 60))}</div></div>
            ${selectHtml(`data-map="${c}" aria-label="${esc(String(h))}"`, fieldOpts, st.mapping[c] || '')}
          </div>`).join('')}</div>
        ${!st.mapping.includes('type') && st.defaultType === 'auto' ? `<p class="hint">${esc(t('imp.noTypeCol'))}</p>` : ''}
      `) : ''}
      ${hasFile ? card(t('imp.step3'), `
        <div class="import-summary">
          <div class="stat"><span class="big pos">${fmtNum(valid.length)}</span><span>${esc(t('imp.valid'))}</span></div>
          <div class="stat"><span class="big ${invalid ? 'neg' : ''}">${fmtNum(invalid)}</span><span>${esc(t('imp.invalid'))}</span></div>
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
      `) : ''}
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
    on('#sheetSel', 'change', e => { st.sheet = +e.target.value; const rows = st.parsed.sheets[st.sheet].rows; st.headerRow = findHeaderRow(rows); st.mapping = autoMapping(rows[st.headerRow] || []); app.rerender(); });
    on('#hdrSel', 'change', e => { st.headerRow = +e.target.value; st.mapping = autoMapping(currentRows().header); app.rerender(); });
    on('#decSel', 'change', e => { st.decimal = e.target.value; app.rerender(); });
    on('#typeSel', 'change', e => { st.defaultType = e.target.value; app.rerender(); });
    on('#onlyErr', 'change', e => { st.onlyErrors = e.target.checked; app.rerender(); });
    on('#inclInv', 'change', e => { st.includeInvalid = e.target.checked; app.rerender(); });
    root.querySelectorAll('[data-map]').forEach(s => s.addEventListener('change', e => {
      const c = +e.target.dataset.map, f = e.target.value;
      // A field can only come from one column.
      if (f) st.mapping = st.mapping.map((x, i) => (x === f && i !== c ? '' : x));
      st.mapping[c] = f;
      app.rerender();
    }));

    root.onclick = async e => {
      const seg = e.target.closest('[data-seg="mode"]');
      if (seg) { st.mode = seg.dataset.value; app.rerender(); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'reset') { reset(); app.rerender(); }
      if (act === 'paste') {
        const txt = root.querySelector('#pasteBox').value;
        if (!txt.trim()) return;
        setParsed(t('imp.pasted'), parseText(txt));
        app.rerender();
      }
      if (act === 'tplcsv') downloadBlob('﻿' + templateCSV(), 'text/csv;charset=utf-8', 'holdings-template.csv');
      if (act === 'tpltype') { const ty = root.querySelector('#tplType').value; downloadBlob('﻿' + templateCSV(ty), 'text/csv;charset=utf-8', `template-${ty}.csv`); }
      if (act === 'tplxlsx') xlsxTemplate();
      if (act === 'import') {
        const chosen = (st.includeInvalid ? results : valid).map(r => r.pos);
        if (st.mode === 'replace' && p.positions.length && !confirm(t('imp.replaceConfirm', { n: p.positions.length }))) return;
        let res;
        store.update(pp => { res = mergePositions(pp.positions, chosen, st.mode); pp.positions = res.positions; }, t('nav.import'));
        toast(t('imp.done', { added: res.added, updated: res.updated }), { action: () => store.undo(), actionLabel: t('common.undo') });
        reset();
        app.navigate('holdings');
      }
    };
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
