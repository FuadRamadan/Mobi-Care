BEGIN;

CREATE TABLE IF NOT EXISTS saved_api_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  method text NOT NULL,
  auth_type text NOT NULL DEFAULT 'none',
  auth_config_encrypted text,
  params jsonb NOT NULL DEFAULT '[]'::jsonb,
  headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  body text,
  created_by uuid REFERENCES hq_staff(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES hq_staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saved_api_request_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES saved_api_requests(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES hq_staff(id) ON DELETE SET NULL,
  method text NOT NULL,
  url text NOT NULL,
  status integer,
  duration_ms integer NOT NULL,
  response_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_body text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_api_request_history_request_created_idx
  ON saved_api_request_history(request_id, created_at DESC);

CREATE OR REPLACE FUNCTION trim_saved_api_request_history() RETURNS trigger AS $$
BEGIN
  DELETE FROM saved_api_request_history
  WHERE request_id = NEW.request_id
    AND id IN (
      SELECT id FROM saved_api_request_history
      WHERE request_id = NEW.request_id
      ORDER BY created_at DESC, id DESC
      OFFSET 50
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS saved_api_request_history_trim ON saved_api_request_history;
CREATE TRIGGER saved_api_request_history_trim
  AFTER INSERT ON saved_api_request_history
  FOR EACH ROW EXECUTE FUNCTION trim_saved_api_request_history();

COMMIT;