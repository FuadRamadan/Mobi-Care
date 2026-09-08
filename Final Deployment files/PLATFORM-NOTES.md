# GoDaddy platform notes — background

Why the deployment is shaped the way it is. Not a step: read it when you want
the reasoning, or when something in the runbooks needs justifying. The order of
work is in [README.md](README.md).

## MobiCare on GoDaddy Web Hosting Deluxe

Findings on what the purchased plan can and cannot run, the resulting
architecture decision, and the database runbook.

Companion documents: [5-BUILD-AND-DEPLOY.md](5-BUILD-AND-DEPLOY.md) for the deployment runbook,
[3-OBJECT-STORAGE.md](3-OBJECT-STORAGE.md) for media, [4-SECRETS.md](4-SECRETS.md) for
the secret that must be rotated, and [1-connectivity-probe/](1-connectivity-probe/) for the
connectivity test that gates all of it.

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

Porting means rewriting the Drizzle schema, all 24 migrations, the startup
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

**Built.** `lib/db/src/index.ts` supports both drivers and chooses between them:
`DATABASE_DRIVER=neon` selects the WebSocket one, and a `*.neon.tech`
connection string selects it on its own. Development, the test suite and the
migration runner keep the ordinary driver on 5432, so nothing local changed.

Everything else — the schema, all 24 migrations, the baseline, the financial
logic, the tests — is unchanged, because it stays PostgreSQL.

It was verified against a real PostgreSQL through a WebSocket rather than just
typechecked, including interactive transactions and the whole application
running on top of it. What that cannot prove is whether GoDaddy permits the
outbound connection, which is what the probe is for. See
[0-BLOCKERS.md](0-BLOCKERS.md).

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

**An S3-backed replacement is now built and tested** — see
[3-OBJECT-STORAGE.md](3-OBJECT-STORAGE.md) for what it covers, how to configure it,
and how to migrate the existing objects.

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
   endpoint? This is the assumption everything else rests on.
   **[`1-connectivity-probe/`](1-connectivity-probe/) is built for exactly this** — deploy it, read
   its verdict, and do not proceed on anything but GO.
2. Confirm the plan's Node.js Hosting is enabled on your account and check the
   app's memory and storage limits against a 3 MB API bundle.

If (1) fails, the realistic options narrow to a GoDaddy VPS or another host for
the API. Ask GoDaddy support directly — the restriction may be liftable.

## Database

The API refuses to start against a database whose schema is behind, so this must
be right before anything else works. The commands, the reason a baseline exists,
and what to do when the runner refuses are all in
[2-DATABASE.md](2-DATABASE.md).

## What is still open

Kept current; the detail is in [KNOWN-GAPS.md](KNOWN-GAPS.md).

1. **Payment is unverified** — an order can be marked paid with no Orange Money
   confirmation. This deployment goes out with that gap accepted.
2. **The privacy policy text does not exist.** Patients are asked to agree to a
   "terms and privacy notice" and their answer is recorded against a policy
   version, but there is no document behind that phrase yet.
3. Browser CORS on presigned uploads, and the object migration, are unverified
   until a real bucket exists.
4. Nothing is purged on a retention schedule.

Done since this document was first written: the WebSocket database driver, the
S3 object storage adapter, the `JWT_SECRET` rotation and startup secret checks,
rate limiting and security headers, single-origin static hosting, the tracked
migration runner, and recorded consent with patient data export and erasure.

## Sources

- [GoDaddy Node.js Hosting launch announcement](https://www.godaddy.com/resources/news/godaddy-nodejs-hosting-launch)
- [GoDaddy Node.js Hosting FAQ](https://www.godaddy.com/help/godaddy-nodejs-hosting-faq-42915)
- [Which components does my hosting support?](https://www.godaddy.com/help/which-components-does-my-hosting-support-5614)
- [Create a MySQL database in Web Hosting (cPanel)](https://www.godaddy.com/help/create-a-mysql-database-in-my-web-hosting-cpanel-16016)
- [Neon serverless driver documentation](https://neon.com/docs/serverless/serverless-driver)
- [Drizzle ORM — Neon connection guide](https://orm.drizzle.team/docs/connect-neon)
