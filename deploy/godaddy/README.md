# MobiCare on GoDaddy Web Hosting Deluxe

Findings on what the purchased plan can and cannot run, the resulting
architecture decision, and the database runbook.

**Sourcing note.** GoDaddy's own pages could not be fetched directly from the
environment where this was researched, so the platform facts below come from
GoDaddy documentation and announcements read through search. Treat the two
marked ⚠️ as needing confirmation in your account before committing work to
them. Everything about the MobiCare codebase was verified by running it.

## What the plan gives you

GoDaddy Node.js Hosting became generally available on 12 August 2026 and is
included with Web Hosting plans rather than sold separately, so Deluxe covers
it. The relevant properties:

| Capability | What is provided |
|---|---|
| Node.js runtime | Node.js **22**, a real persistent process — not a serverless function that resets between requests |
| Background work | Timers, in-memory state and open WebSocket connections all survive between requests |
| Database | A **managed MySQL** database per published app, with a table browser and SQL editor |
| Secrets | Encrypted environment variables |
| Deploy | Zip upload up to 100 MB, `node_modules` excluded — dependencies are installed for you |
| Persistent files | Written to `/public/assets/` |
| Outbound network | ⚠️ **Ports 80 and 443 only** |

This is better news than the original `DEPLOYMENT.md` assumed. That document was
written expecting shared PHP hosting that cannot run Node at all, and told you
to buy a VPS. A persistent Node 22 process is exactly what the Express API
needs, and 22 matches the `engines` field in `package.json`.

Three properties still conflict with how MobiCare is built.

### 1. The database is MySQL; MobiCare is PostgreSQL

Not a dialect difference that an ORM setting papers over. The schema depends on
PostgreSQL features with no MySQL equivalent:

- 14 native `enum` types, rewritten in place by migration 0015
- `numeric` money columns, which the financial tests assert on exactly
- a **partial** unique index, `uniq_active_pharmacy_drug_variant` — MySQL has no
  partial indexes, and this one is what stops a pharmacy listing the same drug
  variant twice
- `to_regclass`, `information_schema` probes and `BOOL_AND` in the API's own
  startup schema check
- `jsonb` columns, and `gen_random_uuid()` defaults

Porting means rewriting the Drizzle schema, all 21 migrations, the startup
check, and re-deriving the money-handling guarantees — the settlement and
allocation logic that decides what pharmacies get paid. That is the highest-risk
code in the system, and it currently has passing tests that would all need to be
rewritten alongside it. **Recommendation: do not port to MySQL.**

### 2. Outbound ports 80/443 only

⚠️ This rules out an ordinary external PostgreSQL. Neon, Supabase, Railway and
Aiven all listen on **5432**, which the platform blocks.

The way through is a driver that speaks PostgreSQL over HTTPS/WSS on 443.
Neon's `@neondatabase/serverless` does this, and its `Pool` is documented as a
drop-in for `node-postgres`, with session and interactive transaction support —
which MobiCare requires, because payment claiming and stock deduction run inside
`db.transaction()`.

For `lib/db/src/index.ts` that is a one-line import change:

```diff
-import pg from "pg";
-const { Pool } = pg;
+import { Pool } from "@neondatabase/serverless";
```

Everything else — the schema, all 21 migrations, the baseline below, the
financial logic, the tests — is unchanged, because it stays PostgreSQL.

**Not yet implemented, deliberately.** Database connection code that has never
opened a real connection should not be committed as though it were ready. This
needs a Neon project and one connectivity test from a deployed app before it
goes in.

### 3. Persistent files are public; prescriptions must not be

`/public/assets/` is served publicly. Prescription images are medical records,
and the existing access-control layer (`objectAcl.ts`) exists precisely to keep
them private and application-authorised. Storing them there would expose patient
data to anyone with the URL.

Private object storage reached over HTTPS is required — S3, Cloudflare R2 or
Backblaze B2 all work on 443, so the port restriction is not a problem here.
This replaces `artifacts/api-server/src/lib/objectStorage.ts`, which currently
talks to a Replit credential sidecar on `127.0.0.1:1106` that does not exist off
Replit. Confirmed unreachable: every image operation fails until this is done.

## Recommended shape

```
GoDaddy Web Hosting Deluxe
├── Node.js app ......... Express API (persistent Node 22 process)
├── Static hosting ...... gateway + pharmacy portal (built Vite output)
└── Managed MySQL ....... unused
                ↓ HTTPS/WSS :443
   PostgreSQL (Neon) + private object storage (S3/R2/B2)
```

The alternative worth knowing about is a **GoDaddy VPS**: no port restrictions,
self-hosted PostgreSQL, no external dependency. It costs more and makes database
backups, patching and uptime your responsibility. Given that Deluxe is already
paid for and includes a persistent Node process, the shape above is the better
value — provided the ⚠️ items check out.

