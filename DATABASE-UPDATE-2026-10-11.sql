-- MobiCare: upgrade the production database to the 2026-10-11 release.
-- Applies 8 migration(s): 0030_catalogue_categories.sql, 0031_catalogue_variants_and_spelling.sql, 0032_patient_google_sign_in.sql, 0033_security_events.sql, 0034_monime_payments.sql, 0035_monime_payouts.sql, 0036_monime_shared_payment_links.sql, 0037_search_insights.sql
-- and re-records the regenerated baseline (executes nothing from it).
--
-- Run this BEFORE publishing the insights release: the new code refuses to
-- start until these changes exist. The changes only add, so the release that
-- is live now (29 Sept) keeps working on the updated database, and it is
-- also what you go back to if the new release has to be withdrawn (tested).
--
-- Expects the database at 0029_catalogue_permission.sql (checked 11 Oct).
--
-- One transaction: if any statement fails, nothing is changed.
-- Refuses to run twice.

BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '0000_baseline.sql') THEN
    RAISE EXCEPTION 'This database has no recorded baseline. It was not built by mobicare-init.sql. Nothing has been changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM schema_migrations WHERE filename IN ('0030_catalogue_categories.sql', '0031_catalogue_variants_and_spelling.sql', '0032_patient_google_sign_in.sql', '0033_security_events.sql', '0034_monime_payments.sql', '0035_monime_payouts.sql', '0036_monime_shared_payment_links.sql', '0037_search_insights.sql')) THEN
    RAISE EXCEPTION 'Some of these migrations are already recorded: this upgrade has already been run. Nothing has been changed.';
  END IF;
END
$guard$;

-- The baseline file was regenerated to fold in the new migrations. Existing
-- databases accept the new file as equivalent; nothing in it is executed.
UPDATE schema_migrations SET checksum = 'cf8056f3e0321b936317d8ad8dd8ef020347c13a8622d3d389ca98cfbca86b7f' WHERE filename = '0000_baseline.sql';

-- ── 0030_catalogue_categories.sql ─────────────────────────────────────────

-- New catalogue categories for medicines on the national essential medicines
-- list that fitted none of the existing groups (vaccines, cancer medicines,
-- antidotes, eye, skin and ear preparations, and others).
--
-- Only adds values: no medicine changes category. ADD VALUE IF NOT EXISTS
-- makes each statement safe to re-run.

ALTER TYPE drug_primary_category ADD VALUE IF NOT EXISTS 'antidotes_poisoning';
ALTER TYPE drug_primary_category ADD VALUE IF NOT EXISTS 'cancer_immunosuppressants';
ALTER TYPE drug_primary_category ADD VALUE IF NOT EXISTS 'vaccines_immunologicals';
ALTER TYPE drug_primary_category ADD VALUE IF NOT EXISTS 'eye_preparations';
ALTER TYPE drug_primary_category ADD VALUE IF NOT EXISTS 'skin_preparations';
ALTER TYPE drug_primary_category ADD VALUE IF NOT EXISTS 'ear_nose_throat';

-- Subcategories of existing categories.
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'heart_failure_arrhythmia_shock';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'antispasmodics';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'hormones';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'chelating_agents';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'diluents_iv_preparation';

-- Subcategories of the new categories.
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'antidotes';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'adsorbents';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'antineoplastics';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'immunosuppressants';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'vaccines';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'antisera';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'immunoglobulins';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'glaucoma_medicines';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'mydriatics';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'eye_combinations';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'antiseptics';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'emollients';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'keratolytics';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'ear_preparations';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'mouth_throat';

INSERT INTO schema_migrations (filename, checksum) VALUES ('0030_catalogue_categories.sql', '1e6df15329c4d8f6738bc28b7bedbe186a886fe35f6040bc974704a94fc992c5');

-- ── 0031_catalogue_variants_and_spelling.sql ──────────────────────────────

-- 1. Strength + form combinations.
--
-- A medicine's strengths and forms were two independent lists, so any
-- strength could be listed in any form (Paracetamol 50mg tablet, when 50mg is
-- the suppository). variants records the combinations that exist. Empty means
-- every strength comes in every form, which is what every existing entry
-- allowed, so nothing changes until HQ narrows an entry down.

ALTER TABLE drug_catalogue
  ADD COLUMN IF NOT EXISTS variants jsonb DEFAULT '[]'::jsonb NOT NULL;

