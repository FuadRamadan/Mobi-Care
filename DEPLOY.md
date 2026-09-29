# MobiCare update 2026-09-29: deploy checklist

This branch holds the **ready-built** app, the same contents as
`MobiCare-update-2026-09-29.zip`. Nothing needs installing or building.
The source code is on the `update-2026-09-29` branch.

**This update changes the database.** Do the steps in order.

## 1. Back up the database
In the Neon dashboard, create a branch of the production database. It is an
instant snapshot, and your way back if anything goes wrong.

## 2. Update the database
On a computer with the source code (Node 22 and pnpm installed):

```
git fetch origin
git checkout update-2026-09-29
pnpm install
DATABASE_URL='<the production database URL from GoDaddy>' node lib/db/scripts/migrate-tracked.mjs
```

If it stops with "0000_baseline.sql changed after it was applied", run this
once, then run the command above again:

```
DATABASE_URL='<same URL>' node lib/db/scripts/migrate-tracked.mjs --accept-baseline
```

Do not use `prepare-deployment.sh` for an update: it can generate new secrets,
and a new SESSION_SECRET logs everyone out.

## 3. Point GoDaddy at this branch

| Setting | Value |
|---|---|
| Branch | `update-2026-09-29-deploy` |
| Build command | empty |
| Install step | none |
| Start command | `node dist/index.mjs` |
| Environment variables | leave them exactly as they are; this update adds none |

Then redeploy.

## 4. Check it worked
- Open https://mobicaresl.com/api/healthz. It should say `{"status":"ok"}`.
- Hard-refresh the site (Ctrl+Shift+R, or clear the browser cache on a phone).
- HQ → Catalogue: the category dropdowns list categories.
- Patient app → Profile: a photo uploads.
- Patient app → Search: promotions show as vertical cards with "Read more".

If the app will not start, the GoDaddy log says why. "Database schema is out
of date" means step 2 has not been run against this database.

## Going back
Point GoDaddy at the previous deploy, **and** restore the step 1 database
backup. The previous version does not start on the updated database.
