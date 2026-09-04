---
name: Stale workflow bundles
description: Distinguish a stale running API bundle from a genuine development database schema mismatch.
---

After task merges or broad workspace updates, rebuild and restart the canonical API before diagnosing a “column does not exist” error against the current source schema.

**Why:** A long-running API process can still contain a previously bundled Drizzle schema even when the checked-in schema no longer references that column. Running migrations or schema push against the current code will not repair a query emitted only by the stale bundle.

**How to apply:** Compare the failing SQL columns with the current schema file first. If current source does not reference them, restart the canonical API and repeat the request before attempting any database mutation.