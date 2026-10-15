// Issuer register files: the rows of an Issuer;LEI CSV. Pure, so the tests run it under Node; the
// register itself lives in store.js and its page in views/issuers-card.js.
import { normKey } from './instruments.js';
import { parseText } from './importer.js';

// Rows of an Issuer;LEI file: the header names the columns (Issuer / Name / Emittent, LEI); without
// one, the first column is the issuer and the second the LEI.
export function parseIssuerCsv(text) {
  const rows = parseText(text, 'issuers.csv').sheets[0].rows;
  if (!rows.length) return [];
  const h = rows[0].map(x => normKey(x));
  let ci = h.findIndex(x => ['issuer', 'issuername', 'name', 'emittent', 'utgivare', 'counterparty', 'motpart', 'company', 'bolag'].includes(x));
  let cl = h.findIndex(x => ['lei', 'issuerlei', 'leicode', 'legalentityidentifier'].includes(x));
  const hasHeader = ci >= 0 || cl >= 0;
  if (ci < 0) ci = 0;
  if (cl < 0) cl = ci === 0 ? 1 : 0;
  return rows.slice(hasHeader ? 1 : 0).map(r => ({ name: String(r[ci] ?? '').trim(), lei: String(r[cl] ?? '').replace(/\s/g, '').toUpperCase() })).filter(x => x.name);
}
