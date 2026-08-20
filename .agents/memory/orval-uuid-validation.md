---
name: Orval UUID validation
description: Generator-compatible UUID constraints for this workspace's OpenAPI and Zod versions.
---

Use an anchored UUID regex in OpenAPI string schemas that must be validated by generated Zod code; do not use `format: uuid` while this workspace remains on Zod v3.

**Why:** The current Orval generator emits `zod.uuid()` for `format: uuid`, but that API belongs to Zod v4. Code generation succeeds and the subsequent TypeScript build fails because this workspace intentionally uses Zod v3.

**How to apply:** For UUID path or input validation, keep runtime Zod validation and express the contract constraint with `pattern`. Regenerate both API clients and run the library typecheck after every contract change.

After code generation, restart any Vite workflows that import the generated client. Orval cleans the generated output directory before rewriting it, so active dev servers can briefly see missing modules and retain an incompatible hot-reload context.

**Why:** A browser session that survived client regeneration displayed a false `useAuth must be used within AuthProvider` boundary even though the provider tree was correct; the same flow passed in a fresh browser, and a workflow restart cleared the stale module graph.

**How to apply:** Restart the Gateway and Pharmacy Portal after Orval runs. If a browser was open during generation, hard-refresh it before diagnosing provider or hook errors as application bugs.