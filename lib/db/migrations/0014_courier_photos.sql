ALTER TABLE "couriers" ADD COLUMN IF NOT EXISTS "photo_path" text;

CREATE TABLE IF NOT EXISTS "courier_photo_uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "courier_id" uuid NOT NULL REFERENCES "couriers"("id") ON DELETE CASCADE,
  "requested_by_hq_staff_id" uuid NOT NULL REFERENCES "hq_staff"("id") ON DELETE CASCADE,
  "object_path" text NOT NULL UNIQUE,
  "content_type" text NOT NULL,
  "file_size" integer NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);