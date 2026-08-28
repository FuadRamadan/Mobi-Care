BEGIN;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS patient_password_reset_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE,
  phone_hash text NOT NULL,
  requester_hash text NOT NULL,
  code_hash text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_password_reset_phone_created_idx
  ON patient_password_reset_codes (phone_hash, created_at);

CREATE INDEX IF NOT EXISTS patient_password_reset_requester_created_idx
  ON patient_password_reset_codes (requester_hash, created_at);

COMMIT;