---
name: Email recovery invariants
description: Security rules that keep patient email OTP recovery non-enumerable, rate-limited, and unambiguous.
---

Password-recovery ledgers for unknown or inactive emails must record and lock failed OTP attempts exactly like ledgers for real accounts. Never branch on account ownership before applying attempt accounting.

**Why:** Returning a different status at the failure limit creates an account-enumeration oracle even when the initial request response is generic.

**How to apply:** Generate the same hashed recovery record for every syntactically valid email, increment attempts for every record, and only check patient ownership after a correct OTP comparison.

Per-email and requester/IP rate limits must use independent exact database counts while both buckets are transactionally locked. Do not count rows from a capped combined `OR` query.

**Why:** Unrelated newer rows can crowd a target bucket out of a limited mixed result and bypass the intended limit.

**How to apply:** Acquire deterministic advisory locks for both buckets, query each count separately inside the request window, and query the email's latest request separately for cooldown enforcement.

Email recovery requires a unique normalized email-to-patient mapping.

**Why:** A non-unique mutable identifier makes password reset selection ambiguous and can target an unintended account.

**How to apply:** Normalize email on profile writes, enforce case-insensitive trimmed uniqueness in PostgreSQL, and return a clear conflict rather than allowing duplicates.