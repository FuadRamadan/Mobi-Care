BEGIN;

CREATE TABLE IF NOT EXISTS patient_email_password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE,
  email_hash text NOT NULL,
  requester_hash text NOT NULL,
  otp_hash text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  otp_expires_at timestamptz NOT NULL,
  otp_used_at timestamptz,
  reset_token_hash text UNIQUE,
  reset_expires_at timestamptz,
  reset_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_email_password_reset_email_created_idx
  ON patient_email_password_resets (email_hash, created_at);

CREATE INDEX IF NOT EXISTS patient_email_password_reset_requester_created_idx
  ON patient_email_password_resets (requester_hash, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS patients_email_normalized_unique
  ON patients (lower(btrim(email)))
  WHERE email IS NOT NULL AND btrim(email) <> '';

COMMIT;