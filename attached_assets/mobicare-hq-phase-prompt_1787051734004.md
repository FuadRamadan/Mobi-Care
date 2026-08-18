# Prompt: Build the HQ Phase (Backend + Database)

Copy everything below into a new Claude (or Claude Code) conversation to kick off this phase.

---

I'm building **MobiCare**, a medicine-delivery and pharmacy platform for Sierra Leone. The landing/gateway page and the pharmacy phase are in progress. Now I want to build out the **HQ phase**: a dedicated backend and its own PostgreSQL database for the HQ dashboard, matching the frontend I already have.

## What already exists — don't touch the frontend

I have a **complete, working hq-dashboard frontend** (`hq-dashboard/`) — the same no-build SPA stack as the pharmacy portal (React 18 + htm, vendored, no bundler). Screens: **login, dashboard (command centre), all-orders, dispatch, pharmacies, catalogue, couriers, flags, settlements, audit log**. It currently talks to a shared API. Build this phase's **backend and database only** — don't rewrite the frontend. If the frontend needs a genuinely necessary change, flag it explicitly rather than silently adding one.

## Read this first — HQ is different from the other two phases

Patient and pharmacy each mostly own their own slice of data. **HQ is the cross-cutting oversight layer — almost everything it needs is data that legitimately belongs to another portal**: every order (patient- and pharmacy-owned), every pharmacy's account and licensing status, the master drug catalogue, courier fleet and dispatch state, settlements, and a platform-wide audit log. If patient, pharmacy, and HQ each get their own database, **HQ's database is the one most likely to just be a read-heavy aggregation of the other two**, plus a small amount of data it genuinely owns outright (courier fleet, settlement records, the audit log itself, HQ staff accounts, drug tier assignments).

Before you design the schema: **tell me plainly which entities HQ should own outright versus which it only needs an accurate, current view of**, and propose your recommended way to get that view (calling the patient/pharmacy services' APIs, a shared read replica, an events/sync pipeline, etc.) — consistent with whatever approach gets chosen for the pharmacy phase, since HQ needs the same kind of access to pharmacy data that the sync design there will produce. Give me the trade-offs, don't just pick one silently.

## The exact API contract the frontend expects

This is what `src/api.js` in the frontend already calls — your backend must satisfy this contract:

**Auth**
- `POST /auth/login` — body `{ identifier, password }`, no bearer token. **Rejects any non-`hq` role.** Returns `{ accessToken, refreshToken, user }`.
- `POST /auth/refresh`, `POST /auth/change-password`, `POST /auth/logout` — same pattern as the pharmacy portal (short-lived access + long-lived refresh, client already retries once on 401).
- The first HQ account is created out-of-band (a bootstrap script), not through this API — don't build a self-registration path for HQ staff.

**Dashboard**
- `GET /hq/dashboard` — aggregate counts, a live order feed, and confirmed revenue. This is the one endpoint that's pure aggregation across everything else.

**Orders & dispatch**
- `GET /hq/orders?status=...` — every order across every pharmacy, not scoped to one pharmacy like the pharmacy portal's endpoint.
- `GET /hq/dispatch` — deliveries ready for courier assignment.
- `POST /hq/orders/:id/assign-courier` — body `{ courierId }`.
- `PATCH /hq/orders/:id/courier-status` — body `{ status }`. Courier-side statuses HQ drives: `assigned → delivering → delivered` (picking up from wherever the pharmacy phase leaves off at `ready`/`picked_up`).
- `POST /hq/orders/:id/cash-collected` — for cash-on-delivery reconciliation.

**Pharmacies**
- `GET /hq/pharmacies`
- `POST /hq/pharmacies` — onboards a new pharmacy and **returns a one-time temporary password** (this is the only way pharmacy accounts get created — no self-registration, per the pharmacy phase).
- `PATCH /hq/pharmacies/:id` — used for licence verification, `tier1Authorized` (boolean — gates whether that pharmacy can list Tier 1 controlled drugs), and `status` (`online`/`offline`).

**Catalogue**
- `GET /hq/drugs?tierStatus=...` — includes a `held` status for pharmacy-proposed drugs awaiting a tier assignment (see the pharmacy phase's `POST /pharmacy/catalogue`).
- `POST /hq/drugs` — add a drug directly. Tier 1 requires `maxUnitsPerOrder` (a units cap) — enforce this server-side, not just in the frontend form.
- `PATCH /hq/drugs/:id` — **this is what assigns/changes a drug's tier and releases a held (pharmacy-proposed) drug for sale.** HQ is the sole owner of tier assignment across the whole platform.

**Couriers**
- `GET /hq/couriers`, `POST /hq/couriers` — courier fleet is HQ-owned data, not shared.

**Flags**
- `GET /hq/flags?status=...` — a review queue for velocity/duplicate/payment anomalies.
- `PATCH /hq/flags/:id` — mark reviewed. Something (fraud/anomaly detection logic, likely event-driven off order activity) needs to actually populate this queue — don't leave it as a queue with nothing feeding it.

**Settlements**
- `GET /hq/settlements`, `PATCH /hq/settlements/:id` — pharmacy payouts, mark paid.
- `PATCH /hq/courier-settlements/:id` — separate settlement track for couriers.

**Notifications** — same shape as the pharmacy portal: `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/mark-read`.

**Audit**
- `GET /hq/audit` — filterable by entity, query params passed straight through. **Read-only, append-only.** Every write across the HQ API (and ideally the pharmacy and patient APIs too) should be generating entries here — this is a compliance/audit trail, so decide now how events reach this log (write directly from each mutating handler, or a shared audit-event pipeline) rather than treating it as an afterthought.

## Security requirements — non-negotiable

- Every `/hq/*` route rejects non-HQ-role tokens server-side — the frontend's login role check is defence in depth only, not the real boundary.
- HQ staff accounts, courier settlement data, and the audit log are sensitive — apply the same "never trust anything the client sends for scoping, only the token" rule used in the pharmacy phase.
- The audit log must be genuinely append-only at the database level (no update/delete path from the API), since its whole value is being tamper-evident.
- CORS configured correctly for the dashboard's actual deployed origin.

## Database

Use **PostgreSQL**, as its own dedicated database for this phase, consistent with the per-portal-database direction for the platform. Design the schema around what HQ genuinely owns (courier fleet, settlements, audit log, HQ staff accounts, drug tier decisions) and be explicit about everything else being a *view* onto pharmacy/patient data rather than a duplicated copy, per the "read this first" section above.

## What I want from you first

Before writing code: (1) your recommendation on what HQ's database should own outright vs. only view, with trade-offs, (2) how the flags queue gets populated and how the audit log gets written to consistently, (3) your proposed schema for what HQ does own, and (4) confirmation you'll test the full path — login → dashboard aggregate → an order status change → an audit entry appearing for it — against the actual frontend before calling it done, and report what you verified.
