---
name: Password-manager handoff
description: Privacy boundary for browser and native password-manager integration after a patient password reset.
---

After a successful password reset, the phone-number username and new password may remain briefly in the live sign-in form so the browser or operating system can offer its own save/update UI. Never copy the plaintext password into application-managed persistent storage, logs, analytics, or a custom vault.

**Why:** Password managers need the successful credential context to recognize an async reset, but MobiCare must leave storage and consent entirely to the platform.

**How to apply:** Mark phone identifiers as usernames, distinguish current/new/confirmation password fields, mark recovery codes as one-time codes, and clear credentials through normal form/session lifecycle rather than persisting them.