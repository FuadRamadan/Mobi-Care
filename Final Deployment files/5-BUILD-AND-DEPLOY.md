# Deploying MobiCare to GoDaddy — step 5

Part of the deployment handover; the order of work is in
[README.md](README.md).

Supersedes the root `DEPLOYMENT.md`, which was written expecting shared PHP
hosting and a VPS, and describes a database migration path that does not work on
an empty database.

Read `PLATFORM-NOTES.md` first for what the plan rests on, and run the connectivity
probe in `1-connectivity-probe/` before anything else here.

## The shape of it

Everything deploys as **one Node application on one origin**:

```
https://mobicare.sl
├── /                    gateway: public site, patient app (/app), HQ (/hq)
├── /pharmacy-portal/    pharmacy portal
└── /api/*               the Express API
        ↓ HTTPS/WSS on 443
   PostgreSQL (Neon)  +  private object storage (S3/R2/B2)
```

One origin means **no CORS to configure**: both frontends call the API on the
same host, because `VITE_API_URL` is deliberately left unset at build time.

The packaged bundle needs **no npm dependencies**. Everything is inlined by
esbuild — verified by running it from a directory with no `node_modules` at all,
which is what the platform install produces.

## Order of operations

Steps 1–3 must happen before the app first starts. The API validates its secrets
and its database schema at startup and exits if either is wrong, so a wrong
order fails loudly rather than half-working.

Step 6 can be done any time after the database exists, but nobody can use
MobiCare until it has: HQ is what onboards the pharmacies, and there is no
self-registration for it.

### 1. Confirm the platform can reach PostgreSQL

Deploy `1-connectivity-probe/` and read its verdict. See `1-connectivity-probe/README.md`. Do not
continue on an INCOMPLETE or NO-GO result.

### 2. Database

Create a PostgreSQL database at a provider reachable over WebSocket on 443
(Neon). Then, from a machine with the repository:

```bash
# A brand-new, empty database:
DATABASE_URL='postgresql://...' node lib/db/scripts/migrate-tracked.mjs --init

# Or, if you are moving the existing database across, once and before any
# ordinary run — records history, executes nothing, changes no data:
DATABASE_URL='postgresql://...' node lib/db/scripts/migrate-tracked.mjs --adopt
```

Do **not** use `pnpm run migrate`: it cannot build an empty database, applying
zero migrations and failing on the first file. See `PLATFORM-NOTES.md` for why.

Every release after that is the same command with no option, which applies only
what is pending:

```bash
DATABASE_URL='postgresql://...' node lib/db/scripts/migrate-tracked.mjs
```

If it stops with *"0000_baseline.sql changed after it was applied"*, the baseline
was regenerated in the repository. That is routine — it is a generated snapshot —
and re-recording it executes nothing:

```bash
DATABASE_URL='postgresql://...' node lib/db/scripts/migrate-tracked.mjs --accept-baseline
```

The same message about a **numbered** migration is not routine: it means the
database and the repository disagree about what actually ran, and
`--accept-baseline` deliberately refuses it.

Take a backup before touching a database that holds real data.

### 3. Object storage

Create a **private** bucket and credentials scoped to it. Then migrate the
existing objects — run this on the old host, where the source is reachable:

```bash
cd artifacts/api-server
pnpm exec esbuild scripts/migrate-object-storage.ts --bundle --platform=node \
  --format=cjs --outfile=dist/migrate-object-storage.cjs --log-level=warning
PRIVATE_OBJECT_DIR=/<bucket-id>/private S3_ENDPOINT=... S3_REGION=... \
S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
  node dist/migrate-object-storage.cjs --dry-run   # then without --dry-run
```

Add a CORS rule on the bucket allowing `PUT` from `https://mobicare.sl`, or HQ
media uploads will fail in the browser. Full detail in `3-OBJECT-STORAGE.md`.

### 4. Build the release

```bash
bash "Final Deployment files/scripts/switch-object-storage.sh"          # required
DATABASE_URL='<staging-url>' bash "Final Deployment files/scripts/package-release.sh"
```

The switch is required and the packaging script refuses to run without it: the
Replit adapter authenticates through a sidecar that does not exist off Replit,
so packaging it would produce a build whose every image operation fails.

Output is `"Final Deployment files/build/mobicare-release.zip"`, about 3 MB — well under
the platform's 100 MB upload limit. `DATABASE_URL` is optional but runs the full
test suite as part of the build; point it at staging, never production.

### 5. Create the app and set its environment

