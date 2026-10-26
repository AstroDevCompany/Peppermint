#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# Print or change the Peppermint version.
#
#   ./version.sh -v | -view   print the current version (e.g. "v0.1.3")
#   ./version.sh 0.1.3        set the version (MAJOR.MINOR.PATCH, optional "v")
#
# The version is owned by peppermint/identity.json (displayVersion) and mirrored
# into every brand of surfer.json, the same way merge-driver.mjs does on merges.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FILES=("$ROOT/peppermint/identity.json" "$ROOT/surfer.json")
FIELD='"displayVersion"'
SEMVER='^[0-9]+\.[0-9]+\.[0-9]+$'

usage() {
  echo "Usage: $(basename "$0") -v | -view | <MAJOR.MINOR.PATCH>" >&2
  exit 1
}

# Version recorded in a file (first displayVersion match).
read_version() {
  sed -n "s/^[[:space:]]*$FIELD:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$1" | head -n 1
}

[ $# -eq 1 ] || usage

case "$1" in
  -v | -view | --view)
    current="$(read_version "${FILES[0]}")"
    [ -n "$current" ] || { echo "error: no displayVersion in ${FILES[0]}" >&2; exit 1; }
    echo "v$current"
    ;;
  -*)
    usage
    ;;
  *)
    new="${1#v}"
    if ! [[ "$new" =~ $SEMVER ]]; then
      echo "error: invalid version '$1' (expected MAJOR.MINOR.PATCH, e.g. 0.1.3)" >&2
      exit 1
    fi
    for file in "${FILES[@]}"; do
      [ -f "$file" ] || { echo "error: missing $file" >&2; exit 1; }
      grep -q "$FIELD" "$file" || { echo "error: no displayVersion in $file" >&2; exit 1; }
    done
    old="$(read_version "${FILES[0]}")"
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    for file in "${FILES[@]}"; do
      sed "s/\(^[[:space:]]*$FIELD:[[:space:]]*\"\)[^\"]*\(\"\)/\1$new\2/" "$file" > "$tmp"
      cat "$tmp" > "$file"
    done
    echo "v${old:-?} -> v$new"
    ;;
esac
