-- A separate permission for the master catalogue.
--
-- A medicine's tier decides whether it needs a prescription, and bulk
-- catalogue imports can change many medicines at once, so catalogue changes
-- now need their own permission. Every existing HQ account could already
-- change the catalogue, so they keep that ability; new accounts start
-- without it.

ALTER TABLE hq_staff
  ADD COLUMN IF NOT EXISTS can_manage_catalogue boolean DEFAULT false NOT NULL;

-- One-off: existing staff keep the access they had. Safe to re-run, because
-- the migration runner applies each migration once.
UPDATE hq_staff SET can_manage_catalogue = true;
