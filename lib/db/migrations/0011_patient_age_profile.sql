ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS age integer NOT NULL DEFAULT 18;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS profile_image_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'patients_age_adult_check'
  ) THEN
    ALTER TABLE patients
      ADD CONSTRAINT patients_age_adult_check CHECK (age >= 18);
  END IF;
END $$;