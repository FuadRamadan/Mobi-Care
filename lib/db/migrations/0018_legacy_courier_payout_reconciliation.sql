CREATE TABLE IF NOT EXISTS financial_migration_state (
  key text PRIMARY KEY,
  applied_at timestamptz NOT NULL
);

DO $$
DECLARE
  financial_rollout_at timestamptz;
  inserted_rows integer;
BEGIN
  SELECT applied_at
  INTO financial_rollout_at
  FROM financial_migration_state
  WHERE key = 'financial_snapshots_introduced';

  IF financial_rollout_at IS NULL THEN
    RAISE EXCEPTION 'Missing financial snapshot rollout marker from migration 0013';
  END IF;

  INSERT INTO financial_migration_state (key, applied_at)
  VALUES ('legacy_courier_payout_reconciled', clock_timestamp())
  ON CONFLICT (key) DO NOTHING;
  GET DIAGNOSTICS inserted_rows = ROW_COUNT;

  IF inserted_rows = 1 THEN
    -- Before immutable financial snapshots, a courier received the full
    -- Le 25,000 delivery fee. Limit reconciliation to rows that existed at
    -- the original 0013 rollout boundary and have the exact legacy snapshot shape.
    UPDATE orders
    SET delivery_fee_minor = CASE
          WHEN delivery_fee_minor = 0 THEN 2500000
          ELSE delivery_fee_minor
        END,
        courier_payout_minor = 2500000,
        delivery_commission_minor = greatest(
          (CASE
            WHEN delivery_fee_minor = 0 THEN 2500000
            ELSE delivery_fee_minor
          END) - 2500000,
          0
        )
    WHERE created_at < financial_rollout_at
      AND medicine_markup_basis_points = 0
      AND medicine_commission_minor = 0
      AND patient_medicine_total_minor = pharmacy_medicine_total_minor
      AND status = 'delivered'
      AND fulfillment_type = 'delivery';
  END IF;
END $$;