Upload the zip to a Node.js app in the GoDaddy hosting dashboard. Set:

```bash
NODE_ENV=production
DATABASE_URL=postgresql://...          # secret
DATABASE_DRIVER=neon                   # required here — see below
JWT_SECRET=<openssl rand -hex 32>      # secret — a NEW value, see SECRETS.md
SESSION_SECRET=<openssl rand -hex 32>  # secret — a different value
ALLOWED_ORIGINS=https://mobicare.sl
SMS_TRANSPORT=orange
SERVE_STATIC_DIR=./public
TRUST_PROXY_HOPS=1

S3_ENDPOINT=https://...                # object storage
S3_REGION=...
S3_BUCKET=...
S3_ACCESS_KEY_ID=...                   # secret
S3_SECRET_ACCESS_KEY=...               # secret
```

`PORT` is supplied by the platform. Do not set `VITE_*` here — those are
build-time only, and setting them at runtime does nothing.

**`DATABASE_DRIVER=neon` is required on this platform.** It selects the driver
that speaks PostgreSQL inside a WebSocket on 443; the default one uses port
5432, which GoDaddy blocks. A `*.neon.tech` connection string selects it
automatically, but set it anyway — without it the failure is a slow connection
timeout that does not say what is wrong. The startup log names the driver it
chose; check it after the first deploy.

**`JWT_SECRET` must be a new value.** The old one was committed to the
repository and the API refuses to start with it. See `4-SECRETS.md`.

**`TRUST_PROXY_HOPS` is load-bearing.** It decides what the rate limiter treats
as the client address. Wrong in one direction, one attacker locks out every
user; wrong in the other, nobody is limited at all. 1 is right for a single
reverse proxy. Confirm after deploying: the client address in the logs should be
the real caller, not the proxy.

### 6. Create the first HQ administrator

**Without this nobody can sign in to HQ**, and nothing else can happen: HQ is
what onboards the pharmacies, and there is deliberately no self-registration
for it. A freshly deployed MobiCare with no HQ account is an empty building
with the door locked.

Run once, from a machine with the repository, against the **production**
database:

```bash
cd artifacts/api-server
DATABASE_URL='postgresql://...' \
HQ_ADMIN_USERNAME='youradmin' \
HQ_ADMIN_PASSWORD='<a long, unique password>' \
HQ_ADMIN_NAME='Your Name' \
  pnpm run bootstrap-hq
```

The account is created active, with all three HQ permissions — integrations,
settlements and Data & Insights. It is idempotent: running it again updates and
reactivates that same account rather than creating a second one, which is also
how you recover from a lost HQ password.

`DATABASE_DRIVER` is not needed here. This runs from your machine, not from
GoDaddy, so the ordinary driver on 5432 reaches Neon fine — the same as the
migration commands in step 2.

**These three variables do not belong in the GoDaddy environment.** The API
never reads them; setting them there looks like it worked and creates nothing.

Change the password after the first sign-in, and take the value out of your
shell history.

### 7. Start, and check

```
GET https://mobicare.sl/api/health   →   {"status":"ok"}
```

Then walk the paths in the checklist below.

## Verification checklist

Routing and headers:

- [ ] The startup log says `Database driver: neon`
- [ ] `/api/health` returns `{"status":"ok"}`
- [ ] An unknown `/api` path returns a **JSON 404**, not an HTML page
- [ ] `/` loads the gateway; `/patient`, `/hq` and other deep links load on
      refresh, not just via in-app navigation
- [ ] `/pharmacy-portal/` loads the portal, and its deep links refresh correctly
- [ ] A missing asset returns 404, not HTML
- [ ] Responses carry `Strict-Transport-Security`, `X-Content-Type-Options` and
      `Referrer-Policy`, and no `X-Powered-By`

Behaviour:

- [ ] The HQ account from step 6 signs in, and can onboard a pharmacy
- [ ] A pharmacy onboarded through HQ has a mobile money number recorded, and
      it appears at checkout — a pharmacy without one cannot be paid
- [ ] Patient, pharmacy and HQ sign-in, refresh and sign-out
- [ ] Search, checkout, cancellation, dispatch, delivery confirmation
- [ ] Upload and read every media type: prescription, patient profile photo,
      courier photo, HQ team photo, advertisement image and video
- [ ] A prescription URL is **not** readable signed-out or as a different
      patient
- [ ] Media still loads after restarting the app
- [ ] Pharmacy and HQ financial totals reconcile against patient payments
- [ ] Eleven failed logins in a row return 429, and a different device is
      unaffected
