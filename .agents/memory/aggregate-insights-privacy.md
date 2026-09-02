---
name: Aggregate insights privacy
description: Privacy boundary for HQ Data & Insights metrics, exports, and search telemetry.
---

Every potentially identifying aggregate must meet the minimum cohort threshold independently, including global totals, time buckets, named organizations, areas, categories, rates, and exports.

**Why:** Protecting only rankings still lets narrow date ranges reveal a single patient, pharmacy, search, or order through totals and trend buckets.

**How to apply:** Enforce suppression server-side for JSON and CSV, return null or omit under-threshold values, and keep UI explanations aligned with actual suppression. Store only recognized coarse districts for search telemetry, never patient IDs, sessions, IPs, or exact addresses. Protect access with a distinct live permission and audit every view/export.