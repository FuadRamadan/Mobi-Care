-- Daily commission ledger. The legacy `settlements` tables recorded payouts;
-- retain them unchanged for audit/history and keep the reverse money flow in
-- this separate append-only ledger.
DO $$ BEGIN
  CREATE TYPE commission_settlement_status AS ENUM ('unpaid', 'partially_paid', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS commission_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,
  settlement_date date NOT NULL,
  business_timezone text NOT NULL,
  orders_count integer NOT NULL CHECK (orders_count >= 0),
  gross_collected_minor integer NOT NULL,
  drug_amount_total_minor integer NOT NULL,
  commission_due_minor integer NOT NULL,
  amount_paid_minor integer NOT NULL DEFAULT 0,
  balance_minor integer NOT NULL,
  status commission_settlement_status NOT NULL DEFAULT 'unpaid',
  paid_at timestamptz,
  payment_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_settlements_pharmacy_day_uq UNIQUE (pharmacy_id, settlement_date)
);
CREATE INDEX IF NOT EXISTS commission_settlements_date_idx
  ON commission_settlements (settlement_date);
CREATE INDEX IF NOT EXISTS commission_settlements_status_idx
  ON commission_settlements (status);

CREATE TABLE IF NOT EXISTS commission_settlement_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES commission_settlements(id) ON DELETE RESTRICT,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  paid_at timestamptz NOT NULL,
  payment_reference text NOT NULL,
  recorded_by_hq_staff_id uuid REFERENCES hq_staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commission_payment_settlement_idx
  ON commission_settlement_payments (settlement_id);

CREATE TABLE IF NOT EXISTS commission_settlement_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES commission_settlements(id) ON DELETE RESTRICT,
  amount_minor integer NOT NULL,
  reason text NOT NULL,
  source_order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commission_adjustment_settlement_idx
  ON commission_settlement_adjustments (settlement_id);
CREATE INDEX IF NOT EXISTS commission_adjustment_order_idx
  ON commission_settlement_adjustments (source_order_id);

-- Search identity was intentionally absent in earlier telemetry. Additive,
-- nullable columns preserve every historical anonymous event.
ALTER TABLE search_events
  ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pharmacy_id uuid REFERENCES pharmacies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS session_id text;
CREATE INDEX IF NOT EXISTS search_events_patient_created_at_idx
  ON search_events (patient_id, created_at);

ALTER TABLE pharmacies
  ADD COLUMN IF NOT EXISTS mobile_money_number text,
  ADD COLUMN IF NOT EXISTS mobile_money_provider text,
  ADD COLUMN IF NOT EXISTS mobile_money_account_name text;