-- 2. One spelling per form.
--
-- The catalogue mixed "tablet" and "Tablet", and listings had to match the
-- catalogue's capitals exactly. Matching now ignores capitals; this gives each
-- form a capital first letter ("tablet" -> "Tablet", "Powder for Injection"
-- unchanged) and removes entries repeated in different capitals, keeping the
-- first. Strengths keep their spelling and only lose such repeats.

WITH forms AS (
  SELECT d.id, x.ord, btrim(regexp_replace(x.value, '\s+', ' ', 'g')) AS value
  FROM drug_catalogue d, unnest(d.common_forms) WITH ORDINALITY AS x(value, ord)
), firsts AS (
  SELECT id, min(ord) AS ord, (array_agg(value ORDER BY ord))[1] AS value
  FROM forms WHERE value <> '' GROUP BY id, lower(value)
), rebuilt AS (
  SELECT id, array_agg(upper(left(value, 1)) || substr(value, 2) ORDER BY ord) AS forms
  FROM firsts GROUP BY id
)
UPDATE drug_catalogue d SET common_forms = r.forms
FROM rebuilt r
WHERE r.id = d.id AND d.common_forms IS DISTINCT FROM r.forms;

WITH strengths AS (
  SELECT d.id, x.ord, btrim(regexp_replace(x.value, '\s+', ' ', 'g')) AS value
  FROM drug_catalogue d, unnest(d.common_strengths) WITH ORDINALITY AS x(value, ord)
), firsts AS (
  SELECT id, min(ord) AS ord, (array_agg(value ORDER BY ord))[1] AS value
  FROM strengths WHERE value <> '' GROUP BY id, lower(value)
), rebuilt AS (
  SELECT id, array_agg(value ORDER BY ord) AS strengths FROM firsts GROUP BY id
)
UPDATE drug_catalogue d SET common_strengths = r.strengths
FROM rebuilt r
WHERE r.id = d.id AND d.common_strengths IS DISTINCT FROM r.strengths;

-- Listings take their medicine's spelling of the same strength and form, so
-- the same product is grouped together for patients. A listing is left as it
-- is if the new spelling would make it identical to another active listing
-- (the one-active-listing-per-product rule); the pharmacy can merge those.

WITH canonical AS (
  SELECT p.id,
    coalesce((SELECT s FROM unnest(d.common_strengths) AS s WHERE lower(s) = lower(btrim(p.strength)) LIMIT 1), p.strength) AS strength,
    coalesce((SELECT f FROM unnest(d.common_forms) AS f WHERE lower(f) = lower(btrim(p.form)) LIMIT 1), p.form) AS form
  FROM pharmacy_inventory p
  JOIN drug_catalogue d ON d.id = p.drug_id
  WHERE p.strength IS NOT NULL AND p.form IS NOT NULL
)
UPDATE pharmacy_inventory p
SET strength = c.strength, form = c.form
FROM canonical c
WHERE c.id = p.id
  AND (p.strength IS DISTINCT FROM c.strength OR p.form IS DISTINCT FROM c.form)
  AND NOT (
    p.is_active AND EXISTS (
      SELECT 1 FROM pharmacy_inventory q
      WHERE q.id <> p.id
        AND q.is_active
        AND q.pharmacy_id = p.pharmacy_id
        AND q.drug_id = p.drug_id
        AND lower(btrim(q.strength)) = lower(btrim(p.strength))
        AND lower(btrim(q.form)) = lower(btrim(p.form))
        AND q.unit_of_sale IS NOT DISTINCT FROM p.unit_of_sale
        AND lower(q.brand) IS NOT DISTINCT FROM lower(p.brand)
        AND lower(coalesce(q.manufacturer, '')) = lower(coalesce(p.manufacturer, ''))
    )
  );

INSERT INTO schema_migrations (filename, checksum) VALUES ('0031_catalogue_variants_and_spelling.sql', 'a0365019331d56fc47a97316b6fbcb6cba735a4ecb7e5bad690a4974a3101115');

-- ── 0032_patient_google_sign_in.sql ───────────────────────────────────────

-- Patients can sign in with Google.
--
-- google_sub is Google's permanent ID for the person's Google account (the
-- "sub" claim). An email address can change hands; this ID cannot, so the
-- account is found by it. NULL for patients who only use phone + password.
--
-- has_password is false for an account created with Google, which has no
-- password the patient knows; the stored hash is of a random value nobody
-- holds. Such a patient can still set a password later.

