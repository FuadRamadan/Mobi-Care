---
name: Patient experience layer
description: Durable decisions behind the /app patient section — SPA token selection, prescription-upload ledger, and bounded stock reservations.
---

- One SPA hosts marketing, `/hq/*`, and `/app/*` with two independent auth sessions. The api-client's single global token getter is path-aware (portalToken module). **Why:** a static getter leaks one portal's token into the other's requests. **How to apply:** any new authenticated surface on the gateway must register its path + storage keys there, never call `setAuthTokenGetter` itself.
- Never trust a client-supplied prescription imageKey: uploads are a single-use, patient-owned ledger consumed inside the order transaction. **Why:** review found any string satisfied the tier-1/2 prescription requirement.
- Unpaid orders reserve stock only for a bounded payment window (15 min); expiry cancels + restocks, lazily on create/pay plus a timer sweep, and payment conditionally requires an unexpired order. **Why:** completion review rejected unbounded reservations as an inventory-depletion abuse vector. **How to apply:** any future flow that decrements stock before payment must reuse this expiry mechanism.
- Generated GET hooks require an explicit `queryKey` (via the exported `get<Name>QueryKey()` helpers) whenever any `query` option is passed.
