#!/bin/bash
# Point the API at the S3 storage adapter instead of the Replit one, or put it
# back.
#
#   bash deploy/godaddy/switch-object-storage.sh           # switch to S3
#   bash deploy/godaddy/switch-object-storage.sh --revert   # back to Replit
#
# Only import paths change; no logic is touched. Both directions are exact
# inverses, and `git checkout -- artifacts/api-server/src` undoes either.
#
# Every file under src/ is rewritten, not just routes: error-boundary.test.ts
# imports ObjectNotFoundError too, and route code tests it with `instanceof`.
# Leaving the test on the old module gives two different classes with the same
# name, so a not-found becomes a 500 instead of a 404.
#
# The Replit adapter (src/lib/objectStorage.ts) and its ACL module are left in
# place, so reverting needs nothing but this script.
#
# After switching, run:
#   pnpm --filter @workspace/api-server run typecheck
#   DATABASE_URL=<dev-url> pnpm --filter @workspace/api-server run test

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$REPO/artifacts/api-server/src"

if [[ ! -d "$SRC" ]]; then
  echo "Cannot find $SRC" >&2
  exit 1
fi

revert=false
if [[ "${1:-}" == "--revert" ]]; then
  revert=true
elif [[ -n "${1:-}" ]]; then
  echo "Unknown option: $1 (expected --revert or nothing)" >&2
  exit 1
fi

# Matches any relative specifier ending in lib/objectStorage or lib/objectAcl,
# with or without a .js suffix, at any directory depth.
if $revert; then
  expr='s#(["'"'"'])((\.\./|\./)+lib/)storage/(objectStorage|objectAcl)(\.js)?\1#\1\2\4\5\1#g'
  direction="Replit App Storage"
else
  expr='s#(["'"'"'])((\.\./|\./)+lib/)(objectStorage|objectAcl)(\.js)?\1#\1\2storage/\4\5\1#g'
  direction="S3-compatible storage"
fi

changed=0
while IFS= read -r file; do
  # Never rewrite the adapters themselves.
  case "$file" in
    "$SRC"/lib/storage/*|"$SRC"/lib/objectStorage.ts|"$SRC"/lib/objectAcl.ts) continue ;;
  esac

  before="$(cat "$file")"
  # macOS and GNU sed disagree about -i; write to a temp file instead.
  sed -E "$expr" "$file" > "$file.tmp" && mv "$file.tmp" "$file"

  if [[ "$before" != "$(cat "$file")" ]]; then
    echo "  updated ${file#"$REPO"/}"
    changed=$((changed + 1))
  fi
done < <(find "$SRC" -name '*.ts' -type f)

echo
if [[ $changed -eq 0 ]]; then
  echo "No files changed — already pointing at $direction."
else
  echo "Switched $changed file(s) to $direction."
  echo "Now run: pnpm --filter @workspace/api-server run typecheck"
fi
