---
name: Portal session initialization
description: Prevent authenticated portal routes from looping while restoring a saved session.
---

Session restoration that calls a React Query mutation must be explicitly one-time per mounted auth provider; do not depend on the whole mutation-result object in the initialization effect.

**Why:** Mutation result objects can change identity as React renders. Re-running initialization then writes auth state again, creating a maximum-update-depth loop that leaves protected routes stuck on their loading view.

**How to apply:** When restoring access/refresh tokens in an auth provider, use a stable mutation trigger or a ref guard before starting the async restore flow. Retest an authenticated route after changes to session or query-provider code.