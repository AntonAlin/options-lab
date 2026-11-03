#!/usr/bin/env bash
# Check that every URL given is behind Cloudflare Access: an anonymous request must be redirected to the
# Access login (<team>.cloudflareaccess.com), never answered with the page itself.
# The deploy workflow runs it before and after deploying, so the site is never published without a login.
#   bash scripts/check-access.sh https://options-lab.pages.dev https://nexus.example.com
set -uo pipefail
[ $# -gt 0 ] || { echo "usage: check-access.sh <url>..." >&2; exit 2; }
FAIL=0
for URL in "$@"; do
  # No -L: the first answer must be the redirect. A few retries for DNS or a cold edge.
  OUT=$(curl -sS -o /dev/null --retry 3 --retry-delay 5 --max-time 30 -w '%{http_code} %{redirect_url}' "$URL" 2>&1) || true
  CODE=${OUT%% *}
  LOCATION=${OUT#* }
  HOST=$(printf '%s' "$LOCATION" | sed -E 's#^https://([^/:]+).*#\1#')
  if [[ "$CODE" =~ ^30[1278]$ && "$HOST" == *.cloudflareaccess.com ]]; then
    echo "OK    $URL -> Cloudflare Access login ($HOST)"
  else
    echo "::error::$URL is not behind Cloudflare Access (answer: $OUT). Add it to the Access application before deploying; see docs/CLOUDFLARE.md."
    FAIL=1
  fi
done
exit $FAIL
