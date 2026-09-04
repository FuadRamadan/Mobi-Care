---
name: Patient profile completion
description: Rules for persistent patient photos, immutable identity fields, and the registration-completion prompt.
---

Treat the server profile as authoritative: DOB is supplied only at registration, age is derived from DOB, and profile completion requires address, email, and nationality while NIN remains optional. Patient photos belong in private object storage and are viewed through short-lived signed URLs.

**Why:** Client-only completion flags can permanently hide missing information after logout or device changes, and editable DOB/age would undermine eligibility checks. Local image files do not survive deployments or session changes.

**How to apply:** Query the authenticated profile after each fresh login. Show “Complete Your Registration” only when required fields are missing; “Not Now” may dismiss it for that login, but a later login must check again. Never accept DOB or age in profile updates.