// CycloneDX 1.6 SBOM for a release: every third-party component the site loads, read from the same
// pinned URLs and SRI hashes the code uses, so the SBOM cannot drift from what actually ships.
//   node scripts/sbom.mjs <version> > dist/nexus-portfolio-lab-<version>.cdx.json
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const root = new URL('..', import.meta.url);
const read = f => readFileSync(new URL(f, root), 'utf8');
const version = process.argv[2];
if (!version) { console.error('usage: sbom.mjs <version>'); process.exit(2); }

// The licences are not in the URLs; check them when a library is upgraded.
const LICENSES = { 'plotly.js-dist-min': 'MIT', jspdf: 'MIT', 'jspdf-autotable': 'MIT', xlsx: 'Apache-2.0' };
const USE = { 'plotly.js-dist-min': 'Charts', jspdf: 'PDF report (on demand)', 'jspdf-autotable': 'PDF report tables (on demand)', xlsx: 'Excel import and export (on demand)' };

const html = read('index.html'), report = read('js/report.js'), importer = read('js/importer.js');
const pick = (src, re, i = 1) => { const m = src.match(re); if (!m) { console.error('not found: ' + re); process.exit(1); } return m[i]; };
const PLOTLY = /src="(https:\/\/cdn\.jsdelivr\.net\/npm\/plotly[^"]+)" integrity="(sha384-[^"]+)"/;
const libs = [
  { url: pick(html, PLOTLY), sri: pick(html, PLOTLY, 2) },
  { url: pick(report, /JSPDF_URL = '([^']+)'/), sri: pick(report, /JSPDF_SRI = '([^']+)'/) },
  { url: pick(report, /AUTOTABLE_URL = '([^']+)'/), sri: pick(report, /AUTOTABLE_SRI = '([^']+)'/) },
  { url: pick(importer, /XLSX_URL = '([^']+)'/), sri: pick(importer, /XLSX_SRI = '([^']+)'/) }
];

const components = libs.map(({ url, sri }) => {
  const m = url.match(/\/npm\/((?:@[^/]+\/)?[^@/]+)@([^/]+)\//) || url.match(/\/(xlsx)-([\d.]+)\//);
  if (!m) { console.error('cannot read name and version from ' + url); process.exit(1); }
  const [, name, ver] = m;
  return {
    type: 'library', 'bom-ref': `pkg:npm/${name}@${ver}`, name, version: ver, purl: `pkg:npm/${name}@${ver}`,
    description: USE[name] || '',
    licenses: LICENSES[name] ? [{ license: { id: LICENSES[name] } }] : [],
    hashes: [{ alg: 'SHA-384', content: Buffer.from(sri.slice(7), 'base64').toString('hex') }],
    externalReferences: [{ type: 'distribution', url }],
    properties: [{ name: 'nexus:delivery', value: 'CDN with Subresource Integrity in the online zip; bundled in vendor/ in the offline zip' }]
  };
});
if (html.includes('fonts.googleapis.com/css2?family=Inter')) components.push({
  type: 'file', 'bom-ref': 'font:inter', name: 'Inter (web font)', licenses: [{ license: { id: 'OFL-1.1' } }],
  externalReferences: [{ type: 'distribution', url: 'https://fonts.google.com/specimen/Inter' }],
  properties: [{ name: 'nexus:delivery', value: 'Google Fonts, online zip only; not in the offline zip' }]
});

const bom = {
  bomFormat: 'CycloneDX', specVersion: '1.6', serialNumber: 'urn:uuid:' + randomUUID(), version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: { components: [{ type: 'application', name: 'scripts/sbom.mjs' }] },
    component: {
      type: 'application', 'bom-ref': 'nexus-portfolio-lab', name: 'Nexus Portfolio Lab', version,
      externalReferences: [{ type: 'vcs', url: 'https://github.com/AntonAlin/options-lab' }]
    }
  },
  components,
  dependencies: [{ ref: 'nexus-portfolio-lab', dependsOn: components.map(c => c['bom-ref']) }]
};
process.stdout.write(JSON.stringify(bom, null, 2) + '\n');
