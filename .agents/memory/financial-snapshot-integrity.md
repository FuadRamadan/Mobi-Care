---
name: Financial snapshot integrity
description: Durable rules for immutable order pricing, settlement idempotency, and legacy payout reconciliation.
---

Treat the exact patient line total as authoritative when basis-point rounding cannot be represented by one integer unit price. Allocate order-level rounding remainders deterministically so line totals always sum to the immutable order total.

**Why:** Multiplying a rounded unit price by quantity can disagree with the order total by minor units, which breaks invoices and settlement reconciliation.

**How to apply:** Persist and expose exact line totals; derive displayed line commission from exact patient line total minus base line total. Keep settlement generation protected by database uniqueness, not application checks alone.

Patients pay each pharmacy directly for the pharmacy drug amount plus a fixed 5% service fee. The pharmacy holds the gross payment and owes that service fee to MobiCare; platform revenue is commission only, never gross patient spend.

**Why:** Treating gross patient payments as MobiCare revenue or modeling pharmacy payouts reverses the real money flow and materially overstates platform income.

**How to apply:** Snapshot base drug amount, service-fee rate/amount, and patient total on every order. Generate one idempotent daily commission settlement per pharmacy/business day and record payments or corrections append-only.

Preserve pre-snapshot financial obligations using an immutable rollout provenance marker captured when snapshots are introduced.

**Why:** Configurable values such as a 0% markup can legitimately occur after rollout and cannot safely distinguish historical rows from current snapshots.

**How to apply:** Any legacy financial backfill must be one-time, bounded by the persisted rollout marker, and constrained by the complete legacy row shape. Never infer legacy status from one mutable setting.