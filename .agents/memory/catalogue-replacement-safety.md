---
name: Catalogue replacement safety
description: Rules for safely replacing the governed master drug catalogue from variant-based source files.
---

Catalogue source files may contain one row per dispensable strength/form, while MobiCare stores one master row per generic drug with arrays of forms and strengths. Aggregate and deduplicate variants before import, applying the strictest tier when variants disagree.

**Why:** Catalogue rows are referenced by pharmacy inventory and historical order items. Hard-deleting or blindly replacing them can break foreign keys, hide valid stock, or destroy traceability.

**How to apply:** Update matching medicines in place where possible. Remap obvious legacy aliases to the new canonical row before deleting the alias. Retire unmatched referenced rows and deactivate their inventory; delete only rows with no inventory or order references. For data-only resets that preserve the catalogue, use dependency-ordered `DELETE` statements—never `TRUNCATE ... CASCADE`. PostgreSQL truncation cascades through foreign keys even when their row-delete rule is `SET NULL`, so truncating pharmacy or HQ account tables can also empty the catalogue.