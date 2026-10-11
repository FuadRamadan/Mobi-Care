# MobiCare pilot fixes (11 Oct 2026): deploy checklist

This branch holds the **ready-built** app, built from
`claude/review-godaddy-nodejs-4k6cie` at commit `9ab5dc0` (the live insights
release plus the pilot fixes) with `PUBLIC_URL=https://mobicaresl.com`.
Nothing needs installing or building.

What changes:
- Pharmacies see the prescription image in the review panel and can download
  it. MobiCare deletes the image 15 minutes after the first download.
- A search box for choosing medicines when approving a prescription.
- Pop-up messages at the top right in the portal and HQ.
- Misspelled searches for medicines that are in stock no longer count as
  "medicines not found".
- HQ can delete delivery zones.
- HQ's Dispatch flag counts orders waiting for a courier; the Dispatch page
  has a banner and a "Show" dropdown.

**No settings change.** Every GoDaddy secret stays exactly as it is.

Tested on a copy of the production schema at 0037: the database update
applies, refuses to run twice, and leaves the schema identical to a fresh
install; this release starts on it, and the release live now also still
starts on it.

## 1. Back up the database
Neon → Branches → Create branch from the production branch (compute
endpoint `ep-quiet-silence-za74g1ek`), current point in time, named
`backup-before-fixes-2026-10-11`.

## 2. Update the database
Neon → SQL Editor, branch = production (not the backup), database = `neondb`.
Paste all of `DATABASE-UPDATE-0038.sql` and Run. Then:

```sql
SELECT count(*), max(filename) FROM schema_migrations;
-- expect 38 | 0038_prescription_downloads_and_zone_deletion.sql
```

The live release keeps working after this, so there is no rush to step 3.

## 3. Point GoDaddy at this branch
Repository `FuadRamadan/Mobi-Care`, branch `update-2026-10-11-fixes-deploy`,
build command empty, start command `node dist/index.mjs`. Publish.

The log should show `Payments: Monime (live mode)`, then `Server listening`.

## 4. Check
- `https://mobicaresl.com/api/health/ready` returns ok.
- Hard-refresh (Ctrl+Shift+R).
- Pharmacy portal → Prescriptions → open one: the image shows in the panel;
  "Download to this computer" saves it, and a note gives the time MobiCare
  deletes its copy.
- HQ → Dispatch shows the "Show" dropdown; Delivery Zones has Delete.

## Going back
Point GoDaddy at `update-2026-10-11-insights-deploy` and Publish. No database
restore is needed.
