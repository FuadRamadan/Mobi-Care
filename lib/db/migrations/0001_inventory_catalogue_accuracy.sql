BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'drug_primary_category' AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE drug_primary_category AS ENUM (
      'pain_fever', 'infection', 'malaria', 'respiratory_allergy', 'digestive',
      'cardiovascular', 'diabetes_endocrine', 'womens_reproductive',
      'child_health', 'mental_neurological', 'skin_wound', 'eye_ear',
      'vitamins_nutrition', 'other'
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'drug_subcategory' AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE drug_subcategory AS ENUM (
      'analgesics_antipyretics', 'anti_inflammatory', 'antibiotics',
      'antifungal_antiparasitic', 'antimalarials', 'cough_cold', 'allergy',
      'gastrointestinal', 'oral_rehydration', 'hypertension', 'heart_health',
      'diabetes', 'reproductive_health', 'maternal_health', 'pediatric',
      'neurological', 'mental_health', 'dermatology', 'wound_care',
      'eye_care', 'ear_care', 'vitamins_minerals', 'other'
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'drug_review_status' AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE drug_review_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'inventory_completion_status' AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE inventory_completion_status AS ENUM ('incomplete', 'complete');
  END IF;
END $$;

ALTER TABLE drug_catalogue
  ADD COLUMN IF NOT EXISTS common_strengths text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS common_forms text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS primary_category drug_primary_category,
  ADD COLUMN IF NOT EXISTS subcategory drug_subcategory,
  ADD COLUMN IF NOT EXISTS review_status drug_review_status NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by_hq_staff_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'drug_catalogue_reviewed_by_hq_staff_id_hq_staff_id_fk'
      AND conrelid = 'drug_catalogue'::regclass
  ) THEN
    ALTER TABLE drug_catalogue
      ADD CONSTRAINT drug_catalogue_reviewed_by_hq_staff_id_hq_staff_id_fk
      FOREIGN KEY (reviewed_by_hq_staff_id) REFERENCES hq_staff(id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE pharmacy_inventory
  ADD COLUMN IF NOT EXISTS strength varchar(50),
  ADD COLUMN IF NOT EXISTS form varchar(50),
  ADD COLUMN IF NOT EXISTS unit_of_sale varchar(80),
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS manufacturer varchar(150),
  ADD COLUMN IF NOT EXISTS primary_category drug_primary_category,
  ADD COLUMN IF NOT EXISTS subcategory drug_subcategory,
  ADD COLUMN IF NOT EXISTS other_category_text text,
  ADD COLUMN IF NOT EXISTS requires_hq_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completion_status inventory_completion_status
    NOT NULL DEFAULT 'incomplete';

ALTER TABLE pharmacy_inventory
  ALTER COLUMN price_leones TYPE numeric(12,2)
  USING price_leones::numeric(12,2);

UPDATE pharmacy_inventory
SET completion_status = 'incomplete'
WHERE strength IS NULL
   OR form IS NULL
   OR unit_of_sale IS NULL
   OR expiry_date IS NULL;

ALTER TABLE pharmacy_inventory DROP CONSTRAINT IF EXISTS uniq_pharmacy_drug;
DROP INDEX IF EXISTS uniq_pharmacy_drug;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_pharmacy_drug_variant
  ON pharmacy_inventory (pharmacy_id, drug_id, strength, form, unit_of_sale)
  WHERE is_active = true;

ALTER TABLE orders
  ALTER COLUMN total_leones TYPE numeric(14,2)
  USING total_leones::numeric(14,2);

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS inventory_id uuid;

ALTER TABLE order_items
  ALTER COLUMN unit_price_leones TYPE numeric(12,2)
  USING unit_price_leones::numeric(12,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_items_inventory_id_pharmacy_inventory_id_fk'
      AND conrelid = 'order_items'::regclass
  ) THEN
    ALTER TABLE order_items
      ADD CONSTRAINT order_items_inventory_id_pharmacy_inventory_id_fk
      FOREIGN KEY (inventory_id) REFERENCES pharmacy_inventory(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;