-- Pharmacies were being signed out of the portal after 7 days without using
-- it, and had to sign in again. They now stay signed in for 90 days (see
-- PHARMACY_SESSION_TTL_MS in the API); this gives sessions that are open now
-- the same 90 days, counted from when they were issued.
UPDATE refresh_tokens
SET expires_at = created_at + interval '90 days'
WHERE revoked_at IS NULL
  AND expires_at > now()
  AND expires_at < created_at + interval '90 days';

-- Passwords expire after 3 months. 90 days is already the default; raise a
-- shorter setting to it. HQ can still change it in Security & Settings.
UPDATE pharmacy_password_policy
SET max_password_age_days = 90, updated_at = now()
WHERE max_password_age_days < 90;
