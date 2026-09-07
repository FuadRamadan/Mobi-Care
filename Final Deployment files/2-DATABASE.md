# Database — step 2

Part of the deployment handover; the order of work is in
[README.md](README.md).

PostgreSQL, reached over WebSocket on port 443. This must be right before
anything else works: the API checks its schema at startup and exits if it is
behind.

Run these from a machine with the repository checked out and Node 22 available —
not from GoDaddy.

---

## 1. Create the database

Create a PostgreSQL database at a provider reachable over WebSocket on 443.
**Neon** is what this was designed and tested against.

An ordinary PostgreSQL host will not work from the deployed app: they listen on
5432, which the platform blocks. See [0-BLOCKERS.md](0-BLOCKERS.md).

Keep the connection string — it becomes `DATABASE_URL`.

---

## 2. Build the schema

### A new, empty database

```bash
DATABASE_URL='postgresql://...' node lib/db/scripts/migrate-tracked.mjs --init
```

This applies `lib/db/baseline/0000_baseline.sql`, then records every numbered
migration as applied without executing it — the baseline already contains their
cumulative effect.

### An existing database being moved across

Run **once**, before any ordinary run. It records history, executes nothing and
changes no data:

```bash
DATABASE_URL='postgresql://...' node lib/db/scripts/migrate-tracked.mjs --adopt
```

### Do not use `pnpm run migrate`

The original runner cannot build an empty database. `lib/db/migrations/` starts
at `0001`, which issues `ALTER TABLE` against tables no migration creates — they
were created by `drizzle-kit push` on the old host. Against an empty database it
applies **zero** migrations and fails immediately:

```
error: relation "drug_catalogue" does not exist
```

That is the gap the baseline closes.

---

## 3. Every release after that

```bash
DATABASE_URL='postgresql://...' node lib/db/scripts/migrate-tracked.mjs
```

Applies only what is pending, oldest first, each file in its own transaction.

**Take a backup before touching a database that holds real data.**

---

## Why there is a baseline

`lib/db/baseline/0000_baseline.sql` is generated from the Drizzle model plus
every migration applied in order, then verified to reproduce that exact schema on
its own. It carries the seed rows too — the financial configuration in
`platform_settings` and the reconciliation markers in `financial_migration_state`
— without which a new database starts financially misconfigured.

It is a **generated snapshot**, so it changes whenever migrations are folded into
it. That is routine, and the runner has a mode for it (below).

---

## When the runner refuses

### "0000_baseline.sql changed after it was applied"

Routine. The baseline was regenerated in the repository. Re-recording it executes
nothing:

```bash
DATABASE_URL='postgresql://...' node lib/db/scripts/migrate-tracked.mjs --accept-baseline
```

### The same message about a **numbered** migration

Not routine. It means the database and the repository disagree about what
actually ran. `--accept-baseline` deliberately refuses this case. Work out which
is wrong before going further.

### "--init expects an empty database"

The database already has application tables. Use `--adopt`.

---

## After adding a migration

Regenerate the baseline so a fresh install keeps matching a migrated one. This
creates and drops two scratch databases, so point it at a development server,
**never one holding real data**:

```bash
DATABASE_ADMIN_URL=postgresql://user@host:5432/postgres \
  bash lib/db/scripts/generate-baseline.sh
```

Then, on each existing database, `--accept-baseline` once.

---

## What the tracked runner gives you

`lib/db/scripts/migrate-tracked.mjs` records each file in a `schema_migrations`
table with a SHA-256 checksum. So each migration runs exactly once, the runner
refuses to proceed if an applied migration's content changed, and every file is
wrapped in its own transaction — a failure rolls that file back and leaves
`schema_migrations` consistent with what actually ran.

The original `lib/db/scripts/migrate.mjs` keeps no record and re-executes all
migrations on every invocation. That happens to work, because they are
individually re-runnable, but it re-runs data migrations and rewrites two tables
through an enum drop-and-recreate every time. It is untouched and still there;
nothing depends on it.

---

## Verified

Against PostgreSQL 16, with the application itself:

- the baseline reproduces the migrated schema exactly — dumps compared, no diff
- `--init` on an empty database, then the API starts and its schema check passes
- the full API test suite green against a baselined database
- seed rows present and correct
- re-running is a no-op
- `--init` refuses a database that already has tables, pointing at `--adopt`
- `--adopt` records history without executing anything
- a later migration applies correctly on top of a baselined database
- editing an applied migration is detected and blocks the run
- `--accept-baseline` re-records a rewritten baseline, is idempotent, and refuses
  when a numbered migration has also changed
