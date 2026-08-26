# Prompt: Build the Pharmacy Phase (Backend + Database)

Copy everything below into a new Claude (or Claude Code) conversation to kick off this phase.

---

I'm building **MobiCare**, a medicine-delivery and pharmacy platform for Sierra Leone. The landing/gateway page is done. Now I want to build out the **Pharmacy phase**: a dedicated backend and its own PostgreSQL database for the pharmacy portal, matching the frontend I already have.

## What already exists — don't touch the frontend

I have a **complete, working pharmacy-portal frontend** (`pharmacy-portal/`) — a no-build SPA (React 18 + htm, vendored, no bundler) with these screens: **login, orders, inventory, prescriptions, notifications, change password**. It currently talks to a shared API. I want you to build this phase's **backend and database only** — don't rewrite the frontend. If the frontend needs a genuinely necessary change (a field it expects but nothing sensible can supply), flag it explicitly rather than silently adding one.

## The exact API contract the frontend expects

This is what `src/api.js` in the frontend already calls — your backend must satisfy this contract:

**Auth**
- `POST /auth/login` — body `{ identifier, password }` (identifier is username or phone), no bearer token. Returns `{ accessToken, refreshToken, user }`.
- `POST /auth/refresh` — body `{ refreshToken }`, no bearer token. Returns a fresh token pair.
- `POST /auth/change-password` — body `{ currentPassword, newPassword }`, authenticated.
- `POST /auth/logout` — body `{ refreshToken }`.
- Frontend expects short-lived access tokens + long-lived refresh tokens, with automatic single-retry-on-401 refresh already implemented client-side.
- No self-registration for pharmacies — accounts are issued by HQ (this portal only consumes that, doesn't create accounts).

**Orders** (`/pharmacy/orders`)
- `GET /pharmacy/orders?status=...` (status optional filter)
- `PATCH /pharmacy/orders/:id/status` — body `{ status }`
- `POST /pharmacy/orders/:id/collected` — body `{ idChecked: true }`
- `POST /pharmacy/orders/:id/picked-up`
- **Order status lifecycle the frontend enforces:** `awaiting_payment → paid → confirmed → packaging → ready → assigned → picked_up → delivering → delivered` (delivery path) or `ready → collected` (collection path), plus `cancelled`. The pharmacy only drives `paid → confirmed → packaging → ready`; everything after `ready` for deliveries is driven by dispatch/courier, not the pharmacy.
- Orders need drug and patient context embedded in the response (name, quantity, price, patient contact) — the frontend renders this directly, it doesn't make follow-up calls.

**Inventory & catalogue**
- `GET /pharmacy/inventory` — this pharmacy's own listings only.
- `GET /pharmacy/catalogue` — the master drug catalogue, used to populate the "add listing" picker.
- `POST /pharmacy/catalogue` — a pharmacy can *propose* a drug not yet in the catalogue; response indicates whether it's usable immediately or held for HQ review. **HQ owns the tier assignment, not the pharmacy.**
- `POST /pharmacy/inventory` — add a listing against a catalogue drug.
- `PATCH /pharmacy/inventory/:id` / `DELETE /pharmacy/inventory/:id`
- Tier 1 (controlled) drugs need a flag so the frontend can show "only pharmacies authorised by MobiCare HQ can list it" — your schema needs a per-pharmacy controlled-substance authorization concept.

**Prescriptions**
- `GET /pharmacy/prescriptions?status=...`, `GET /pharmacy/prescriptions/:id`
- `POST /pharmacy/prescriptions/:id/approve` — body `{ approvedDrugIds }` (a subset of the drugs on the prescription; anything omitted is not authorised).
- `POST /pharmacy/prescriptions/:id/reject` — body `{ reason, note }`. **Reason must come from a fixed enum the API enforces** (illegible image is one of them — check `docs/05-controlled-substances-policy.md` in the reference repo I'm giving you for the full list, and keep it a closed set, not free text).
- `POST /prescriptions/:id/image-url` — body `{ variant }` (`"preview"` default, `"full"` for the original) — mints a short-lived signed URL to the (encrypted) prescription image. Don't serve raw image bytes from a general endpoint; this must stay a signed, expiring URL.

**Notifications**
- `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/mark-read`

## Security requirements — non-negotiable

- **Isolation is enforced by the token, never by anything the client sends.** Every `/pharmacy/*` route must scope data to the authenticated pharmacy's own records server-side — don't trust a pharmacy ID passed in a request body or query string.
- Reject non-pharmacy-role tokens on every `/pharmacy/*` route (defense in depth — the frontend's own role check is not the real boundary).
- **CORS must be configured correctly** for the portal's actual origin(s) — the frontend is a separate deployed app calling this API cross-origin.
- Prescription images are sensitive — encrypted at rest, only ever served via short-lived signed URLs, never a permanent public path.

## Database

Use **PostgreSQL**, as its own dedicated database for this phase (consistent with the per-portal-database direction we're building toward for the whole platform). Design the schema to cover: pharmacy accounts/credentials, orders (with the full status lifecycle above), inventory listings tied to a shared drug catalogue, prescriptions (with approval/rejection state and the fixed reject-reason enum), controlled-substance authorization per pharmacy, and notifications.

**Flag clearly which of these entities are genuinely pharmacy-owned versus which ones this phase only needs read access to** — the drug catalogue, patient identity/contact info on orders, and dispatch/courier status past "ready" all sound like they belong to the patient app or HQ's data, not the pharmacy database. Tell me your recommended way to get this pharmacy backend an accurate, current view of that data (call another service's API, a shared read replica, a sync job, etc.) rather than duplicating it as pharmacy-owned data that can drift out of date. This is the same cross-database consistency question from the full-platform build — this phase's job is to answer it concretely for the pharmacy's needs.

## What I want from you first

Before writing code: (1) your proposed schema for the pharmacy's own database, (2) your recommended approach for the data this phase needs but doesn't own (catalogue, patient info, dispatch status), and (3) confirmation you'll test the full path — login → real read → real write for orders, inventory, and prescriptions — against the actual frontend before calling it done, and report what you verified.
