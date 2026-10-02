-- 1. Strength + form combinations.
--
-- A medicine's strengths and forms were two independent lists, so any
-- strength could be listed in any form (Paracetamol 50mg tablet, when 50mg is
-- the suppository). variants records the combinations that exist. Empty means
-- every strength comes in every form, which is what every existing entry
-- allowed, so nothing changes until HQ narrows an entry down.

ALTER TABLE drug_catalogue
  ADD COLUMN IF NOT EXISTS variants jsonb DEFAULT '[]'::jsonb NOT NULL;

-- 2. One spelling per form.
--
-- The catalogue mixed "tablet" and "Tablet", and listings had to match the
-- catalogue's capitals exactly. Matching now ignores capitals; this gives each
-- form a capital first letter ("tablet" -> "Tablet", "Powder for Injection"
-- unchanged) and removes entries repeated in different capitals, keeping the
-- first. Strengths keep their spelling and only lose such repeats.

WITH forms AS (
  SELECT d.id, x.ord, btrim(regexp_replace(x.value, '\s+', ' ', 'g')) AS value
  FROM drug_catalogue d, unnest(d.common_forms) WITH ORDINALITY AS x(value, ord)
), firsts AS (
  SELECT id, min(ord) AS ord, (array_agg(value ORDER BY ord))[1] AS value
  FROM forms WHERE value <> '' GROUP BY id, lower(value)
), rebuilt AS (
  SELECT id, array_agg(upper(left(value, 1)) || substr(value, 2) ORDER BY ord) AS forms
  FROM firsts GROUP BY id
)
UPDATE drug_catalogue d SET common_forms = r.forms
FROM rebuilt r
WHERE r.id = d.id AND d.common_forms IS DISTINCT FROM r.forms;

WITH strengths AS (
  SELECT d.id, x.ord, btrim(regexp_replace(x.value, '\s+', ' ', 'g')) AS value
  FROM drug_catalogue d, unnest(d.common_strengths) WITH ORDINALITY AS x(value, ord)
), firsts AS (
  SELECT id, min(ord) AS ord, (array_agg(value ORDER BY ord))[1] AS value
  FROM strengths WHERE value <> '' GROUP BY id, lower(value)
), rebuilt AS (
  SELECT id, array_agg(value ORDER BY ord) AS strengths FROM firsts GROUP BY id
)
UPDATE drug_catalogue d SET common_strengths = r.strengths
FROM rebuilt r
WHERE r.id = d.id AND d.common_strengths IS DISTINCT FROM r.strengths;

-- Listings take their medicine's spelling of the same strength and form, so
-- the same product is grouped together for patients. A listing is left as it
-- is if the new spelling would make it identical to another active listing
-- (the one-active-listing-per-product rule); the pharmacy can merge those.

WITH canonical AS (
  SELECT p.id,
    coalesce((SELECT s FROM unnest(d.common_strengths) AS s WHERE lower(s) = lower(btrim(p.strength)) LIMIT 1), p.strength) AS strength,
    coalesce((SELECT f FROM unnest(d.common_forms) AS f WHERE lower(f) = lower(btrim(p.form)) LIMIT 1), p.form) AS form
  FROM pharmacy_inventory p
  JOIN drug_catalogue d ON d.id = p.drug_id
  WHERE p.strength IS NOT NULL AND p.form IS NOT NULL
)
UPDATE pharmacy_inventory p
SET strength = c.strength, form = c.form
FROM canonical c
WHERE c.id = p.id
  AND (p.strength IS DISTINCT FROM c.strength OR p.form IS DISTINCT FROM c.form)
  AND NOT (
    p.is_active AND EXISTS (
      SELECT 1 FROM pharmacy_inventory q
      WHERE q.id <> p.id
        AND q.is_active
        AND q.pharmacy_id = p.pharmacy_id
        AND q.drug_id = p.drug_id
        AND lower(btrim(q.strength)) = lower(btrim(p.strength))
        AND lower(btrim(q.form)) = lower(btrim(p.form))
        AND q.unit_of_sale IS NOT DISTINCT FROM p.unit_of_sale
        AND lower(q.brand) IS NOT DISTINCT FROM lower(p.brand)
        AND lower(coalesce(q.manufacturer, '')) = lower(coalesce(p.manufacturer, ''))
    )
  );
