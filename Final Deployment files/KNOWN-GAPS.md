# Known gaps

An honest list of what is unfinished, what it means, and what it does not mean.
Nothing here is a surprise waiting to be discovered in production.

---

## Blocking, if you take real orders

### Payment is not verified

`POST /api/patient/orders/:id/pay` moves an order to `paid` on the patient's own
authenticated request, with no Orange Money confirmation. Anyone with an account
can mark their own order paid and trigger fulfilment without paying, and those
orders flow into pharmacy commission settlements, so the financial records
inherit the same gap.

Full detail and your options are in [0-BLOCKERS.md](0-BLOCKERS.md).

**What it does not mean:** patients cannot pay. The pharmacy's Orange Money and
AfriMoney numbers are collected at onboarding and shown at checkout, so the
patient pays the pharmacy directly today. What is missing is the platform
*confirming* that the money arrived.

---

---

## Unverified until real infrastructure exists

These are built and unit-tested, but have never been exercised against a real
bucket or a real deployment. Test them as part of step 5's checklist.

- **Browser CORS on presigned uploads.** HQ media uploads go directly from the
  browser to the bucket. The bucket needs a CORS rule allowing `PUT` from the
  site origin, or those uploads fail in the browser while everything else works.
  See [3-OBJECT-STORAGE.md](3-OBJECT-STORAGE.md).
- **The object migration script.** `artifacts/api-server/scripts/migrate-object-storage.ts`
  moves existing media from the old host into the new bucket. It has a
  `--dry-run` mode. It has never been run end to end because both ends have
  never existed at once.
- **Outbound WebSocket on 443 from GoDaddy.** The assumption the whole
  architecture rests on. The driver that uses it is built and has been run
  against a real PostgreSQL end to end; what is unproven is whether GoDaddy's
  network permits the connection. This is exactly what step 1 exists to answer.

---

## Housekeeping

- **`scripts/seed-team-photos.ts`** still targets the old storage provider and
  will not work after the move. It is not needed — team photos migrate with
  everything else.
- **`exports/`** is a stale 12 MB duplicate of the whole codebase, including a
  zip. It is out of date with the current source, and it is where the leaked
  `JWT_SECRET` survived the first cleanup. **Deleting it is recommended** — it
  is one more place for a secret to hide.
- **`DEPLOYMENT.md`** at the repository root is superseded and marked as such.
  It describes shared PHP hosting and a VPS, and a database path that does not
  work on an empty database. This folder replaces it.

---

## Deliberately not built

Not gaps — decisions, recorded so nobody rebuilds them by accident.

- **Delivery pricing.** MobiCare charges no delivery fee during the pilot: there
  is no agreement with a delivery company, riders are hired locally and paid
  outside the platform, and patients are quoted prices by hand. The delivery-fee
  and courier-payout settings were removed rather than left as figures nobody
  had set. The `orders` columns remain, holding zero, ready for a real pricing
  rule when a partner is contracted.
- **Minimum cohort suppression in Data & Insights.** Reporting has no minimum
  group size. Small partners and one-off searches are business data during a
  pilot, not values to hide.
