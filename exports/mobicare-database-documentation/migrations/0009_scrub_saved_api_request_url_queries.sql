BEGIN;

-- Query values belong in params_encrypted. Remove any interim values that may
-- have been embedded directly in the URL before that boundary existed.
UPDATE saved_api_requests
SET url = split_part(split_part(url, '?', 1), '#', 1)
WHERE url LIKE '%?%' OR url LIKE '%#%';

COMMIT;