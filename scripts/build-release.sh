#!/usr/bin/env bash
# Build the release files in dist/:
#   nexus-portfolio-lab-<version>.zip          the site exactly as published (libraries from their CDNs)
#   nexus-portfolio-lab-<version>-offline.zip  the same site with every library bundled in vendor/ and the
#                                              web fonts dropped, so it makes no outbound request at all
#   nexus-portfolio-lab-<version>.cdx.json     CycloneDX SBOM of the third-party components
#   VALIDATION.md                              golden figures and closed-form checks (scripts/golden.mjs)
#   SHA256SUMS.txt, RELEASE_NOTES.md
# Usage: scripts/build-release.sh v1.2.3 [--no-download]
# --no-download fills vendor/ with placeholders to test the packaging without network (never publish that).
set -euo pipefail
VERSION="${1:?usage: build-release.sh <version> [--no-download]}"
NO_DL="${2:-}"
cd "$(dirname "$0")/.."
OUT=dist
NAME="nexus-portfolio-lab-${VERSION}"
rm -rf "$OUT" && mkdir -p "$OUT"

# ---- the site as published -------------------------------------------------------------------------
bash scripts/assemble-site.sh "$OUT/site"
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
XLSX_SRI=$(sed -nE "s/^export const XLSX_SRI = '([^']+)';/\1/p" js/importer.js)
for v in PLOTLY PLOTLY_SRI JSPDF JSPDF_SRI AUTOTABLE AUTOTABLE_SRI XLSX XLSX_SRI; do [ -n "${!v}" ] || { echo "could not find $v in the source" >&2; exit 1; }; done

sri() { echo "sha384-$(openssl dgst -sha384 -binary "$1" | openssl base64 -A)"; }
fetch() { # url file expected-sri(optional)
  local f="$OUT/offline/vendor/$2"
  if [ "$NO_DL" = "--no-download" ]; then echo "/* placeholder: $1 */" > "$f"; return; fi
  curl -fsSL --retry 4 --retry-delay 2 "$1" -o "$f"
  if [ -n "${3:-}" ] && [ "$(sri "$f")" != "$3" ]; then echo "integrity mismatch for $1" >&2; exit 1; fi
  # A script with an integrity hash is fetched in CORS mode; without the header the browser refuses it.
  if ! curl -fsSI --retry 4 --retry-delay 2 -H "Origin: https://example.org" "$1" | grep -qi '^access-control-allow-origin:'; then
    echo "$1 is served without Access-Control-Allow-Origin, so its integrity check would block it in the browser" >&2; exit 1
  fi
}
fetch "$PLOTLY" plotly.min.js "$PLOTLY_SRI"
fetch "$JSPDF" jspdf.umd.min.js "$JSPDF_SRI"
fetch "$AUTOTABLE" jspdf.plugin.autotable.min.js "$AUTOTABLE_SRI"
fetch "$XLSX" xlsx.full.min.js "$XLSX_SRI"

# Point the code at the bundled copies and drop the Google Fonts links (the system font is used).
sed -i -E "s#${PLOTLY}#vendor/plotly.min.js#; /fonts\.(googleapis|gstatic)\.com/d" "$OUT/offline/index.html"
sed -i -E "s#${JSPDF}#vendor/jspdf.umd.min.js#; s#${AUTOTABLE}#vendor/jspdf.plugin.autotable.min.js#" "$OUT/offline/js/report.js"
sed -i -E "s#${XLSX}#vendor/xlsx.full.min.js#" "$OUT/offline/js/importer.js"
# Nothing may still point outside (links to the repository and the ECB page are plain <a> links).
if grep -rnE "https://(cdn\.|fonts\.|unpkg|cdnjs)" "$OUT/offline" --include=*.html --include=*.js --exclude-dir=vendor; then echo "offline build still references a CDN" >&2; exit 1; fi
(cd "$OUT/offline" && zip -qrX "../${NAME}-offline.zip" .)

# ---- SBOM and calculation validation ---------------------------------------------------------------
node scripts/sbom.mjs "$VERSION" > "$OUT/${NAME}.cdx.json"
# Fails the release when a golden figure moved without the fixture being updated on purpose.
node scripts/golden.mjs --report "$OUT/VALIDATION.md"

# ---- checksums and notes ---------------------------------------------------------------------------
(cd "$OUT" && sha256sum "${NAME}.zip" "${NAME}-offline.zip" "${NAME}.cdx.json" VALIDATION.md > SHA256SUMS.txt)
cat > "$OUT/RELEASE_NOTES.md" <<EOF
Nexus Portfolio Lab ${VERSION}

- \`${NAME}.zip\` — the site as published, loading its libraries from their CDNs.
- \`${NAME}-offline.zip\` — the same site with Plotly, SheetJS and jsPDF bundled in \`vendor/\` and no web fonts: it makes no outbound requests. Unzip it onto an internal web server (ES modules do not load from a file:// path).

Both files were built by GitHub Actions from the tagged source and carry a signed build provenance attestation. To check that a file is exactly what this repository built:

\`\`\`
gh attestation verify ${NAME}-offline.zip --repo AntonAlin/options-lab
sha256sum -c SHA256SUMS.txt
\`\`\`

Library integrity: Plotly, jsPDF and SheetJS were checked against the SRI hashes in the source before bundling.

- \`${NAME}.cdx.json\` — CycloneDX SBOM of every third-party component, with versions, licences and hashes. It carries a signed SBOM attestation for both zips.
- \`VALIDATION.md\` — the calculation validation report: the demo fund's risk, compliance and pricing figures against the frozen reference values, and closed-form pricing checks.
EOF
ls -l "$OUT"
