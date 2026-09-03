---
name: Pharmacy backend
description: Key facts about the pharmacy API server — routes, schema, auth, known quirks.
---

# Pharmacy backend

## What was built
`artifacts/api-server` now has the full pharmacy phase. Schema is in `lib/db/src/schema/` (8 files), routes in `artifacts/api-server/src/routes/`.

## Auth pattern
- Access token: JWT HS256, 15 min. Secret in `JWT_SECRET` env var (shared, dev value set; must be rotated before production).
- Refresh token: opaque 96-char hex, stored as SHA-256 hash in `refresh_tokens` table. Rotation on every refresh. All tokens revoked on password change.
- Middleware: `requireAuth` + `requirePharmacyRole` exported as `pharmacy` tuple from `middlewares/auth.ts`. Spread with `...pharmacy` — the tuple is `readonly` so `router.use(pharmacy)` fails.

## Route layout
- `POST /api/auth/login|refresh|change-password|logout`
- `GET|PATCH|POST /api/pharmacy/orders(/:id/status|collected|picked-up)`
- `GET|POST|PATCH|DELETE /api/pharmacy/inventory(/:id)`
- `GET|POST /api/pharmacy/catalogue`
- `GET|POST /api/pharmacy/prescriptions/:id(/approve|reject|image-url)`
- `GET|POST /api/notifications(/unread-count|/mark-read)`
- `GET /api/prescription-images/:id` (verifies HMAC signed URL; returns 501 until object store is wired)

## Order status — pharmacy writes only
Pharmacy may only transition: `paid→confirmed→packaging→ready`. In-person collection uses `POST /:id/collected {idChecked:true}`. After HQ assigns a courier, the pharmacy must record the delivery handoff through `POST /:id/picked-up`; only then may HQ advance it to delivering.

## Prescription reject reasons (closed enum)
`illegible_image | expired_prescription | invalid_prescription | drug_unavailable | controlled_substance_not_authorized | patient_mismatch | quantity_exceeded`. Never accept free text.

## Known quirks
- `health.ts` has `router.get("/")` NOT `router.get("/healthz")` — the mount point in `routes/index.ts` is `/healthz`, so `/api/healthz` is the external path. Do not add `/healthz` again inside the file.
- `zod` must be imported as `"zod"` not `"zod/v4"` — workspace catalog pins zod v3.
- `JWT_SECRET` is typed `string|undefined` from `process.env` — assign to `const SECRET: string = JWT_SECRET` after the throw guard before passing to `jwt.sign/verify`.
- `req.params.id` is `string|string[]` in Express 5 types — cast with `const id = req.params.id as string`.
- `readonly` middleware tuple: `export const pharmacy = [...] as const` must be spread `...pharmacy` in `router.use()`.

## Cross-service data ownership
Drug catalogue: local copy in this phase, flagged. In production → read replica or HQ API.
Patient info on orders: embedded snapshot. In production → provided by patient service at order creation.
Dispatch status past `ready`: driven externally; pharmacy only reads it.

## Object storage
Prescription images: signed URL mechanism built (`lib/signedUrl.ts`), verification route built (`/api/prescription-images/:id`), but actual image bytes not served — 501 until S3/GCS with SSE-KMS is wired.

**Why:** prescription images are sensitive — encrypted at rest, short-lived signed URLs only.