### Confirm before building

1. Does the Node app allow an outbound **WSS connection on 443** to a Neon
   endpoint? This is the assumption everything else rests on. Test it with a
   throwaway app that opens a connection and runs `SELECT 1` before any porting
   work starts.
2. Confirm the plan's Node.js Hosting is enabled on your account and check the
   app's memory and storage limits against a 3 MB API bundle.

If (1) fails, the realistic options narrow to a GoDaddy VPS or another host for
the API. Ask GoDaddy support directly — the restriction may be liftable.

## Database runbook

The API refuses to start against a database whose schema is behind, so this must
be right before anything else works.

### Why a baseline exists

`lib/db/migrations/` starts at `0001`, which issues `ALTER TABLE` against tables
no migration creates — they were created by `drizzle-kit push` on the old host.
Running the documented `pnpm run migrate` against an empty database applies
**zero** migrations and fails immediately:

```
error: relation "drug_catalogue" does not exist
```

`lib/db/baseline/0000_baseline.sql` closes that gap. It is generated from the
Drizzle model plus every migration applied in order, then verified to reproduce
that exact schema on its own. It carries the seed rows too — the financial
configuration in `platform_settings` and the reconciliation markers in
`financial_migration_state`, without which a new database starts financially
misconfigured.

### Commands

New, empty database:

```bash
DATABASE_URL=<url> node lib/db/scripts/migrate-tracked.mjs --init
```

Existing database already carrying the full schema (the one moving across from
the old host) — run once, before any ordinary run. Records history, executes
nothing, changes no data:

```bash
DATABASE_URL=<url> node lib/db/scripts/migrate-tracked.mjs --adopt
```

Every release after that:

```bash
DATABASE_URL=<url> node lib/db/scripts/migrate-tracked.mjs
```

After adding a migration, regenerate the baseline so a fresh install keeps
matching a migrated one. This creates and drops two scratch databases, so point
it at a development server, never one holding real data:

```bash
DATABASE_ADMIN_URL=postgresql://user@host:5432/postgres \
  bash lib/db/scripts/generate-baseline.sh
```

### What the tracked runner changes

The original `lib/db/scripts/migrate.mjs` keeps no record of what it has run, so
it re-executes all 21 migrations on every invocation. That happens to work
because the migrations are individually re-runnable — verified by running them
twice — but it re-runs data migrations and rewrites two tables through an enum
drop-and-recreate every time, which gets slow and lock-heavy as tables grow.

`migrate-tracked.mjs` records each file in a `schema_migrations` table with a
checksum, so each runs exactly once, refuses to proceed if a migration's content
changed after it was applied, and wraps each file in its own transaction.

**The original runner is untouched and still works.** Nothing depends on the new
one until you choose to use it.

### Verified

Against PostgreSQL 16, with the application itself:

- baseline reproduces the migrated schema exactly — dumps compared, no diff
- `--init` on an empty database, then the API starts and its startup schema
  check passes
- full API test suite green against a baselined database (31/31)
- seed rows present and correct
- re-running is a no-op
- `--init` refuses a database that already has tables, directing you to `--adopt`
- `--adopt` on a simulated existing database records history without executing
- a later migration applies correctly on top of a baselined database
- editing an applied migration is detected and blocks the run

## Still open

Not addressed here, in rough priority order:

1. Object storage adapter and file migration — blocks all image handling
2. `JWT_SECRET` committed in `.replit` — rotate it; treat the current one as
   compromised
3. Payment: `POST /patient/orders/:id/pay` marks an order paid on the patient's
   own request, with no Orange Money verification
4. No rate limiting on authentication endpoints, and no `helmet`
5. `DEPLOYMENT.md` still describes VPS + subdomain hosting and a migration path
   that does not work on an empty database; it needs rewriting once the ⚠️ items
   are settled

## Sources

- [GoDaddy Node.js Hosting launch announcement](https://www.godaddy.com/resources/news/godaddy-nodejs-hosting-launch)
- [GoDaddy Node.js Hosting FAQ](https://www.godaddy.com/help/godaddy-nodejs-hosting-faq-42915)
- [Which components does my hosting support?](https://www.godaddy.com/help/which-components-does-my-hosting-support-5614)
- [Create a MySQL database in Web Hosting (cPanel)](https://www.godaddy.com/help/create-a-mysql-database-in-my-web-hosting-cpanel-16016)
- [Neon serverless driver documentation](https://neon.com/docs/serverless/serverless-driver)
- [Drizzle ORM — Neon connection guide](https://orm.drizzle.team/docs/connect-neon)
