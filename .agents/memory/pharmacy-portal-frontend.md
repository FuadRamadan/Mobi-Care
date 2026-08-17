---
name: Pharmacy portal frontend
description: Key facts about the pharmacy-portal React/Vite artifact — auth wiring, logo, CSS, API proxy, and hook conventions.
---

# Pharmacy portal frontend

## Artifact
`artifacts/pharmacy-portal` — preview path `/pharmacy-portal/`.

## Auth wiring
`setAuthTokenGetter(() => localStorage.getItem('mc_access'))` is called once in `App.tsx` at init. `AuthContext` (src/contexts/AuthContext.tsx) manages user state, login, logout, and silent token refresh. Token keys: `mc_access` (access JWT) and `mc_refresh` (opaque refresh token).

## API proxy (dev)
`vite.config.ts` proxies `/api/*` → `http://localhost:8080` so the frontend's generated hooks (which call `/api/...`) hit the API server during development. No env var needed for dev; for production configure via VITE_API_BASE_URL or a reverse proxy.

## Logo
Logo lives at `artifacts/pharmacy-portal/public/mobicare-logo.jpeg`. Reference in JSX as `{import.meta.env.BASE_URL}mobicare-logo.jpeg` — NOT as `/attached_assets/...` (absolute path doesn't work in the proxied sub-path mount) and NOT as a bare `/mobicare-logo.jpeg` (misses the BASE_URL prefix).

## CSS import order
Google Fonts `@import url(...)` MUST be the first line in `index.css`, before `@import 'tailwindcss'` and `@import 'tw-animate-css'`. PostCSS rejects it otherwise.

## Hook import convention
All hooks import from `@workspace/api-client-react` (never relative paths). Mutations use `mutation.mutate({ id, data: { ... } })` for path+body or `{ data: { ... } }` for body-only.

## Zod v3 / Orval codegen constraint
OpenAPI spec must NOT use `format: uuid` or `type: integer` — Orval generates Zod v4 methods (`zod.uuid()`, `zod.int()`) that don't exist in the workspace's Zod v3. Use `type: string` (no format) and `type: number` instead.

## Analytics endpoints
Added to API server at `GET /api/pharmacy/analytics/overview` and `GET /api/pharmacy/analytics/orders-by-day`. Source: `artifacts/api-server/src/routes/pharmacy/analytics.ts`. Must import schema tables as `ordersTable`, `pharmacyInventoryTable`, `prescriptionsTable` (not `orders`, `pharmacyInventory`, `prescriptions`).

## Pages built
/login, /dashboard (analytics overview + daily chart), /orders (list + status actions), /inventory (CRUD + pricing), /prescriptions (review queue + approve/reject), /profile (change password), /notifications (inbox + mark read)
