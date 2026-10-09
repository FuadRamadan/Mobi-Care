-- Security monitoring: failed sign-ins, attempts blocked for guessing, browser
-- reports of blocked content (content security policy) and server errors.
-- Read by HQ on Security & Settings; alerts are raised from it. Rows older
-- than 90 days are deleted by the server.

CREATE TABLE IF NOT EXISTS security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  role text,
  account_id uuid,
  identifier text,
  ip_address text,
  path text,
  details jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS security_events_kind_created_idx ON security_events (kind, created_at);
