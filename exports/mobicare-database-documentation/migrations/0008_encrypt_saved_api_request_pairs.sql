BEGIN;

DO $$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'saved_api_requests'
    AND column_name = 'params_encrypted'
) THEN
  ALTER TABLE saved_api_requests
    ADD COLUMN params_encrypted text,
    ADD COLUMN headers_encrypted text;

  -- This feature has not shipped. Destroy any interim plaintext rather than
  -- attempting to preserve credentials without access to the application key.
  UPDATE saved_api_requests
  SET params = COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'key', item->>'key',
        'value', CASE WHEN COALESCE(item->>'value', '') = '' THEN '' ELSE '••••••••' END
      ) ORDER BY ordinal)
      FROM jsonb_array_elements(params) WITH ORDINALITY AS values_with_order(item, ordinal)
    ), '[]'::jsonb),
    headers = COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'key', item->>'key',
        'value', CASE WHEN COALESCE(item->>'value', '') = '' THEN '' ELSE '••••••••' END
      ) ORDER BY ordinal)
      FROM jsonb_array_elements(headers) WITH ORDINALITY AS values_with_order(item, ordinal)
    ), '[]'::jsonb),
      params_encrypted = NULL,
      headers_encrypted = NULL;
END IF;
END
$$;

COMMIT;