-- Browser notifications that drop down on the phone or computer even when
-- MobiCare is closed (Web Push). Each row is one browser that agreed to
-- receive them, for one patient or one pharmacy.
--
-- endpoint, p256dh and auth come from the browser's push service. They are
-- not passwords, but they do let anyone holding them send that browser a
-- notification, so they never leave the server.
--
-- A row is deleted when the patient or pharmacy turns notifications off or
-- signs out on that browser, or when the push service says the browser is gone.

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE,
  pharmacy_id uuid REFERENCES pharmacies(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  CONSTRAINT web_push_subscriptions_one_owner CHECK ((patient_id IS NULL) <> (pharmacy_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS web_push_subscriptions_endpoint_idx ON web_push_subscriptions (endpoint);
CREATE INDEX IF NOT EXISTS web_push_subscriptions_patient_idx ON web_push_subscriptions (patient_id) WHERE patient_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS web_push_subscriptions_pharmacy_idx ON web_push_subscriptions (pharmacy_id) WHERE pharmacy_id IS NOT NULL;
