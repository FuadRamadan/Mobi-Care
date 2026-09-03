---
name: User removal and data exports
description: Safety boundaries for user-visible deletion, catalogue removal, and current-record CSV exports.
---

Notification deletion must always be scoped to the authenticated patient or pharmacy. Removing an order from a patient’s history is a visibility change allowed only for terminal orders; the underlying operational, audit, and financial record must remain intact.

**Why:** A user-facing cleanup action must not erase evidence needed for dispensing, delivery, settlements, reporting, or dispute resolution, and one account must never remove another account’s alerts.

**How to apply:** Enforce ownership in each delete query, hide rather than delete patient orders, and keep history visibility independent of pharmacy and HQ order access.

Catalogue removal must physically delete only unreferenced drugs. Referenced drugs and their active inventory listings must instead be retired so historical order lines and inventory relationships remain valid.

**Why:** Catalogue rows are protected by operational references; forcing a hard delete would either fail or destroy traceability.

**How to apply:** Check inventory and order references inside the same transaction as removal. Retire referenced rows and deactivate linked inventory; hard-delete only when no references exist.

Current-record exports are read-only snapshots and require the existing HQ Data & Insights permission. They must query live database state, audit each download, and protect CSV consumers from formula injection.

**Why:** Exports can contain identifiable operational records and must neither bypass authorization nor mutate source data.

**How to apply:** Keep exports behind the live permission middleware, never export password or credential fields, quote values safely, and record the resource and row count in the audit trail.