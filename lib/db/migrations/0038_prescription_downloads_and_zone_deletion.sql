-- Prescription files leave MobiCare once the pharmacy has its own copy, and
-- HQ can delete delivery zones.
--
-- Prescriptions: the pharmacy downloads the image to its computer. Fifteen
-- minutes after the first download the file is deleted from storage. The
-- prescription row stays (who, when, what was approved or rejected); only
-- the image goes. downloaded_at is set once, by the first download.
--
-- Delivery zones: deleted zones disappear from HQ, from pricing and from
-- search areas, but the row stays so past orders keep their reference. Each
-- order also keeps its own copy of the zone name and the fee it paid.

ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS downloaded_at timestamptz;
ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS file_deleted_at timestamptz;

-- The clean-up job looks only at downloaded files that are still stored.
CREATE INDEX IF NOT EXISTS prescriptions_file_cleanup_idx
  ON prescriptions (downloaded_at)
  WHERE downloaded_at IS NOT NULL AND file_deleted_at IS NULL;

ALTER TABLE delivery_zones ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
