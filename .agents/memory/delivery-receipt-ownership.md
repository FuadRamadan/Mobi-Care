---
name: Delivery receipt ownership
description: Authority boundary for completing MobiCare delivery orders.
---

HQ and dispatch may move an assigned or picked-up delivery into `delivering`, but they must never set it to `delivered`. Only the authenticated customer who owns the order may confirm receipt, and only while that delivery is in `delivering`.

**Why:** Delivery completion represents the customer's acknowledgement that the medicines are physically in their hands. Allowing HQ to assert receipt defeats that trust boundary and can prematurely trigger completed-order reporting and settlement workflows.

**How to apply:** Any future courier, pharmacy, HQ, automation, callback, or bulk-order feature must stop at `delivering`. Keep the final conditional transition scoped to the owning patient, the delivery fulfillment type, and the current `delivering` status.