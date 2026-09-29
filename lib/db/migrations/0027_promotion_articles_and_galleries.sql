-- Promotions gain an article and a picture gallery.
--
-- Patients now see each promotion as a card: its pictures, a short subject
-- (the title) and "Read more" for the full article. Some organisations send
-- several pictures for one promotion; those sit in advertisement_media and
-- are swiped through sideways. The first picture stays on the advertisement
-- row, so existing promotions keep working unchanged.

ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS organisation text;
ALTER TABLE advertisements ADD COLUMN IF NOT EXISTS body text;

CREATE TABLE IF NOT EXISTS advertisement_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advertisement_id uuid NOT NULL,
  object_path text NOT NULL,
  content_type text NOT NULL,
  file_size integer NOT NULL,
  media_kind text NOT NULL,
  alt text,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT advertisement_media_object_path_unique UNIQUE (object_path),
  CONSTRAINT advertisement_media_advertisement_id_advertisements_id_fk
    FOREIGN KEY (advertisement_id) REFERENCES advertisements(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS advertisement_media_advertisement_idx
  ON advertisement_media (advertisement_id);
