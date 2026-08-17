# MobiCare Gateway

The unified front door for MobiCare, a medicine-delivery and pharmacy platform for Sierra Leone — a lightweight, mobile-first site that explains MobiCare and routes patients, partner pharmacies, and HQ staff to their existing external portals via links.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/mobicare-gateway/` — the gateway site (frontend-only, no backend calls)
- `artifacts/mobicare-gateway/src/config/portals.ts` — the ONE place to set the real portal URLs (patient app, pharmacy portal, HQ dashboard) and the partner contact email; placeholders until the user supplies real URLs
- Pages: `/` landing, `/patient`, `/pharmacy`, `/hq` (wouter routes in `src/App.tsx`)

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

- Landing page presenting the three portal entry points (HQ visually de-emphasized), "how it works", trust/honesty highlights, and the three medicine tiers
- `/patient` pitch + CTA to the patient app (installable PWA note); `/pharmacy` partner pitch (no self-registration, HQ issues credentials, partner contact path); `/hq` minimal login link
- Non-negotiable honesty points appear on landing/patient/pharmacy pages: payment only marked paid after provider confirmation; "a licensed pharmacist reviews yours"; controlled medicines are collection-only with in-person ID check; three medicine tiers described accurately
- Brand: greens #1A8F6E/#0B3D2E, terracotta #D85A30, Orange Money #FF6600 only in payment contexts; currency `Le 1,955` style; warm plain-spoken tone

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
