---
name: Delivery receipt ownership
description: Authority boundary for completing MobiCare delivery orders.
---

HQ and dispatch may move a delivery into `delivering` only after the pharmacy has recorded the assigned courier handoff. Courier assignment alone is not enough. HQ must never set it to `delivered`; only the authenticated customer who owns the order may confirm receipt while it is in `delivering`.

**Why:** Delivery completion represents the customer's acknowledgement that the medicines are physically in their hands. Allowing HQ to assert receipt defeats that trust boundary and can prematurely trigger completed-order reporting and settlement workflows.

**How to apply:** Enforce `assigned → pharmacy collected/picked_up → delivering` server-side, not only in the UI. Any future HQ, courier, automation, callback, or bulk feature must stop at `delivering`; keep final confirmation scoped to the owning patient.