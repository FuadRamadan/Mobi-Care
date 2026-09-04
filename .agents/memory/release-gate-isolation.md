---
name: Release gate isolation
description: Why stateful end-to-end checks attached to publishing must create their own local test services.
---

Stateful release checks that create or mutate records must provision their own temporary local database and storage, even when they run as a deployment pre-build hook.

**Why:** Replit deployment builds receive production-specific secrets and the production database context. Overriding `NODE_ENV` does not make an inherited production `DATABASE_URL` safe for destructive tests.

**How to apply:** Start an ephemeral local database on a private port, initialize the current schema and required seed settings, run the API and flow with generated test secrets, and tear down all child processes and files in `finally`. Require the child flow to receive an explicit wrapper-owned isolation handoff rather than supporting direct execution against development. The release hook may invoke that self-contained command because it never consumes the inherited production database.