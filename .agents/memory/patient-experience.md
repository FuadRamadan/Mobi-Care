---
name: Patient experience layer
description: Durable decisions behind the /app patient section — SPA token selection, prescription-upload ledger, and payment-time inventory deduction.
---

- One SPA hosts marketing, `/hq/*`, and `/app/*` with two independent auth sessions. The api-client's single global token getter is path-aware (portalToken module). **Why:** a static getter leaks one portal's token into the other's requests. **How to apply:** any new authenticated surface on the gateway must register its path + storage keys there, never call `setAuthTokenGetter` itself.
- Never trust a client-supplied prescription imageKey: uploads are a single-use, patient-owned ledger consumed inside the order transaction. **Why:** review found any string satisfied the tier-1/2 prescription requirement.
- Unpaid orders do not reserve stock. Payment atomically claims the awaiting order and conditionally deducts every exact inventory listing; any stock conflict rolls back the whole transaction. **Why:** checkout reservations made search stock inaccurate and enabled inventory depletion before payment. **How to apply:** keep checkout read-only for stock, reference exact inventory variants, and perform all deductions only inside the payment transaction.
- Generated GET hooks require an explicit `queryKey` (via the exported `get<Name>QueryKey()` helpers) whenever any `query` option is passed.
