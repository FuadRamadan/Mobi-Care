-- Monime payments, phase 2: when an online-paid order is delivered or
-- collected, its money moves from MobiCare's Holding account to the pharmacy's
-- own account (medicine total less the 5% commission) and to MobiCare Revenue
-- (the rest). Pharmacies then cash out their balance to their registered
-- Orange Money or AfriMoney number.
--
-- Nothing here touches orders paid directly to the pharmacy.

-- When each payout number last changed. Cash-outs to a number changed in the
-- last 48 hours wait (decision 11). Existing numbers count as long-standing.
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS orange_money_changed_at timestamp with time zone;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS afri_money_changed_at timestamp with time zone;

-- Each pharmacy's account inside MobiCare's Monime space. Saved before Monime
-- is called, with the exact request and key, so a retry can't make a second
-- account. Monime's reference on the account is the pharmacy ID.
CREATE TABLE IF NOT EXISTS pharmacy_monime_accounts (
  pharmacy_id uuid PRIMARY KEY NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  request_body jsonb NOT NULL,
  -- creating | active
  status text DEFAULT 'creating' NOT NULL,
  monime_account_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT pharmacy_monime_accounts_key_unique UNIQUE (idempotency_key),
  CONSTRAINT pharmacy_monime_accounts_account_unique UNIQUE (monime_account_id)
);

-- Money released when an order completes: one 'pharmacy_share' and one
-- 'mobicare_share' transfer out of Holding per order. A failed transfer is
-- retried as a new attempt with a new key; the failed row stays as history.
CREATE TABLE IF NOT EXISTS monime_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,
  -- pharmacy_share | mobicare_share
  kind text NOT NULL,
  attempt integer NOT NULL,
  amount_minor integer NOT NULL,
  source_account_id text NOT NULL,
  destination_account_id text,
  idempotency_key text NOT NULL,
  request_body jsonb,
  -- creating | pending | processing | completed | failed | skipped
  status text DEFAULT 'creating' NOT NULL,
  monime_transfer_id text,
  failure_code text,
  failure_message text,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT monime_transfers_order_kind_attempt_unique UNIQUE (order_id, kind, attempt),
  CONSTRAINT monime_transfers_key_unique UNIQUE (idempotency_key),
  CONSTRAINT monime_transfers_monime_id_unique UNIQUE (monime_transfer_id)
);
CREATE INDEX IF NOT EXISTS monime_transfers_status_idx ON monime_transfers (status, updated_at);
CREATE INDEX IF NOT EXISTS monime_transfers_pharmacy_idx ON monime_transfers (pharmacy_id, kind, status);

-- A pharmacy's cash-out to its registered mobile money number. Monime's 1%
-- payout fee is charged on top, from the pharmacy's balance, so the fee is
-- held back (fee_reserved_minor) until Monime reports the actual fee.
CREATE TABLE IF NOT EXISTS pharmacy_cashouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,
  -- What reaches the wallet.
  amount_minor integer NOT NULL,
  fee_reserved_minor integer NOT NULL,
  -- Monime's actual fee, once reported.
  fee_minor integer,
  -- m17 (Orange Money) | m18 (AfriMoney)
  provider text NOT NULL,
  -- The registered number at the time of the request (never typed by the pharmacy).
  phone_number text NOT NULL,
  -- awaiting_approval | sending | pending | processing | completed | failed | rejected | cancelled
  status text NOT NULL,
  needs_approval boolean DEFAULT false NOT NULL,
  approved_by_hq_user_id uuid,
  approved_by_name text,
  approved_at timestamp with time zone,
  rejected_by_hq_user_id uuid,
  rejected_by_name text,
  rejected_at timestamp with time zone,
  rejection_reason text,
  idempotency_key text NOT NULL,
  request_body jsonb,
  monime_payout_id text,
  failure_code text,
  failure_message text,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT pharmacy_cashouts_key_unique UNIQUE (idempotency_key),
  CONSTRAINT pharmacy_cashouts_payout_unique UNIQUE (monime_payout_id)
);
CREATE INDEX IF NOT EXISTS pharmacy_cashouts_pharmacy_idx ON pharmacy_cashouts (pharmacy_id, created_at);
CREATE INDEX IF NOT EXISTS pharmacy_cashouts_status_idx ON pharmacy_cashouts (status, updated_at);
-- One cash-out in progress per pharmacy at a time, so two requests can never
-- both spend the same balance.
CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_cashouts_one_open
  ON pharmacy_cashouts (pharmacy_id)
  WHERE status IN ('awaiting_approval', 'sending', 'pending', 'processing');
