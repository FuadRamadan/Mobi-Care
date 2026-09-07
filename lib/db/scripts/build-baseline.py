#!/usr/bin/env python3
"""Write 0000_baseline.sql from an already-migrated reference database.

Called by generate-baseline.sh. Takes the reference database's schema and the
seed rows the application depends on, and emits one transactional file that
recreates both.

Usage: build-baseline.py <reference-database-url> <output-path>
"""

import subprocess
import sys

HEADER = """-- MobiCare baseline schema — generated, do not hand-edit.
--
-- Captures the complete database as of the latest migration: the Drizzle model
-- plus the cumulative effect of every migration in lib/db/migrations. It exists
-- because those migrations begin at 0001 with ALTER statements and therefore
-- cannot build an empty database on their own.
--
-- Regenerate with: lib/db/scripts/generate-baseline.sh
-- Apply with:      node lib/db/scripts/migrate-tracked.mjs --init
--
-- NOT idempotent: it issues bare CREATE statements and will fail on a database
-- that already has these objects. Run it only through migrate-tracked.mjs,
-- which records it in schema_migrations, never applies it twice, and wraps it
-- in a transaction so a failure leaves the database untouched.
"""

# Rows written by migrations 0013 and 0018. The application reads these at
# runtime, so a schema-only baseline would start a financially misconfigured
# system. Values are read from the reference database rather than hardcoded, so
# a change to those migrations carries through on regeneration.
SEED_TABLES = ["platform_settings", "financial_migration_state"]

SEED_HEADER = """

-- ── Seed rows ────────────────────────────────────────────────────────────────
-- Written by migrations 0013 and 0018 and read by the application at runtime.
-- platform_settings holds financial configuration; financial_migration_state
-- marks reconciliation boundaries that a fresh database satisfies on creation.
"""


def run(*args: str) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def schema_sql(url: str) -> str:
    dump = run(
        "pg_dump", url,
        "--schema-only", "--no-owner", "--no-privileges", "--quote-all-identifiers",
    )
    lines = [
        line for line in dump.splitlines()
        # psql meta-commands are not valid SQL over the wire.
        if not line.startswith(("\\restrict", "\\unrestrict", "-- Dumped "))
        # Emptying search_path would persist for the whole session and break
        # the runner's bookkeeping. Every name in the dump is schema-qualified,
        # so this line is redundant here.
        and "set_config('search_path'" not in line
    ]
    return "\n".join(lines).strip()


def seed_sql(url: str) -> str:
    out = [SEED_HEADER]
    for table in SEED_TABLES:
        dump = run(
            "pg_dump", url, "--data-only", "--inserts",
            "--no-owner", "--no-privileges", "--quote-all-identifiers",
            "--table", f"public.{table}",
        )
        inserts = [l for l in dump.splitlines() if l.startswith("INSERT INTO")]
        if not inserts:
            continue
        out.append(f"\n-- {table}")
        for statement in inserts:
            # Re-runnable: the runner guarantees once-only execution, but a
            # partially seeded database should not break a re-init.
            out.append(statement.rstrip(";") + "\nON CONFLICT DO NOTHING;")
    return "\n".join(out)


def main() -> None:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        sys.exit(1)
    url, output = sys.argv[1], sys.argv[2]
    with open(output, "w") as handle:
        handle.write(HEADER + schema_sql(url) + seed_sql(url))
    print(f"    wrote {output}")


if __name__ == "__main__":
    main()
