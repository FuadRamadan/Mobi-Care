# MobiCare production deployment on GoDaddy

## Hosting topology

MobiCare requires infrastructure that supports:

1. A continuously running **Node.js 22** application for the Express API.
2. Two static Vite sites: the patient/HQ gateway and Pharmacy Portal.
3. An external PostgreSQL database reachable through `DATABASE_URL`.
4. Durable private object storage for prescriptions, profiles, courier/team photos, and advertisements.
5. HTTPS on every public domain.

Use a GoDaddy VPS or another GoDaddy product that explicitly supports long-running Node.js processes. Standard PHP-only shared hosting is not sufficient. GoDaddy does not automatically provide PostgreSQL or object storage.

Recommended domains:

- `mobicare.example.com` — patient and HQ gateway
- `pharmacy.mobicare.example.com` — Pharmacy Portal
- `api.mobicare.example.com` — Express API

## Required software

- Node.js 22 LTS
- pnpm 10
- A reverse proxy such as Nginx
- A process manager such as systemd or PM2
- PostgreSQL 15 or later, managed externally

## Install and build

```bash
corepack enable
corepack prepare pnpm@10 --activate
pnpm install --frozen-lockfile
pnpm run typecheck
PORT=8080 BASE_PATH=/ VITE_API_URL=https://api.mobicare.example.com VITE_PUBLIC_URL=https://mobicare.example.com pnpm run build:production
```

Build outputs:

- API: `artifacts/api-server/dist/index.mjs`
- Gateway: `artifacts/mobicare-gateway/dist/public`
- Pharmacy Portal: `artifacts/pharmacy-portal/dist/public`

## Environment variables

Copy `.env.example` into the host's secret/environment manager. Never commit a populated `.env`.

Required in production:

- `NODE_ENV=production`
- `PORT` — normally assigned by the process manager/host
- `DATABASE_URL` — secret PostgreSQL URL, with TLS enabled
- `JWT_SECRET` — secret, at least 32 random bytes
- `SESSION_SECRET` — separate secret, at least 32 random bytes
- `ALLOWED_ORIGINS` — exact comma-separated HTTPS gateway and portal origins
- `SMS_TRANSPORT=orange`
- `VITE_API_URL` — public API origin used while building both web frontends
- `VITE_PUBLIC_URL` — public gateway origin used for canonical/social metadata
- `BASE_PATH` — `/` for domain-root hosting
- `EXPO_PUBLIC_DOMAIN` — API hostname used when building the mobile app

Optional:

- `LOG_LEVEL`
- `ORANGE_SMS_TIMEOUT_MS`
- `HQ_ADMIN_USERNAME`, `HQ_ADMIN_PASSWORD`, `HQ_ADMIN_NAME` for one-time bootstrap only
- `TEST_API_BASE_URL`, `ORANGE_SMS_TEST_RECIPIENT` for non-production tests only

Orange credentials are managed through MobiCare's encrypted HQ API Connections feature rather than source-code environment values.

## Database

1. Provision an external PostgreSQL database and require TLS.
2. Back up the source database before moving production data.
3. Set `DATABASE_URL`.
4. Run migrations once as a controlled release step:

   ```bash
   pnpm run migrate
   ```

5. Start the API. Startup intentionally fails if required schema elements are missing.

Do not run `push-force` in production. The current SQL migration runner is intended for a fresh database or a controlled database whose migration state is known. Take a backup and test restoration before every production migration.

## Object storage — required manual migration

The current project was developed with Replit App Storage. GoDaddy does not provide that service or its signing sidecar. Before switching traffic, choose durable private object storage (for example an S3-compatible provider), migrate every referenced object, and replace the Replit storage adapter in `artifacts/api-server/src/lib/objectStorage.ts`.

The migration must include:

- Prescription images
- Patient profile images
- Courier photos
- HQ team photos
- Advertisement images and videos

Prescriptions must remain private and application-authorized. Do not make the bucket public. Verify object count, size, content type, and checksums before updating database object keys. Production launch is blocked until upload, download, authorization, deletion, restart persistence, and backup restoration have been tested against the chosen provider.

## Start command

```bash
NODE_ENV=production pnpm start
```

The API binds to `0.0.0.0:$PORT`, validates the database schema before accepting traffic, and handles `SIGTERM`/`SIGINT` gracefully.

Health check:

```text
GET https://api.mobicare.example.com/api/health
```

Expected response:

```json
{"status":"ok"}
```

## Reverse proxy, CORS, and HTTPS

- Route `api.mobicare.example.com` to the API process on `$PORT`.
- Serve each Vite `dist/public` directory as static files.
- Configure SPA fallback so unknown gateway/portal routes return `index.html`.
- Forward `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`.
- Redirect HTTP to HTTPS.
- Set `ALLOWED_ORIGINS` to the exact HTTPS origins. Never use `*` with credentials.
- Add DNS A/AAAA records only after the API and both static sites pass staging checks.

## Authentication and secrets

- Never expose `DATABASE_URL`, `JWT_SECRET`, `SESSION_SECRET`, bootstrap credentials, or provider credentials to Vite/Expo variables.
- Only `VITE_*` and `EXPO_PUBLIC_*` values are intentionally client-visible.
- Rotate bootstrap credentials after creating the first HQ administrator.
- Preserve the same signing secrets during a server restart; changing them invalidates active sessions and signed links.
- Use the existing generic API error responses; inspect detailed errors only in protected server logs.

## Verification checklist

1. `pnpm run typecheck`
2. `DATABASE_URL=<staging-url> pnpm --filter @workspace/api-server run test`

   Five of these tests exercise real database behaviour and connect on import,
   so `DATABASE_URL` must point at a reachable database whose schema is current.
   Without it those tests fail with `DATABASE_URL must be set`. Never point this
   at production — the suite writes data.

3. `pnpm run build:production`
4. `pnpm run migrate` against staging
5. Start with the production command and confirm `/api/health`
6. Test patient, pharmacy, and HQ sign-in/refresh/logout
7. Test search, checkout, payment recording, cancellation, dispatch, and delivery confirmation
8. Upload/read/delete every supported media type and confirm persistence after restart
9. Confirm Pharmacy/HQ financial totals reconcile to patient payments
10. Verify CORS rejects an unlisted origin
11. Verify no secrets appear in browser bundles, responses, or logs
12. Test PostgreSQL and object-storage backup restoration

## Common errors

- **API exits during startup:** check `DATABASE_URL`, TLS requirements, and run the controlled migrations.
- **CORS error:** ensure the browser origin exactly matches an entry in `ALLOWED_ORIGINS`.
- **Frontend calls its own domain:** rebuild with `VITE_API_URL=https://api...`.
- **Deep links return 404:** enable SPA fallback to `index.html`.
- **Uploads fail outside Replit:** the required external object-storage adapter/migration is incomplete.
- **502 from proxy:** confirm the process is running, `$PORT` is forwarded, and the API listens on `0.0.0.0`.
- **Sessions fail after restart:** restore the same `JWT_SECRET` and `SESSION_SECRET`.
- **Mobile cannot connect:** rebuild with the production `EXPO_PUBLIC_DOMAIN` hostname.

## Manual GoDaddy actions still required

- Select/provision Node-capable VPS hosting.
- Provision external PostgreSQL and object storage.
- Supply secret values in the host, not in source control.
- Migrate database rows and stored objects with verified backups.
- Configure process supervision, Nginx, DNS, SSL certificates, and SPA fallbacks.
- Build/sign/release the Expo mobile application through the appropriate app stores.