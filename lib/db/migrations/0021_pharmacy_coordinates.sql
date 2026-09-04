-- Additive location fields for distance-aware patient search. Do not migrate
-- over legacy location_lat/location_lng values: they are preserved as entered.
ALTER TABLE pharmacies
  ADD COLUMN IF NOT EXISTS latitude text,
  ADD COLUMN IF NOT EXISTS longitude text;