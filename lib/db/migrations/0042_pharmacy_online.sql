-- A pharmacy is online while it is signed in to the portal on at least one
-- device (a sign-in that is neither signed out nor expired). Every patient
-- search asks this, so index the open sign-ins by pharmacy.
CREATE INDEX IF NOT EXISTS refresh_tokens_pharmacy_active_idx
  ON refresh_tokens (pharmacy_id, expires_at)
  WHERE revoked_at IS NULL;
