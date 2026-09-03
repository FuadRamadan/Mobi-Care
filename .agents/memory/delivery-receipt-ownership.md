---
name: Delivery receipt ownership
description: Authority boundary for completing MobiCare delivery orders.
---

HQ and dispatch may move a delivery into `delivering` only after the pharmacy has recorded the assigned courier handoff. Courier assignment alone is not enough. Once delivering, the owning patient normally confirms receipt, while HQ may use the explicit backup confirmation only when the patient cannot confirm.

**Why:** Delivery completion normally represents the customer's acknowledgement, but operations need a controlled recovery path for a delivered order when the patient is unavailable. The HQ fallback must be deliberate, auditable, and limited to an already-delivering delivery.

**How to apply:** Enforce `assigned → pharmacy collected/picked_up → delivering` server-side, not only in the UI. Patient confirmation and HQ backup confirmation must both require current `delivering` plus delivery fulfillment; HQ confirmation records the staff actor and method in the order and audit trail.