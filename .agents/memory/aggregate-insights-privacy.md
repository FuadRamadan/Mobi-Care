---
name: Aggregate insights visibility and privacy
description: Rules for complete HQ metrics while keeping search telemetry access controlled and purpose-limited.
---

Do not suppress low-volume HQ metrics: totals, time buckets, pharmacies, areas, categories, tables, charts, and exports must include counts of one and zero-filled days where applicable.

**Why:** MobiCare explicitly requires complete operational reconciliation; hidden low-count rows make displayed detail disagree with reported totals.

**How to apply:** Return every authorized row without “Other” bucketing or count thresholds, paginate genuinely long lists, and render explicit empty states. Keep search telemetry purpose-limited, protect HQ access with live permissions, and audit views/exports.