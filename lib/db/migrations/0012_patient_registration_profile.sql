ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS date_of_birth date;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS nin text;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS address text;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS nationality text;