#!/bin/bash
# Regenerate 0000_baseline.sql from the Drizzle model plus every numbered
# migration, then prove the result reproduces the same schema on its own.
#
# Run this after adding migrations, so a fresh install keeps matching a
# migrated one. Needs a PostgreSQL server you can create databases on.
#
#   DATABASE_ADMIN_URL=postgresql://user@host:5432/postgres ./generate-baseline.sh
#
# It creates and drops two scratch databases: mobicare_baseline_ref and
# mobicare_baseline_check. Never point this at a database holding real data.

set -euo pipefail

ADMIN_URL="${DATABASE_ADMIN_URL:-}"
if [[ -z "$ADMIN_URL" ]]; then
  echo "DATABASE_ADMIN_URL is required (a connection to the 'postgres' database)." >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
REF=mobicare_baseline_ref
CHECK=mobicare_baseline_check

base_url() { echo "${ADMIN_URL%/*}/$1"; }

cleanup() {
  psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $REF" >/dev/null 2>&1 || true
  psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $CHECK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Building reference database from schema + migrations"
cleanup
psql "$ADMIN_URL" -qc "CREATE DATABASE $REF"
cd "$REPO"
DATABASE_URL="$(base_url $REF)" pnpm --filter @workspace/db exec \
  drizzle-kit push --force --config ./drizzle.config.ts >/dev/null
DATABASE_URL="$(base_url $REF)" pnpm run migrate >/dev/null

echo "==> Writing baseline"
python3 "$HERE/build-baseline.py" "$(base_url $REF)" "$HERE/../baseline/0000_baseline.sql"

echo "==> Verifying the baseline reproduces that schema on an empty database"
psql "$ADMIN_URL" -qc "CREATE DATABASE $CHECK"
DATABASE_URL="$(base_url $CHECK)" node "$HERE/migrate-tracked.mjs" --init >/dev/null

pg_dump "$(base_url $REF)"   --schema-only --no-owner --no-privileges --quote-all-identifiers >/tmp/_ref.sql
pg_dump "$(base_url $CHECK)" --schema-only --no-owner --no-privileges --quote-all-identifiers >/tmp/_chk.sql
# schema_migrations exists only in the baselined database; it is this runner's
# own bookkeeping, not part of the application schema.
python3 - <<'PY'
import re
def load(p):
    s = open(p).read()
    s = re.sub(r'\\(?:un)?restrict \S+\n', '', s)
    s = re.sub(r'^-- Dumped .*\n', '', s, flags=re.M)
    # Drop the runner's own bookkeeping table and its constraints.
    s = re.sub(r'--\n-- Name: "?schema_migrations"?.*?(?=\n--\n-- Name: |\Z)', '', s, flags=re.S)
    return [l for l in s.splitlines() if l.strip()]
a, b = load('/tmp/_ref.sql'), load('/tmp/_chk.sql')
if a == b:
    print("    schemas match exactly")
else:
    import difflib, sys
    print("    SCHEMAS DIFFER:")
    print("\n".join(list(difflib.unified_diff(a, b, 'migrated', 'baselined', lineterm=''))[:60]))
    sys.exit(1)
PY

echo "==> Done. lib/db/baseline/0000_baseline.sql is current."
