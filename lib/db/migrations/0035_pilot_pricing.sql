-- Pilot pricing (decided 6 October 2026): patients pay no service fee; the
-- pharmacy pays a 5% commission on each sale; delivery fees go to MobiCare,
-- which pays the couriers.
--
-- When the patient pays the pharmacy directly, the pharmacy now owes MobiCare
-- its 5% commission plus the delivery fees it collected. The delivery fees are
-- kept apart from the commission so both stay visible. Existing settlements
-- owed no delivery fees, so they start at 0 and their balances don't change.
ALTER TABLE commission_settlements ADD COLUMN IF NOT EXISTS delivery_fees_due_minor integer DEFAULT 0 NOT NULL;
