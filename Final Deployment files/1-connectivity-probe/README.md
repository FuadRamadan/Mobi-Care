# Connectivity probe — step 1

The first thing to do, before any other deployment work. Start from
[../README.md](../README.md) if you have not.

A throwaway app that answers the question the whole hosting plan rests on:
**can GoDaddy Node.js Hosting reach PostgreSQL over a WebSocket on port 443?**

GoDaddy's documentation says only ports 80 and 443 are open outbound. Neon,
Supabase, Railway and Aiven all listen on 5432, so an ordinary PostgreSQL
connection cannot work. Neon's serverless driver speaks the protocol over a
WebSocket on 443 instead. If that works, MobiCare keeps PostgreSQL and nothing
about the schema, migrations or financial logic changes. If it does not, the
options narrow to a GoDaddy VPS or another host for the API.

Run this **before** any further deployment work.

## What it checks

| Check | What a pass means |
|---|---|
| `runtime` | Node 22, matching what the API expects |
| `httpsEgress` | Outbound 443 works — S3 storage and the Orange SMS API are reachable |
| `postgresPortBlocked` | Port 5432 really is blocked, confirming why WebSocket is needed. A **warn** here is good news: the port is open and an ordinary connection would work |
| `websocketEgress` | A `wss://` connection on 443 can be established |
| `neonQuery` | **The decisive one.** A real query ran, and an interactive transaction committed — which MobiCare needs, because payment claiming and stock deduction run inside `db.transaction()` |
| `objectStorage` | **Photos will work.** Writes an object, reads it back, compares the bytes, confirms the access-control metadata survived, and performs a presigned upload the way the browser does — then deletes everything it made |

The verdict line at the top says GO, NO-GO, or INCOMPLETE. **Both** the
database and photo storage must pass for a GO — a working database with broken
storage is still a stop, because prescriptions, profile photos, courier and team
photos and advertisements all depend on storage.

## Before you deploy it

Two things to have ready, or the corresponding checks are skipped:

1. **A PostgreSQL connection string.** Create a free project at neon.tech.
2. **Object storage credentials.** A private bucket at any S3-compatible
   provider — AWS S3, Cloudflare R2, or Backblaze B2.

GoDaddy's own offerings cover neither. Their included database is MySQL, and
their persistent file area is served publicly, which is not somewhere
prescription images can go.

The storage check writes only under a `_probe/` prefix and removes everything it
creates. Verified across repeated runs: no objects left behind.

## Deploying

1. Zip **the contents of this directory**, excluding `node_modules` — GoDaddy
   installs dependencies from `package.json`:

   ```bash
   cd "Final Deployment files/1-connectivity-probe"
   zip -r ../connectivity-probe.zip . -x 'node_modules/*'
   ```

2. Create a Node.js app in your GoDaddy hosting dashboard and upload the zip.

3. Set these environment variables on the app:

   ```
   NEON_DATABASE_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require

   S3_ENDPOINT=https://s3.eu-west-1.amazonaws.com
   S3_REGION=eu-west-1
   S3_BUCKET=mobicare-media
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   ```

   `PORT` is provided by the platform.

4. Open the app's URL. The results render as a page; `/json` returns the same
   thing as JSON, and `/healthz` is a plain liveness check.

## Reading the result

- **GO** — the architecture in `../README.md` is viable. Proceed with
  deployment.
- **NO-GO** — read the failing check's detail; each names the specific step that
  broke. If `websocketEgress` also failed, the platform is blocking outbound
  WebSockets and no PostgreSQL provider will work from here — ask GoDaddy support
  whether that can be lifted before falling back to a VPS. If only
  `objectStorage` failed, the message says which step failed: a write rejected
  means wrong credentials or bucket, a write that succeeds followed by a failed
  read means the key can write but not read.
- **INCOMPLETE** — the database or storage variables are not set; the verdict
  names which.

Record the JSON output somewhere before deleting the app; it is the evidence
behind the hosting decision.

## Running it locally

```bash
npm install
NEON_DATABASE_URL='postgresql://...' npm run check   # prints JSON and exits
npm start                                            # serves on $PORT
```

## Afterwards

Delete the app from GoDaddy. It is a diagnostic, carries a live database
credential in its environment, and is not part of MobiCare.

## What was verified about the probe itself

Each branch was exercised locally before shipping, so its results can be
trusted:

- WebSocket success against a real TLS WebSocket server on port 443
- WebSocket failure against an unreachable host
- Port 5432 detected as blocked (connection refused) and as open (live
  PostgreSQL) — both branches
- The storage round-trip against a mock that recomputes and verifies every
  signature: full pass including the presigned upload, correct failures for
  wrong credentials and an unreachable endpoint, and no objects left behind
  after repeated runs
- A failed database connection reported as a failure without crashing the server
- HTML page, `/json` and `/healthz` all served correctly

The one thing not exercised is a successful `neonQuery`, which needs a real Neon
project — that is the check you are deploying this to run.
