-- HQ-managed patient advertisements and their short-lived direct-upload claims.
CREATE TABLE IF NOT EXISTS advertisements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  alt text,
  caption text,
  media_kind text NOT NULL CHECK (media_kind IN ('image', 'video')),
  object_path text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')),
  file_size integer NOT NULL CHECK (file_size > 0),
  link_url text CHECK (link_url IS NULL OR link_url ~* '^https?://'),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by_hq_staff_id uuid NOT NULL REFERENCES hq_staff(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS advertisements_public_display_idx
  ON advertisements (sort_order, created_at)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS advertisement_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by_hq_staff_id uuid NOT NULL REFERENCES hq_staff(id) ON DELETE CASCADE,
  object_path text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')),
  file_size integer NOT NULL CHECK (file_size > 0),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS advertisement_uploads_expiry_idx
  ON advertisement_uploads (expires_at) WHERE consumed_at IS NULL;