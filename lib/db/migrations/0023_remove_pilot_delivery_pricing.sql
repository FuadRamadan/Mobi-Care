-- Remove the delivery pricing figures.
--
-- MobiCare charges no delivery fee during the pilot: there is no agreement with
-- a delivery company yet, riders are hired locally and paid outside the
-- platform, and patients are quoted prices by hand. The two settings written by
-- migration 0013 (Le 25,000 delivery fee, Le 20,000 courier payout) were never
-- read at checkout — every order is written with delivery_fee_minor = 0 and
-- courier_payout_minor = 0 — so they were figures nobody had set and nobody
-- honoured. Leaving them would invite someone to build on numbers that mean
-- nothing.
--
-- The orders columns stay. They are NOT NULL DEFAULT 0 and already hold 0 on
-- every row, so they cost nothing and are the natural place for real delivery
-- pricing once a partner is contracted; dropping and re-adding them later would
-- lose the history of orders that ran fee-free.

DELETE FROM platform_settings
WHERE key IN ('delivery_fee_minor', 'courier_payout_minor');
