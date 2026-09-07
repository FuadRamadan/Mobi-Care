# MobiCare — deployment handover

Everything needed to put MobiCare on GoDaddy Web Hosting Deluxe, in the order it
has to happen. Start here, then work through the numbered files.

The application code stays in the repository; this folder is the deployment
material — the runbooks, the scripts that build and package a release, and the
probe that has to pass before any of it is worth doing.

---

## Read this before you plan the work

Two things are **not** done, and neither can be finished from a laptop. Both are
in [0-BLOCKERS.md](0-BLOCKERS.md), with the exact change to make.

1. **The database driver still connects on port 5432, which GoDaddy blocks.**
   One file, roughly ten lines. It has been left undone deliberately: connection
   code that has never opened a real connection should not be committed as if it
   were ready. It needs a Neon database and a probe run first.

2. **Payment is not verified.** An order can be marked paid without any Orange
   Money confirmation. This is a known, accepted state — see
   [KNOWN-GAPS.md](KNOWN-GAPS.md) — but decide what you are doing about it
   before real orders are taken.

Everything else — the API, both web frontends, the database schema and its
migrations, object storage, secrets handling, rate limiting — is built, tested
and verified by running it.

---

## The order of work

| # | Step | File | Where it runs |
|---|---|---|---|
| 0 | Understand the two blockers | [0-BLOCKERS.md](0-BLOCKERS.md) | — |
| 1 | Prove the platform can reach a database and a bucket | [1-connectivity-probe/](1-connectivity-probe/README.md) | **On GoDaddy** |
| 2 | Create and migrate the PostgreSQL database | [2-DATABASE.md](2-DATABASE.md) | Your machine |
| 3 | Create the private object storage bucket | [3-OBJECT-STORAGE.md](3-OBJECT-STORAGE.md) | Your machine |
| 4 | Generate the secrets | [4-SECRETS.md](4-SECRETS.md) | Your machine |
| 5 | Build the release and deploy it | [5-BUILD-AND-DEPLOY.md](5-BUILD-AND-DEPLOY.md) | Your machine → GoDaddy |

Steps 2, 3 and 4 must all be done before the app first starts. The API validates
its secrets and its database schema at startup and exits if either is wrong, so
getting the order wrong fails loudly rather than half-working.

**Do not skip step 1.** The whole architecture rests on the assumption that the
GoDaddy Node app can open an outbound WebSocket on port 443. If it cannot, no
amount of the rest of this works, and the answer is a VPS instead. The probe
gives a one-word verdict; do not proceed on anything but GO.

---

## What is in this folder

```
Final Deployment files/
├── README.md                  you are here
├── 0-BLOCKERS.md              the two things that are not done
├── 1-connectivity-probe/      deploy this to GoDaddy first; it answers GO / NO-GO
├── 2-DATABASE.md              creating and migrating PostgreSQL
├── 3-OBJECT-STORAGE.md        the private bucket, and moving existing media into it
├── 4-SECRETS.md               what to generate, and the one that must be rotated
├── 5-BUILD-AND-DEPLOY.md      the release runbook and the verification checklist
├── PLATFORM-NOTES.md          what the GoDaddy plan can and cannot do, and why
│                              the architecture is shaped this way
├── KNOWN-GAPS.md              what is unfinished, and what it means
├── env.production.example     every environment variable, annotated
└── scripts/
    ├── package-release.sh     builds the upload zip
    └── switch-object-storage.sh
```

---

## The shape of the deployment

Everything is **one Node application on one origin**:

```
https://mobicare.sl
├── /                    gateway: public site, patient app (/app), HQ (/hq)
├── /pharmacy-portal/    pharmacy portal
└── /api/*               the Express API
        ↓ HTTPS/WSS on port 443
   PostgreSQL (Neon)  +  private object storage (S3 / R2 / B2)
```

One origin means **no CORS to configure** — both frontends call the API on the
same host. The packaged bundle needs **no npm dependencies**: esbuild inlines
everything, verified by running it from a directory with no `node_modules` at
all. The zip is about 3 MB against a 100 MB upload limit.

GoDaddy's own managed MySQL is deliberately unused. The reason is in
[PLATFORM-NOTES.md](PLATFORM-NOTES.md) — briefly, the schema depends on
PostgreSQL features MySQL does not have, including a partial unique index that
is the only thing stopping a pharmacy listing the same drug twice, and porting
it would mean rewriting the money-handling code that decides what pharmacies get
paid.

---

## What you need to have

- **A PostgreSQL database reachable over WebSocket on 443.** Neon is what this
  was designed against. An ordinary PostgreSQL host will not do — they listen on
  5432, which the platform blocks.
- **A private S3-compatible bucket.** S3, Cloudflare R2 and Backblaze B2 all
  work. It must be private: prescription images are medical records.
- **Node 22 and pnpm 10** on whichever machine builds the release.
- Access to the GoDaddy hosting dashboard for the Node.js app and its
  environment variables.

---

## Running it locally first

The whole platform runs on one machine with demo data, which is the fastest way
for someone new to see what they are deploying:

```bash
bash deploy/local/run.sh
```

It starts its own PostgreSQL and object storage on spare ports, applies the
migrations, seeds a pharmacy, a patient and an HQ account, and serves everything
at http://localhost:8080. Sign-in details are printed at the end. See
`deploy/local/README.md`.

---

## Verified, and how

Everything claimed here was checked by running it, not by reading the code:

- 89 automated tests pass
- Every package typechecks
- The database builds from empty and migrates forward; the baseline reproduces a
  migrated schema exactly
- The API, both frontends, sign-in for all three roles, search, checkout,
  prescriptions, media upload and retrieval all exercised through a browser
  against a real local stack

The two things that could not be verified from here are the two blockers: they
need the GoDaddy platform and a real Neon database.
