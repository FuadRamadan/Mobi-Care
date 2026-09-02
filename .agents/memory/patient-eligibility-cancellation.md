---
name: Patient eligibility and cancellation
description: Safety rules for adult patient registration and customer-initiated order cancellation.
---

Patient self-registration requires an integer age of at least 18 at both the API boundary and database constraint. Patient order cancellation is allowed only while no courier is assigned and the order remains in a pre-dispatch status.

**Why:** Client-only age checks are bypassable, and cancellation racing with courier assignment can strand an active delivery or corrupt inventory.

**How to apply:** Keep adult eligibility authoritative on the server. Serialize cancellation on the order row, re-check courier assignment inside the transaction, and restore inventory when cancelling an order whose payment already deducted stock.