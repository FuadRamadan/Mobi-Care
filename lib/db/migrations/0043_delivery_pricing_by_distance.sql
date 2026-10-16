-- Delivery is priced by distance instead of by zone. Zones stay, but only to
-- name areas for dispatch and reports; they no longer set the fee or decide
-- where MobiCare delivers. A maximum distance does that now.
--
--   fee   = fuel there and back + pickup + service rate × km, rounded up
--   rider = all the fuel + rider share % of the rest (orders.courier_payout_minor)
--
-- Like zone fees, a change is a new row starting at the next midnight.

CREATE TABLE IF NOT EXISTS delivery_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fuel_price_per_litre numeric(12, 2) NOT NULL,
  km_per_litre numeric(8, 2) NOT NULL,
  pickup_leones numeric(12, 2) NOT NULL,
  service_rate_per_km numeric(12, 2) NOT NULL,
  rider_share_percent numeric(5, 2) NOT NULL,
  round_to_leones numeric(12, 2) NOT NULL,
  minimum_fee_leones numeric(12, 2) NOT NULL,
  max_km numeric(8, 1),
  effective_from timestamptz NOT NULL,
  created_by_hq_staff_id uuid REFERENCES hq_staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_pricing_km_per_litre_positive CHECK (km_per_litre > 0),
  CONSTRAINT delivery_pricing_rider_share_range CHECK (rider_share_percent >= 0 AND rider_share_percent <= 100)
);
CREATE INDEX IF NOT EXISTS delivery_pricing_effective_idx ON delivery_pricing (effective_from);

-- The starting numbers, in force from the moment this is deployed: Le 40 a
-- litre, ~40 km a litre, pickup Le 20, Le 4 per km, rider 40% of the service,
-- rounded up to Le 5, delivery up to 15 km.
INSERT INTO delivery_pricing (fuel_price_per_litre, km_per_litre, pickup_leones, service_rate_per_km, rider_share_percent, round_to_leones, minimum_fee_leones, max_km, effective_from)
SELECT 40, 40, 20, 4, 40, 5, 0, 15, '2000-01-01T00:00:00Z'
WHERE NOT EXISTS (SELECT 1 FROM delivery_pricing);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_distance_km numeric(8, 1);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_distance_method text;
