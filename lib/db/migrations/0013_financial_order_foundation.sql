DO $$ BEGIN
  CREATE TYPE delivery_confirmation_method AS ENUM ('patient', 'hq');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS platform_settings (
  key text PRIMARY KEY,
  value integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Persist the exact introduction boundary for immutable order snapshots.
-- Later reconciliation migrations must use this provenance marker rather than
-- infer legacy status from a configurable financial value.
CREATE TABLE IF NOT EXISTS financial_migration_state (
  key text PRIMARY KEY,
  applied_at timestamptz NOT NULL
);
INSERT INTO financial_migration_state (key, applied_at)
VALUES ('financial_snapshots_introduced', clock_timestamp())
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value) VALUES
  ('medicine_markup_basis_points', 500),
  ('delivery_fee_minor', 2500000),
  ('courier_payout_minor', 2000000)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS medicine_markup_basis_points integer NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS pharmacy_medicine_total_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS medicine_commission_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS patient_medicine_total_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS courier_payout_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_commission_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_confirmation_method delivery_confirmation_method,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_by_hq_user_id uuid REFERENCES hq_staff(id) ON DELETE SET NULL;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS base_unit_price_minor integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS patient_unit_price_minor integer NOT NULL DEFAULT 0;

ALTER TABLE hq_staff
  ADD COLUMN IF NOT EXISTS can_manage_settlements boolean NOT NULL DEFAULT false;
UPDATE hq_staff SET can_manage_settlements = true;

-- Preserve the historical financial meaning: pre-migration totals were pharmacy
-- prices and must not be retroactively marked up.
UPDATE orders
SET pharmacy_medicine_total_minor = round(total_leones * 100)::integer,
    patient_medicine_total_minor = round(total_leones * 100)::integer,
    medicine_markup_basis_points = 0
WHERE pharmacy_medicine_total_minor = 0
  AND patient_medicine_total_minor = 0;

UPDATE order_items
SET base_unit_price_minor = round(unit_price_leones * 100)::integer,
    patient_unit_price_minor = round(unit_price_leones * 100)::integer
WHERE base_unit_price_minor = 0
  AND patient_unit_price_minor = 0;

UPDATE orders
SET completed_at = updated_at
WHERE status IN ('delivered', 'collected') AND completed_at IS NULL;

ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS amount_minor integer NOT NULL DEFAULT 0;
ALTER TABLE courier_settlements
  ADD COLUMN IF NOT EXISTS amount_minor integer NOT NULL DEFAULT 0;
UPDATE settlements SET amount_minor = amount_leones * 100 WHERE amount_minor = 0;
UPDATE courier_settlements SET amount_minor = amount_leones * 100 WHERE amount_minor = 0;