ALTER TABLE patients ADD COLUMN IF NOT EXISTS google_sub text;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS has_password boolean DEFAULT true NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS patients_google_sub_unique ON patients (google_sub);

INSERT INTO schema_migrations (filename, checksum) VALUES ('0032_patient_google_sign_in.sql', 'dd957bfe036715a615808d3f6762b803dc4bfb384a585841db1ca9b7614e8778');

-- ── 0033_security_events.sql ──────────────────────────────────────────────

-- Security monitoring: failed sign-ins, attempts blocked for guessing, browser
-- reports of blocked content (content security policy) and server errors.
-- Read by HQ on Security & Settings; alerts are raised from it. Rows older
-- than 90 days are deleted by the server.

CREATE TABLE IF NOT EXISTS security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  role text,
  account_id uuid,
  identifier text,
  ip_address text,
  path text,
  details jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS security_events_kind_created_idx ON security_events (kind, created_at);

INSERT INTO schema_migrations (filename, checksum) VALUES ('0033_security_events.sql', '40d1a7e932fc80277a18d62a005b9186bd042a031939986fdb2c37f6aa5c44e8');

-- ── 0034_monime_payments.sql ──────────────────────────────────────────────

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

INSERT INTO schema_migrations (filename, checksum) VALUES ('0034_monime_payments.sql', '9a828ab997d2444c0ea2eb1b115376c28e0a7a47eceae8c1007e938efc928ff9');

-- ── 0035_monime_payouts.sql ───────────────────────────────────────────────

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

INSERT INTO schema_migrations (filename, checksum) VALUES ('0035_monime_payouts.sql', 'ae1a02541e293313a0999fa2a065eef65a5fc449c6e00f1b46615217cb20bed4');

-- ── 0036_monime_shared_payment_links.sql ──────────────────────────────────

-- "Ask someone else to pay": a patient can send the payment link to someone
-- else. Such a link lists no medicines (one line, "MobiCare order <number>")
-- and returns the payer to a public page. Only one link per order is live at a
-- time, shared or not; this records which kind it is.
ALTER TABLE monime_checkout_sessions ADD COLUMN IF NOT EXISTS shared boolean DEFAULT false NOT NULL;

INSERT INTO schema_migrations (filename, checksum) VALUES ('0036_monime_shared_payment_links.sql', '9cec70bed0ae3fea1ceedfb74d23bc69e162e2337bde0be79723d417013da86a');

-- ── 0037_search_insights.sql ──────────────────────────────────────────────

-- Data & Insights: where medicines could not be found, and why.
--
-- area_zone / area_source: the delivery zone a search came from (from the
-- phone's location or the patient's last delivery pin), and how the area was
-- worked out. Only the name is kept, never coordinates. area_district stays,
-- now also filled from the location when there is one.
--
-- unavailable_reason: set when the search gave the patient nothing they could
-- get: out_of_stock | not_listed | misspelled | not_in_catalogue.
-- matched_drug_id / matched_drug_name: the catalogue medicine it was about, so
-- spelling variants count as one medicine. The name is copied so a report
-- still reads correctly after a catalogue entry is renamed or removed.
ALTER TABLE search_events ADD COLUMN IF NOT EXISTS area_zone text;
ALTER TABLE search_events ADD COLUMN IF NOT EXISTS area_source text;
ALTER TABLE search_events ADD COLUMN IF NOT EXISTS unavailable_reason text;
ALTER TABLE search_events ADD COLUMN IF NOT EXISTS matched_drug_id uuid;
ALTER TABLE search_events ADD COLUMN IF NOT EXISTS matched_drug_name text;
CREATE INDEX IF NOT EXISTS search_events_unavailable_created_at_idx
  ON search_events (created_at) WHERE unavailable_reason IS NOT NULL;

INSERT INTO schema_migrations (filename, checksum) VALUES ('0037_search_insights.sql', 'e0388b46dd8fe8e7a460d53438d6c9e9a3c978fb4690ba57134592e0cfeb988a');

COMMIT;

-- Confirm (expect 37 rows, newest 0037_search_insights.sql):
--   SELECT count(*), max(filename) FROM schema_migrations;
