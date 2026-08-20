---
name: HQ notification ownership
description: Privacy and acknowledgement model for operational notifications shown to HQ staff.
---

HQ operational alerts must be stored and acknowledged per individual HQ staff account, rather than as a globally read/unread queue.

**Why:** Multiple staff may be monitoring orders at once. Marking an alert read in one person’s dashboard must not hide the incoming work from everyone else.

**How to apply:** Fan out new operational alerts to active HQ staff and always scope listing, unread counts, and read actions to the authenticated staff member. Use the same model for future HQ alert types.