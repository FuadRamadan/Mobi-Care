-- MobiCare: upgrade the production database for the pilot fixes of 11 Oct 2026 (migration 0038).
-- Applies 1 migration(s): 0038_prescription_downloads_and_zone_deletion.sql
-- and re-records the regenerated baseline (executes nothing from it).
--
-- Run this BEFORE publishing the release: the new code refuses to start
-- until these columns exist. The change only adds columns and an index, so
-- the release that is live now keeps working on the updated database, and it
-- is what you go back to if the new release has to be withdrawn (tested).
--
-- Expects the database at 0037_search_insights.sql.
--
-- One transaction: if any statement fails, nothing is changed.
-- Refuses to run twice.

BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = '0000_baseline.sql') THEN
    RAISE EXCEPTION 'This database has no recorded baseline. It was not built by mobicare-init.sql. Nothing has been changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM schema_migrations WHERE filename IN ('0038_prescription_downloads_and_zone_deletion.sql')) THEN
    RAISE EXCEPTION 'Some of these migrations are already recorded: this upgrade has already been run. Nothing has been changed.';
  END IF;
END
$guard$;

-- The baseline file was regenerated to fold in the new migrations. Existing
-- databases accept the new file as equivalent; nothing in it is executed.
UPDATE schema_migrations SET checksum = 'c0d0abf2d93b6cdec83262b9d11445aaa615629b494e1930e719567e428e9e33' WHERE filename = '0000_baseline.sql';

-- ── 0038_prescription_downloads_and_zone_deletion.sql ─────────────────────

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

INSERT INTO schema_migrations (filename, checksum) VALUES ('0038_prescription_downloads_and_zone_deletion.sql', '0c77a09520de41d409613d461820c0f4b95c1db8a6eb834b6fbdcb5fd51adafa');

COMMIT;

-- Confirm (expect 38 rows, newest 0038_prescription_downloads_and_zone_deletion.sql):
--   SELECT count(*), max(filename) FROM schema_migrations;
