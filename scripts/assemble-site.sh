#!/usr/bin/env bash
# Copy the files the site serves into <dir>: the committed source minus tests, build tooling and
# workflows, plus data/market.json when present.
# Used by the Pages deploy and by the release build, so both publish exactly the same files.
set -euo pipefail
DIR="${1:?usage: assemble-site.sh <dir>}"
cd "$(dirname "$0")/.."
mkdir -p "$DIR"
git archive HEAD | tar -x -C "$DIR"
(cd "$DIR" && rm -rf tests scripts .github package.json .gitignore)
if [ -f data/market.json ]; then mkdir -p "$DIR/data" && cp data/market.json "$DIR/data/"; fi
