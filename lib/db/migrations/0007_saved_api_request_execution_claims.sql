BEGIN;
CREATE TABLE IF NOT EXISTS saved_api_request_execution_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES hq_staff(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_api_request_execution_claims_actor_created_idx
  ON saved_api_request_execution_claims(actor_id, created_at DESC);
COMMIT;