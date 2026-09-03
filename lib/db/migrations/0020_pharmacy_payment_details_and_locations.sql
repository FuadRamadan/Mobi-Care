ALTER TABLE "pharmacies"
  ADD COLUMN IF NOT EXISTS "mobile_money_provider" text,
  ADD COLUMN IF NOT EXISTS "mobile_money_number" text,
  ADD COLUMN IF NOT EXISTS "mobile_money_account_name" text,
  ADD COLUMN IF NOT EXISTS "is_online" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "location_lat" text,
  ADD COLUMN IF NOT EXISTS "location_lng" text;

ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "location_lat" text,
  ADD COLUMN IF NOT EXISTS "location_lng" text;