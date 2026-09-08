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

## Consent and data rights — built, with one piece outstanding

Patients are now asked, and the answer is recorded:

- **Consent at registration.** Two separate decisions — the required terms and
  privacy notice, and an optional consent for counting searches in the
  anonymous aggregate figures. The optional one is genuinely optional:
  declining it stops the recording rather than recording it and filtering it
  out later, which is the difference between consent and a checkbox.
- **A versioned, append-only record** (`patient_consents`). Withdrawing adds a
  row saying so; it never edits the one that granted it. When the policy text
  changes materially, `CURRENT_POLICY_VERSION` moves and everyone is asked
  again — consent to old text is not consent to new text.
- **Patients who registered before this** are prompted on next sign-in. Until
  they answer, the server refuses to create anything new for them but still
  lets them read their own data, export it, and delete it.
- **Download my data** — profile, consents, orders, prescriptions, uploads,
  notifications and searches, as one JSON file.
- **Delete my account** — requires the current password and a typed phrase.
  Removes the identity, search history, notifications, unused prescription
  uploads and every session; keeps orders and the prescriptions attached to
  them as the pharmacy's dispensing record, with the person removed from them.

**Still outstanding: the policy text itself.** The app now asks people to agree
to a "terms and privacy notice" and there is no document behind that phrase.
The wording shown at the point of consent is accurate about what the system
does, but it is not a privacy policy. Write one, and have it reviewed by
someone who knows Sierra Leonean data-protection law — then publish it and bump
`CURRENT_POLICY_VERSION` so everyone is asked against the real text.

Also still open: **retention**. Nothing is purged automatically. Erasure clears
a patient's search history on request, but a patient who never asks keeps one
forever.

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
