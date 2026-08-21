---
name: Password expiry boundary
description: Security invariant for password-age enforcement across already-open pharmacy sessions.
---

Normal pharmacy password age must be checked on every authenticated pharmacy request. Once the maximum age is reached, the live account must transition to forced-change state before protected resources run. Voluntary changes are allowed only inside the warning interval below the deadline; expired credentials use the forced flow.

**Why:** Checking age only during login or refresh leaves a boundary gap where an already-open access-token session can cross the expiry deadline while still appearing normal. An unbounded warning-window condition can also accidentally treat every expired password as a voluntary change.

**How to apply:** Any authentication refactor must preserve live age evaluation before pharmacy role authorization, immediate client routing on the forced-change response, and an upper bound at the exact expiry deadline for voluntary password changes.