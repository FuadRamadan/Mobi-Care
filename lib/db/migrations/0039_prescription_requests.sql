-- Prescription requests: a patient sends a photo of a prescription instead of
-- searching, and the pharmacies around them are asked, one round at a time,
-- whether they can fill it. The first pharmacy to accept gets it.
--
-- Each round lasts 5 minutes and reaches further: the patient's delivery zone
-- (or 3 km), then 8 km, then 25 km. Only pharmacies with the portal open
-- (seen in the last 2 minutes, pharmacies.last_seen_at) are asked.
--
-- Privacy: until a pharmacy accepts, pharmacies see only the covered copy of
-- the photo (covered_image_key, the patient's name blacked out on the phone)
-- and the area name, never the patient's name, phone or exact location. The
-- original photo (image_key) is shown only to the pharmacy that accepted.
-- Both photos are deleted when the request ends without an order.

ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

DO $$ BEGIN
  CREATE TYPE prescription_request_status AS ENUM
    ('searching', 'accepted', 'ready', 'ordered', 'expired', 'cancelled', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS prescription_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  image_key text NOT NULL,
  covered_image_key text,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  zone_id uuid REFERENCES delivery_zones(id) ON DELETE SET NULL,
  area_name text,
  note text,
  status prescription_request_status NOT NULL DEFAULT 'searching',
  round integer NOT NULL DEFAULT 0,
  round_started_at timestamptz,
  accepted_pharmacy_id uuid REFERENCES pharmacies(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  ready_at timestamptz,
  -- What the pharmacy can supply: [{ "inventoryId": uuid, "maxQuantity": int }]
  items jsonb,
  reject_reason prescription_reject_reason,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  ended_at timestamptz,
  images_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The matching job looks only at open requests.
CREATE INDEX IF NOT EXISTS prescription_requests_open_idx
  ON prescription_requests (status, round_started_at)
  WHERE status IN ('searching', 'accepted', 'ready');
CREATE INDEX IF NOT EXISTS prescription_requests_patient_idx
  ON prescription_requests (patient_id, created_at DESC);

-- Which pharmacies were asked, in which round, and who said no.
CREATE TABLE IF NOT EXISTS prescription_request_offers (
  request_id uuid NOT NULL REFERENCES prescription_requests(id) ON DELETE CASCADE,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  round integer NOT NULL,
  notified_at timestamptz NOT NULL DEFAULT now(),
  declined_at timestamptz,
  PRIMARY KEY (request_id, pharmacy_id)
);
CREATE INDEX IF NOT EXISTS prescription_request_offers_pharmacy_idx
  ON prescription_request_offers (pharmacy_id, notified_at DESC);
