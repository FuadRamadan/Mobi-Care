---
name: Patient pricing contract
description: Durable rules for checkout totals and financial reconciliation across patient, pharmacy, and HQ surfaces.
---

Patient checkout is the sum of pharmacy drug prices plus a fixed 5% MobiCare service fee, rounded once at the order level in minor units. Do not add a separate hidden delivery charge. The legacy commission-named snapshot fields may remain for compatibility, but they represent the service fee.

**Why:** The final product specification requires the displayed amount, charged amount, pharmacy earnings, platform share, and settlement totals to reconcile exactly. A stale pharmacy price must never let an automatically paid order differ from the amount the patient approved.

**How to apply:** Calculate and persist immutable minor-unit snapshots, require the client’s displayed total when creating an order, recheck prices while locking inventory in the creation transaction, and derive reports from those snapshots without integer-Leone truncation.