-- Prescription requests follow the delivery limit (HQ › Delivery Zones).
--
-- Rounds 1 to 3 now ask only pharmacies that can deliver to the patient. If
-- none takes the prescription and pharmacies further away are open, the
-- request waits as 'out_of_range' for the patient to choose whether to ask
-- them too and collect. collection_only records that choice.
--
-- Adds a value and a column with a default: no existing row changes.

ALTER TYPE prescription_request_status ADD VALUE IF NOT EXISTS 'out_of_range' AFTER 'searching';

ALTER TABLE prescription_requests
  ADD COLUMN IF NOT EXISTS collection_only boolean NOT NULL DEFAULT false;
