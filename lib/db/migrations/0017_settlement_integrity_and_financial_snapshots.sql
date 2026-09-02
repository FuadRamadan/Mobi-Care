-- Settlement generation is an idempotent financial operation.  Keep a
-- recoverable copy of any pre-constraint duplicate before retaining one
-- canonical settlement (a paid record wins; otherwise the earliest record).
CREATE TABLE IF NOT EXISTS settlement_duplicate_archive AS
  TABLE settlements WITH NO DATA;
ALTER TABLE settlement_duplicate_archive
  ADD COLUMN IF NOT EXISTS canonical_settlement_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY pharmacy_id, period_start, period_end
           ORDER BY (status = 'paid') DESC, paid_at NULLS LAST, created_at, id
         ) AS canonical_settlement_id,
         row_number() OVER (
           PARTITION BY pharmacy_id, period_start, period_end
           ORDER BY (status = 'paid') DESC, paid_at NULLS LAST, created_at, id
         ) AS rank
  FROM settlements
), archived AS (
  INSERT INTO settlement_duplicate_archive
  SELECT s.*, r.canonical_settlement_id, now()
  FROM settlements s
  JOIN ranked r ON r.id = s.id
  WHERE r.rank > 1
  RETURNING id
)
DELETE FROM settlements s USING archived a WHERE s.id = a.id;

CREATE TABLE IF NOT EXISTS courier_settlement_duplicate_archive AS
  TABLE courier_settlements WITH NO DATA;
ALTER TABLE courier_settlement_duplicate_archive
  ADD COLUMN IF NOT EXISTS canonical_settlement_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY courier_id, period_start, period_end
           ORDER BY (status = 'paid') DESC, paid_at NULLS LAST, created_at, id
         ) AS canonical_settlement_id,
         row_number() OVER (
           PARTITION BY courier_id, period_start, period_end
           ORDER BY (status = 'paid') DESC, paid_at NULLS LAST, created_at, id
         ) AS rank
  FROM courier_settlements
), archived AS (
  INSERT INTO courier_settlement_duplicate_archive
  SELECT s.*, r.canonical_settlement_id, now()
  FROM courier_settlements s
  JOIN ranked r ON r.id = s.id
  WHERE r.rank > 1
  RETURNING id
)
DELETE FROM courier_settlements s USING archived a WHERE s.id = a.id;

CREATE UNIQUE INDEX IF NOT EXISTS settlements_pharmacy_period_uq
  ON settlements (pharmacy_id, period_start, period_end);
CREATE UNIQUE INDEX IF NOT EXISTS courier_settlements_courier_period_uq
  ON courier_settlements (courier_id, period_start, period_end);

-- Backfill only absent legacy delivery snapshots.  These configured defaults
-- are historical policy values, deliberately not read from mutable settings.
UPDATE orders
SET delivery_fee_minor = CASE
      WHEN delivery_fee_minor = 0 THEN 2500000
      ELSE delivery_fee_minor
    END,
    courier_payout_minor = CASE
      WHEN courier_payout_minor = 0 THEN 2000000
      ELSE courier_payout_minor
    END,
    delivery_commission_minor = CASE
      WHEN delivery_commission_minor = 0 THEN
        (CASE WHEN delivery_fee_minor = 0 THEN 2500000 ELSE delivery_fee_minor END)
        - (CASE WHEN courier_payout_minor = 0 THEN 2000000 ELSE courier_payout_minor END)
      ELSE delivery_commission_minor
    END
WHERE status = 'delivered'
  AND fulfillment_type = 'delivery'
  AND (
    delivery_fee_minor = 0
    OR courier_payout_minor = 0
    OR delivery_commission_minor = 0
  );

-- A collection has no courier or delivery charge.  Existing non-zero legacy
-- snapshots are intentionally left untouched by the preceding policy.
UPDATE orders
SET delivery_fee_minor = 0,
    courier_payout_minor = 0,
    delivery_commission_minor = 0
WHERE status = 'collected'
  AND fulfillment_type = 'collection'
  AND delivery_fee_minor = 0
  AND courier_payout_minor = 0
  AND delivery_commission_minor = 0;

-- Unit prices cannot represent a fractional-cent remainder when quantity is
-- greater than one.  This immutable line total is the authoritative exact
-- patient-price snapshot for settlement/reconciliation.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS patient_line_total_minor integer NOT NULL DEFAULT 0;

WITH line_commissions AS (
  SELECT oi.id,
         oi.order_id,
         oi.base_unit_price_minor * oi.quantity AS base_line_total_minor,
         floor(
           (oi.base_unit_price_minor * oi.quantity * o.medicine_markup_basis_points)::numeric
           / 10000
         )::integer AS commission_floor,
         mod(
           oi.base_unit_price_minor * oi.quantity * o.medicine_markup_basis_points,
           10000
         ) AS commission_remainder,
         o.medicine_commission_minor
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
), ranked AS (
  SELECT *,
         row_number() OVER (
           PARTITION BY order_id
           ORDER BY commission_remainder DESC, id
         ) AS remainder_rank,
         sum(commission_floor) OVER (PARTITION BY order_id) AS floor_total
  FROM line_commissions
)
UPDATE order_items oi
SET patient_line_total_minor = r.base_line_total_minor
    + r.commission_floor
    + CASE
        WHEN r.remainder_rank <= r.medicine_commission_minor - r.floor_total
        THEN 1
        ELSE 0
      END
FROM ranked r
WHERE oi.id = r.id
  AND oi.patient_line_total_minor = 0;