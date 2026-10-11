# MobiCare update 2026-10-11 (insights): deploy checklist

This branch holds the **ready-built** app: the source branch
`update-2026-10-11-insights` at commit `f681490`, built with
`PUBLIC_URL=https://mobicaresl.com`. Nothing needs installing or building.

It carries every change since the 29 September release: the 10-02 fixes,
the security update, Monime payments and Data & Insights.

**Once this is live, patients can only order through Monime.** Paying the
pharmacy directly is gone. Do steps 1 to 6 on the same day.

Tested before release, on a copy of the production schema at 0029:
218/218 automated tests pass; the database update applies, refuses to run
twice, and leaves the schema identical to a fresh install; this release
starts on the result; the 29 September release also still starts on it.

## 1. Back up the database
Neon → Branches → Create branch, parent = the production branch (the one
with compute endpoint `ep-quiet-silence-za74g1ek`), data = current point in
time. Name it `backup-before-2026-10-11`. Note the time.

## 2. Update the database
Neon → SQL Editor, branch = production (**not** the backup), database =
`neondb`. Paste all of `DATABASE-UPDATE-2026-10-11.sql` from this branch and
Run. It applies 8 changes (0030 to 0037) in one transaction: if anything
fails, nothing changes. Confirm:

```sql
SELECT count(*), max(filename) FROM schema_migrations;
-- expect 37 | 0037_search_insights.sql
```

The live 29 September release keeps working on the updated database, so
there is no rush between this step and step 4.

## 3. Prepare Monime
- Monime dashboard → Developer → Access tokens: new token `MobiCare - Live`,
  **Test mode OFF**, all six roles, 1 year (calendar reminder to renew).
  It goes into GoDaddy only.
- Make a random value of 32+ characters for the webhook header, e.g.
  `openssl rand -hex 24`.

## 4. GoDaddy: point at this branch and add the payment settings

| Setting | Value |
|---|---|
| Repository | `FuadRamadan/Mobi-Care` |
| Branch | `update-2026-10-11-insights-deploy` |
| Build command | empty |
| Install step | none |
| Start command | `node dist/index.mjs` (or `npm start`) |

Add these to the **Publish** environment's secrets. Leave every existing
variable as it is.

| Name | Value |
|---|---|
| `PAYMENTS_PROVIDER` | `monime` |
| `MONIME_MODE` | `live` |
| `MONIME_ACCESS_TOKEN` | the `MobiCare - Live` token |
| `MONIME_SPACE_ID` | `spc-k6VasL8zN2DVb4JCm4RMaqLA6Cn` |
| `MONIME_HOLDING_ACCOUNT_ID` | `fac-k6ViVwMBF1tYfS1aUk2fgbumgw5` |
| `MONIME_WEBHOOK_HEADER_TOKEN` | the 32+ character value from step 3 |
| `PUBLIC_APP_URL` | `https://mobicaresl.com` |

Then **Publish** (not only Preview).

The log must show `Payments: Monime (live mode)` and then
`Server listening`. If it stops with "Monime payments are misconfigured: …",
the message names the setting to fix. "Database schema is out of date" means
step 2 did not run on the production branch.

## 5. Monime webhook
Monime dashboard → Developer → Webhooks → Create:
- URL `https://mobicaresl.com/api/webhooks/monime`
- Events: checkout sessions, payouts, internal transfers
- Custom header `x-mobicare-webhook-token` = the same value as
  `MONIME_WEBHOOK_HEADER_TOKEN`

## 6. Check it worked
- `https://mobicaresl.com/api/health/ready` says `{"status":"ok","database":"ok"}`.
- Hard-refresh the site (Ctrl+Shift+R; clear the cache on a phone).
- HQ signs in; Security & Settings shows Security activity; Data & Insights
  shows "Medicines not found"; Settlements has Figures and Payouts tabs.
- **One small real order end to end** before telling pharmacies: place it,
  pay through Monime, watch it go paid, mark it delivered, and see the
  pharmacy's share arrive in its Monime account. Try "Ask someone else to
  pay" once too: it has not been used on real Monime yet.

## Going back
Point GoDaddy at `update-2026-09-29-deploy` and Publish. No database restore
is needed: the 29 September release runs on the updated database. It does
not know about Monime, though, so any order already paid through Monime has
to be finished by hand from HQ and the Monime dashboard.
