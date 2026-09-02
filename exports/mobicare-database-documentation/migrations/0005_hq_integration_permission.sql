BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'hq_staff'
      AND column_name = 'can_manage_integrations'
  ) THEN
    ALTER TABLE hq_staff
      ADD COLUMN can_manage_integrations boolean NOT NULL DEFAULT false;

    -- Accounts that predate granular HQ permissions are the original
    -- administrators. Future accounts remain least-privilege by default.
    UPDATE hq_staff SET can_manage_integrations = true;
  END IF;
END
$$;

COMMIT;