- [ ] No secrets appear in the browser bundles, API responses, or logs

Consent and data rights:

- [ ] Registration is refused without accepting the terms, and the tick box for
      the optional analytics consent starts **unticked**
- [ ] A patient created before this release is prompted on next sign-in, and
      can still read their orders and use Profile → Your data before agreeing
- [ ] "Download my data" returns a JSON file naming that patient
- [ ] Turning off "Help improve medicine access" stops new searches being
      recorded — check `search_events` stops growing for that patient
- [ ] "Delete my account" refuses a wrong password, and when it succeeds the
      patient's orders survive with the name and phone number removed

## What is not finished

**Payment is not verified.** `POST /api/patient/orders/:id/pay` moves an order
to `paid` on the patient's own authenticated request, with no Orange Money
confirmation. Anyone with an account can mark their own order paid and trigger
fulfilment without paying, and those orders flow into pharmacy commission
settlements, so the financial records inherit the same gap.

This is a known, accepted state for this deployment. Before taking real orders,
either complete the Orange Money integration or keep checkout closed. Options if
you want the site live first: run without advertising the ordering flow, or
disable the payment route at the proxy until the integration lands.

Also outstanding:

- Browser CORS on presigned uploads is unverified until a real bucket exists
- The object migration has never been run end to end
- `scripts/seed-team-photos.ts` still targets the old provider and will not work
  after the move; it is not needed, as team photos migrate with everything else
- `exports/` is a stale 12 MB duplicate of the codebase and is where the leaked
  secret survived the first cleanup. Deleting it is recommended.

## Ending the pilot

The pilot collects real records — searches, orders, prescriptions, and the
commission ledger derived from them — that should not be carried into live
trading as if they were real business. HQ can clear them in one action:

**Data & Insights → Reset pilot data.** The dialog shows the exact row counts it
will remove and the list of what it keeps, and only enables the button once
`RESET PILOT DATA` has been typed. The server requires the same phrase
independently, so the endpoint cannot be triggered by a stray request.

- **Removed:** patient searches, orders and order lines, fraud flags,
  prescription reviews and uploaded prescription images (files included), the
  commission settlement ledger with its payments and adjustments, and the
  notifications that pointed at those orders.
- **Kept:** pharmacies and their inventory and prices, patients, HQ staff, the
  drug catalogue, adverts, platform settings, and the audit log — which records
  the reset itself, so who cleared what survives the data being gone.

The settlement ledger goes with the orders by necessity: every commission
settlement is computed from orders, so keeping it would leave pharmacies
invoiced for orders that no longer exist.

It takes **both** the Data & Insights and settlement-management permissions.
Reading the numbers is not the same authority as deciding the money records were
never real. Export anything worth keeping first — the CSV exports on the same
page — because there is no undo.

## Rolling back

The release is a zip; keep the previous one and re-upload it to roll back the
application. Two things do not roll back with it:

- **Database migrations.** Applied migrations stay applied. `schema_migrations`
  records what ran, but there are no down-migrations — restore from backup if a
  release requires it.
- **Object storage.** Uploads made by the new release remain.

To move the code back to the Replit storage adapter:

```bash
bash "Final Deployment files/scripts/switch-object-storage.sh" --revert
```

## Common failures

- **Exits at startup, "Refusing to start with unsafe secrets"** — `JWT_SECRET`
  or `SESSION_SECRET` is missing, too short, shared, or is the retired value.
  The message names the problem. See `4-SECRETS.md`.
- **Exits at startup, "Database schema is out of date"** — step 2 was not run
  against this database, or it points somewhere unexpected.
- **Exits at startup, "ALLOWED_ORIGINS is required in production"** — set it,
  even though one-origin hosting means CORS is never exercised.
- **Images fail with a storage error** — the S3 variables are missing or the
  bucket rejects the credentials. `PRIVATE_OBJECT_DIR` is not used by the S3
  adapter and setting it will not help.
- **Deep links 404 but `/` works** — `SERVE_STATIC_DIR` is not set, so the app
  is serving only the API.
- **The portal loads without styling** — it was built with the wrong
  `BASE_PATH`. Rebuild with `package-release.sh`, which sets it.
- **Everyone gets rate limited at once** — `TRUST_PROXY_HOPS` is too low, so
  every request looks like it comes from the proxy.
- **Sessions all drop after a restart** — `JWT_SECRET` changed between starts.
  It must be stable across restarts.
