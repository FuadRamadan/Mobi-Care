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
