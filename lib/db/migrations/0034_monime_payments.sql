-- Monime payments, phase 1: patients pay MobiCare through a Monime payment
-- link (checkout session) instead of paying the pharmacy directly.
--
-- Nothing changes until the server is started with PAYMENTS_PROVIDER=monime:
-- existing and new orders keep payment_provider 'direct' and the current fee.

-- Which way the order is paid: 'direct' (patient pays the pharmacy) or
-- 'monime' (patient pays MobiCare's Monime account through a payment link).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider text DEFAULT 'direct' NOT NULL;

-- Which fee rule priced the order:
--   'patient_fee_v1'  patient pays a 5% service fee; the pharmacy keeps its full price
--   'split_v1'        patient pays a 2% service fee; the pharmacy pays a 5% commission
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pricing_model text DEFAULT 'patient_fee_v1' NOT NULL;

-- The two halves of MobiCare's medicine revenue, kept apart so neither has to
-- be worked out again later. medicine_commission_minor stays their sum.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS patient_service_fee_minor integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pharmacy_commission_minor integer;
UPDATE orders
   SET patient_service_fee_minor = medicine_commission_minor,
       pharmacy_commission_minor = 0
 WHERE patient_service_fee_minor IS NULL;
ALTER TABLE orders ALTER COLUMN patient_service_fee_minor SET DEFAULT 0;
ALTER TABLE orders ALTER COLUMN patient_service_fee_minor SET NOT NULL;
ALTER TABLE orders ALTER COLUMN pharmacy_commission_minor SET DEFAULT 0;
ALTER TABLE orders ALTER COLUMN pharmacy_commission_minor SET NOT NULL;

-- When the patient may start paying. For a Monime order without a
-- prescription this is when it was placed; with a prescription, when the
-- pharmacist approved it. The 2-hour payment window counts from here.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payable_since timestamp with time zone;

-- When the payment was confirmed (Monime orders).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamp with time zone;

-- A payment that arrived after the order had expired or been cancelled:
-- 'revived' (stock was still there, the order went ahead) or 'refund_needed'.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS late_payment_status text;

-- One row per payment link made for an order. Saved before Monime is called,
-- with the exact request and idempotency key, so a retry after a crash sends
-- the identical request and can never create a second link.
CREATE TABLE IF NOT EXISTS monime_checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  attempt integer NOT NULL,
  idempotency_key text NOT NULL,
  request_body jsonb NOT NULL,
  amount_minor integer NOT NULL,
  -- creating | pending | completed | expired | cancelled | deleted
  status text DEFAULT 'creating' NOT NULL,
  monime_session_id text,
  monime_order_number text,
  redirect_url text,
  expire_time timestamp with time zone,
  monime_payment_id text,
  -- Monime's actual fees on the payment, as it reported them.
  fees jsonb,
  -- How the payer paid: momo / card / bank / wallet, and the provider code.
  payer_channel text,
  payer_provider text,
  monime_request_id text,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT monime_checkout_sessions_order_attempt_unique UNIQUE (order_id, attempt),
  CONSTRAINT monime_checkout_sessions_idempotency_key_unique UNIQUE (idempotency_key),
  CONSTRAINT monime_checkout_sessions_session_unique UNIQUE (monime_session_id)
);
CREATE INDEX IF NOT EXISTS monime_checkout_sessions_status_idx ON monime_checkout_sessions (status, updated_at);
CREATE INDEX IF NOT EXISTS monime_checkout_sessions_order_number_idx ON monime_checkout_sessions (monime_order_number);

-- Every webhook Monime sends, kept as received. The event ID is unique, so a
-- resent event is recognised and ignored.
CREATE TABLE IF NOT EXISTS monime_webhook_events (
  event_id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  object_type text,
  object_id text,
  event_timestamp timestamp with time zone,
  payload jsonb NOT NULL,
  -- received | processed | ignored | failed
  outcome text DEFAULT 'received' NOT NULL,
  detail text,
  received_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone
);
