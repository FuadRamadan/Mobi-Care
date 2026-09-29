-- Several brands of the same medicine at one pharmacy.
--
-- A pharmacy could list a medicine only once per strength, form and pack,
-- so a branded product and a cheaper generic of the same medicine could not
-- both be offered. The rule now also includes the brand and manufacturer:
-- each distinct product is its own listing with its own price.
--
-- Listings saved without a brand become "Generic", the label patients see
-- for unbranded products. Order lines now record the brand, manufacturer and
-- country of origin that were bought.

UPDATE pharmacy_inventory
   SET brand = 'Generic'
 WHERE brand IS NULL OR btrim(brand) = '';

-- The new rule is looser than the old one, so no existing listing can
-- conflict with it.
DROP INDEX IF EXISTS uniq_active_pharmacy_drug_variant;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_pharmacy_listing
  ON pharmacy_inventory (
    pharmacy_id, drug_id, strength, form, unit_of_sale,
    lower(brand), lower(coalesce(manufacturer, ''))
  )
  WHERE is_active = true;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS manufacturer text;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS country_of_origin text;
