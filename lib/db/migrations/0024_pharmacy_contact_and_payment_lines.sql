-- Pharmacy email, and mobile money as two named lines.
--
-- Two problems this fixes.
--
-- First, there was nowhere to record a pharmacy's email address at all.
--
-- Second, mobile money was one provider/number pair, so a pharmacy could
-- publish an Orange Money number or an AfriMoney number, never both. Patients
-- pay the pharmacy directly at checkout, and a patient holding only an
-- AfriMoney wallet cannot pay a pharmacy that has published only Orange Money.
-- Splitting the pair into two named lines lets a pharmacy publish both, and
-- lets the patient see which wallets a pharmacy actually accepts.
--
-- mobile_money_number and mobile_money_provider are deliberately kept. They are
-- the record of what was set before the split, and any row whose provider text
-- is not recognisable here keeps its number where checkout can still fall back
-- to it, rather than silently losing a pharmacy's only way of being paid.

ALTER TABLE pharmacies
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS orange_money_number text,
  ADD COLUMN IF NOT EXISTS afri_money_number text;

-- Backfill by what the provider says, never by guessing. A number under an
-- unrecognised or absent provider is left alone for HQ to classify.
UPDATE pharmacies
SET orange_money_number = mobile_money_number
WHERE orange_money_number IS NULL
  AND mobile_money_number IS NOT NULL
  AND mobile_money_provider ILIKE '%orange%';

UPDATE pharmacies
SET afri_money_number = mobile_money_number
WHERE afri_money_number IS NULL
  AND mobile_money_number IS NOT NULL
  AND (mobile_money_provider ILIKE '%afri%' OR mobile_money_provider ILIKE '%africell%');
