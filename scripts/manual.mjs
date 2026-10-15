// Writes the complete manual (js/manual.js) as a text file, e.g. for a release:
//   node scripts/manual.mjs [out.txt] [version]
import { writeFileSync, readFileSync } from 'node:fs';
import { buildManual, MANUAL_FILENAME } from '../js/manual.js';

const out = process.argv[2] || MANUAL_FILENAME;
const version = process.argv[3] || JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
writeFileSync(out, buildManual({ version }));
console.log(`wrote ${out}`);
