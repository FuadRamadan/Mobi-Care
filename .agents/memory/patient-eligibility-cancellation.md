---
name: Patient eligibility and cancellation
description: Safety rules for DOB-based adult patient registration and customer-initiated order cancellation.
---

Patient self-registration requires an immutable date of birth. Age is calculated server-side from that DOB, must be at least 18, and is derived again for profile reads so it stays accurate after birthdays. Patient order cancellation is allowed only while no courier is assigned and the order remains in a pre-dispatch status.

**Why:** A client-entered age becomes stale and is bypassable; immutable DOB gives one authoritative eligibility source. Cancellation racing with courier assignment can strand an active delivery or corrupt inventory.

**How to apply:** Accept DOB only during registration, reject DOB/age in profile updates, and derive age server-side. Serialize cancellation on the order row, re-check courier assignment inside the transaction, and restore paid inventory on cancellation.