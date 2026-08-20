---
name: Authenticated query caching
description: Safe use of positive client-cache freshness windows with account-scoped data.
---

When a browser or mobile app uses a shared React Query client for protected data, clear that client before accepting a new authenticated identity and whenever logout or token-refresh failure clears the active session.

**Why:** Query keys from generated API clients may not include an account identifier. A positive `staleTime` can otherwise treat the previous account's protected results as fresh and render them briefly for the next account.

**How to apply:** Keep the cache clear in every auth provider's successful login/session-restore, logout, and failed-refresh paths. Retain explicit polling and invalidation for live data within an active session.