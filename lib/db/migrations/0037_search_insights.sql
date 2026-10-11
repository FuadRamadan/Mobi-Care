-- Data & Insights: where medicines could not be found, and why.
--
-- area_zone / area_source: the delivery zone a search came from (from the
-- phone's location or the patient's last delivery pin), and how the area was
-- worked out. Only the name is kept, never coordinates. area_district stays,
-- now also filled from the location when there is one.
--
-- unavailable_reason: set when the search gave the patient nothing they could
-- get: out_of_stock | not_listed | misspelled | not_in_catalogue.
-- matched_drug_id / matched_drug_name: the catalogue medicine it was about, so
-- spelling variants count as one medicine. The name is copied so a report
-- still reads correctly after a catalogue entry is renamed or removed.
ALTER TABLE search_events ADD COLUMN IF NOT EXISTS area_zone text;
ALTER TABLE search_events ADD COLUMN IF NOT EXISTS area_source text;
ALTER TABLE search_events ADD COLUMN IF NOT EXISTS unavailable_reason text;
ALTER TABLE search_events ADD COLUMN IF NOT EXISTS matched_drug_id uuid;
ALTER TABLE search_events ADD COLUMN IF NOT EXISTS matched_drug_name text;
CREATE INDEX IF NOT EXISTS search_events_unavailable_created_at_idx
  ON search_events (created_at) WHERE unavailable_reason IS NOT NULL;
