ALTER TABLE hq_staff
  ADD COLUMN IF NOT EXISTS can_view_data_insights boolean NOT NULL DEFAULT false;

-- Existing active HQ staff retain operational access; accounts created after
-- this migration receive the secure false default above.
UPDATE hq_staff SET can_view_data_insights = true WHERE is_active = true;

CREATE TABLE IF NOT EXISTS search_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_query text,
  primary_category text,
  subcategory text,
  area_district text NOT NULL DEFAULT 'Unknown',
  result_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_events_created_at_idx ON search_events (created_at);
CREATE INDEX IF NOT EXISTS search_events_query_created_at_idx ON search_events (normalized_query, created_at);
CREATE INDEX IF NOT EXISTS search_events_area_created_at_idx ON search_events (area_district, created_at);