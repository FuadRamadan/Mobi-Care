---
name: HQ oversight layer
description: How MobiCare HQ auth, routes, and dashboard are structured across api-server and mobicare-gateway
---

- Shared login: `/api/auth/login` tries pharmacy then `hq_staff`; JWT role `"pharmacy" | "hq"`; HQ refresh tokens live in a separate `hq_refresh_tokens` table. Login response `user.role` distinguishes them.
- All HQ API routes are grouped under `/api/hq/*` behind `hq = [requireAuth, requireHqRole]`; add new HQ endpoints inside `routes/hq/` so they inherit the guard.
- No HQ self-registration by design. The api-server `bootstrap-hq` package script creates or synchronizes the configured admin from HQ_ADMIN_USERNAME/PASSWORD/NAME, resets its password, reactivates it, and grants HQ admin permissions without logging secret values.
- "Held" drugs are `isApproved: false` on drug_catalogue (no separate status enum); Tier-1 drugs must carry `maxUnitsPerOrder ≥ 1`, validated on the resulting record in PATCH.
- Audit: use `writeAudit()` (never throws) in every mutating handler; fraud flags via `checkOrderFlags()` on order status changes.
- Gateway serves both the public site and the HQ dashboard: `/hq*` routes render bare (Layout returns minimal shell for paths starting with `/hq`); HQ tokens use distinct localStorage keys `mc_hq_access`/`mc_hq_refresh` so pharmacy-portal sessions don't collide.
- **Generated API client returns unwrapped payloads** (no `{status,data}` envelope) and throws on errors — do not write `res.status === 200` checks against hook data in gateway code.
