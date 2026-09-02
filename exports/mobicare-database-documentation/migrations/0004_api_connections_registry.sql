BEGIN;

CREATE TABLE IF NOT EXISTS api_connections (
  id text PRIMARY KEY,
  provider text NOT NULL,
  display_name text NOT NULL,
  category text NOT NULL,
  credentials_encrypted text,
  public_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_enabled boolean NOT NULL DEFAULT false,
  last_tested_at timestamptz,
  last_test_status text,
  last_test_message text,
  updated_by uuid REFERENCES hq_staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_connections_provider_idx
  ON api_connections(provider);

DROP TABLE IF EXISTS sms_provider_config;

COMMIT;