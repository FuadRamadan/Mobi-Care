---
name: Courier retirement
description: Integrity rules for removing couriers without damaging active or historical delivery records.
---

“Delete Courier” is a soft retirement: hide the courier from fleet and assignment views, mark them inactive, and retain their database row for historical order and settlement attribution. A courier with an active assigned, picked-up, or delivering order cannot be retired.

**Why:** Physical deletion can erase operational history, violate settlement references, or race with assignment and leave an active order pointing to a missing courier.

**How to apply:** Any future courier-removal or assignment path must exclude retired couriers and serialize assignment against retirement on the same courier record. Historical reads may still resolve retired courier details.