ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "patient_hidden_at" timestamp with time zone;
