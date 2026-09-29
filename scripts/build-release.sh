#!/usr/bin/env bash
# Build the release files in dist/:
#   nexus-portfolio-lab-<version>.zip          the site exactly as published (libraries from their CDNs)
#   nexus-portfolio-lab-<version>-offline.zip  the same site with every library bundled in vendor/ and the
#                                              web fonts dropped, so it makes no outbound request at all
#   SHA256SUMS.txt, RELEASE_NOTES.md
# Usage: scripts/build-release.sh v1.2.3 [--no-download]
# --no-download fills vendor/ with placeholders to test the packaging without network (never publish that).
set -euo pipefail
VERSION="${1:?usage: build-release.sh <version> [--no-download]}"
NO_DL="${2:-}"
cd "$(dirname "$0")/.."
OUT=dist
NAME="nexus-portfolio-lab-${VERSION}"
rm -rf "$OUT" && mkdir -p "$OUT/site"

# ---- the site as published -------------------------------------------------------------------------
git archive HEAD | tar -x -C "$OUT/site"
(cd "$OUT/site" && rm -rf tests scripts .github src package.json package-lock.json tailwind.config.js .gitignore)
cp tailwind.css "$OUT/site/tailwind.css"            # freshly built by `npm run build`
if [ -f data/market.json ]; then mkdir -p "$OUT/site/data" && cp data/market.json "$OUT/site/data/"; fi
(cd "$OUT/site" && zip -qrX "../${NAME}.zip" .)

# ---- offline variant ---------------------------------------------------------------------------------
cp -r "$OUT/site" "$OUT/offline" && mkdir -p "$OUT/offline/vendor"
PLOTLY=$(grep -oE 'https://cdn.jsdelivr.net/npm/plotly[^"]+' index.html | head -1)
PLOTLY_SRI=$(grep -oE 'integrity="sha384-[^"]+"' index.html | head -1 | sed -E 's/integrity="(.*)"/\1/')
JSPDF=$(sed -nE "s/^export const JSPDF_URL = '([^']+)';/\1/p" js/report.js)
JSPDF_SRI=$(sed -nE "s/^export const JSPDF_SRI = '([^']+)';/\1/p" js/report.js)
AUTOTABLE=$(sed -nE "s/^export const AUTOTABLE_URL = '([^']+)';/\1/p" js/report.js)
AUTOTABLE_SRI=$(sed -nE "s/^export const AUTOTABLE_SRI = '([^']+)';/\1/p" js/report.js)
XLSX=$(sed -nE "s/^export const XLSX_URL = '([^']+)';/\1/p" js/importer.js)
for v in PLOTLY PLOTLY_SRI JSPDF JSPDF_SRI AUTOTABLE AUTOTABLE_SRI XLSX; do [ -n "${!v}" ] || { echo "could not find $v in the source" >&2; exit 1; }; done

sri() { echo "sha384-$(openssl dgst -sha384 -binary "$1" | openssl base64 -A)"; }
fetch() { # url file expected-sri(optional)
  local f="$OUT/offline/vendor/$2"
  if [ "$NO_DL" = "--no-download" ]; then echo "/* placeholder: $1 */" > "$f"; return; fi
  curl -fsSL --retry 4 --retry-delay 2 "$1" -o "$f"
  if [ -n "${3:-}" ] && [ "$(sri "$f")" != "$3" ]; then echo "integrity mismatch for $1" >&2; exit 1; fi
}
fetch "$PLOTLY" plotly.min.js "$PLOTLY_SRI"
fetch "$JSPDF" jspdf.umd.min.js "$JSPDF_SRI"
fetch "$AUTOTABLE" jspdf.plugin.autotable.min.js "$AUTOTABLE_SRI"
fetch "$XLSX" xlsx.full.min.js ""

# Point the code at the bundled copies and drop the Google Fonts links (the system font is used).
for h in index.html options-lab.html; do
  sed -i -E "s#${PLOTLY}#vendor/plotly.min.js#; /fonts\.(googleapis|gstatic)\.com/d" "$OUT/offline/$h"
done
sed -i -E "s#${JSPDF}#vendor/jspdf.umd.min.js#; s#${AUTOTABLE}#vendor/jspdf.plugin.autotable.min.js#" "$OUT/offline/js/report.js"
sed -i -E "s#${XLSX}#vendor/xlsx.full.min.js#" "$OUT/offline/js/importer.js"
# Nothing may still point outside (links to the repository and the ECB page are plain <a> links).
if grep -rnE "https://(cdn\.|fonts\.|unpkg|cdnjs)" "$OUT/offline" --include=*.html --include=*.js --exclude-dir=vendor; then echo "offline build still references a CDN" >&2; exit 1; fi
(cd "$OUT/offline" && zip -qrX "../${NAME}-offline.zip" .)

# ---- checksums and notes ---------------------------------------------------------------------------
(cd "$OUT" && sha256sum "${NAME}.zip" "${NAME}-offline.zip" > SHA256SUMS.txt)
cat > "$OUT/RELEASE_NOTES.md" <<EOF
Nexus Portfolio Lab ${VERSION}

- \`${NAME}.zip\` — the site as published, loading its libraries from their CDNs.
- \`${NAME}-offline.zip\` — the same site with Plotly, SheetJS and jsPDF bundled in \`vendor/\` and no web fonts: it makes no outbound requests. Unzip it onto an internal web server (ES modules do not load from a file:// path).

Both files were built by GitHub Actions from the tagged source and carry a signed build provenance attestation. To check that a file is exactly what this repository built:

\`\`\`
gh attestation verify ${NAME}-offline.zip --repo AntonAlin/options-lab
sha256sum -c SHA256SUMS.txt
\`\`\`

Library integrity: Plotly and jsPDF were checked against the SRI hashes in the source before bundling.
EOF
ls -l "$OUT"
