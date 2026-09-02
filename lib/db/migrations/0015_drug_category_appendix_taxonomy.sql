-- Replace legacy enum labels without dropping catalogue or inventory data.
-- Values are first made text so every legacy value can be mapped safely.
ALTER TABLE "drug_catalogue" ALTER COLUMN "primary_category" TYPE text USING "primary_category"::text;
ALTER TABLE "drug_catalogue" ALTER COLUMN "subcategory" TYPE text USING "subcategory"::text;
ALTER TABLE "pharmacy_inventory" ALTER COLUMN "primary_category" TYPE text USING "primary_category"::text;
ALTER TABLE "pharmacy_inventory" ALTER COLUMN "subcategory" TYPE text USING "subcategory"::text;
DROP TYPE IF EXISTS "drug_primary_category";
DROP TYPE IF EXISTS "drug_subcategory";

CREATE TYPE "drug_primary_category" AS ENUM (
  'cardiovascular','pain_inflammation','anti_infectives','gastrointestinal_nutrition',
  'endocrine_reproductive','respiratory_allergy','psychiatric_mental_health',
  'blood_products_plasma_expanders'
);
CREATE TYPE "drug_subcategory" AS ENUM (
  'antihypertensives','antianginals','anticoagulants','lipid_lowering','diuretics',
  'analgesics_antipyretics','anti_inflammatory','anaesthetics','muscle_relaxants','gout_medicines',
  'antibiotics','antimalarials','antifungals','antivirals','antiparasitics',
  'antacids_antiulcer','antiemetics','laxatives','antidiarrheals_ors','vitamins_minerals',
  'diabetes','thyroid_medicines','corticosteroids','contraceptives','maternal_health',
  'asthma_copd','cough_cold','antihistamines','nasal_preparations','respiratory_other',
  'controlled_sedatives','antidepressants','antipsychotics','antiepileptics','neurological_medicines',
  'blood_products','plasma_expanders','human_albumin','haematinics','other'
);

-- Preserve old rows in their closest appendix bucket. This is deliberately
-- expressed on both tables because inventory has its own display categories.
UPDATE "drug_catalogue" SET
  "primary_category" = CASE "primary_category"
    WHEN 'cardiovascular' THEN 'cardiovascular'
    WHEN 'pain_fever' THEN 'pain_inflammation'
    WHEN 'infection' THEN 'anti_infectives'
    WHEN 'malaria' THEN 'anti_infectives'
    WHEN 'digestive' THEN 'gastrointestinal_nutrition'
    WHEN 'diabetes_endocrine' THEN 'endocrine_reproductive'
    WHEN 'womens_reproductive' THEN 'endocrine_reproductive'
    WHEN 'respiratory_allergy' THEN 'respiratory_allergy'
    WHEN 'mental_neurological' THEN 'psychiatric_mental_health'
    WHEN 'other' THEN 'blood_products_plasma_expanders'
    ELSE 'gastrointestinal_nutrition' END,
  "subcategory" = CASE "subcategory"
    WHEN 'analgesics_antipyretics' THEN 'analgesics_antipyretics' WHEN 'anti_inflammatory' THEN 'anti_inflammatory'
    WHEN 'antibiotics' THEN 'antibiotics' WHEN 'antimalarials' THEN 'antimalarials'
    WHEN 'antifungal_antiparasitic' THEN 'antifungals' WHEN 'cough_cold' THEN 'cough_cold'
    WHEN 'allergy' THEN 'antihistamines' WHEN 'hypertension' THEN 'antihypertensives'
    WHEN 'diabetes' THEN 'diabetes' WHEN 'maternal_health' THEN 'maternal_health'
    WHEN 'reproductive_health' THEN 'contraceptives' WHEN 'mental_health' THEN 'antidepressants'
    WHEN 'neurological' THEN 'neurological_medicines' WHEN 'vitamins_minerals' THEN 'vitamins_minerals'
    WHEN 'oral_rehydration' THEN 'antidiarrheals_ors' ELSE 'other' END
WHERE "primary_category" IS NOT NULL;
UPDATE "pharmacy_inventory" SET
  "primary_category" = CASE "primary_category"
    WHEN 'cardiovascular' THEN 'cardiovascular' WHEN 'pain_fever' THEN 'pain_inflammation'
    WHEN 'infection' THEN 'anti_infectives' WHEN 'malaria' THEN 'anti_infectives'
    WHEN 'digestive' THEN 'gastrointestinal_nutrition' WHEN 'diabetes_endocrine' THEN 'endocrine_reproductive'
    WHEN 'womens_reproductive' THEN 'endocrine_reproductive' WHEN 'respiratory_allergy' THEN 'respiratory_allergy'
    WHEN 'mental_neurological' THEN 'psychiatric_mental_health' WHEN 'other' THEN 'blood_products_plasma_expanders'
    ELSE 'gastrointestinal_nutrition' END,
  "subcategory" = CASE "subcategory"
    WHEN 'analgesics_antipyretics' THEN 'analgesics_antipyretics' WHEN 'anti_inflammatory' THEN 'anti_inflammatory'
    WHEN 'antibiotics' THEN 'antibiotics' WHEN 'antimalarials' THEN 'antimalarials'
    WHEN 'antifungal_antiparasitic' THEN 'antifungals' WHEN 'cough_cold' THEN 'cough_cold'
    WHEN 'allergy' THEN 'antihistamines' WHEN 'hypertension' THEN 'antihypertensives'
    WHEN 'diabetes' THEN 'diabetes' WHEN 'maternal_health' THEN 'maternal_health'
    WHEN 'reproductive_health' THEN 'contraceptives' WHEN 'mental_health' THEN 'antidepressants'
    WHEN 'neurological' THEN 'neurological_medicines' WHEN 'vitamins_minerals' THEN 'vitamins_minerals'
    WHEN 'oral_rehydration' THEN 'antidiarrheals_ors' ELSE 'other' END
WHERE "primary_category" IS NOT NULL;

ALTER TABLE "drug_catalogue" ALTER COLUMN "primary_category" TYPE "drug_primary_category" USING "primary_category"::"drug_primary_category";
ALTER TABLE "drug_catalogue" ALTER COLUMN "subcategory" TYPE "drug_subcategory" USING "subcategory"::"drug_subcategory";
ALTER TABLE "pharmacy_inventory" ALTER COLUMN "primary_category" TYPE "drug_primary_category" USING "primary_category"::"drug_primary_category";
ALTER TABLE "pharmacy_inventory" ALTER COLUMN "subcategory" TYPE "drug_subcategory" USING "subcategory"::"drug_subcategory";

UPDATE "drug_catalogue"
SET "primary_category" = 'blood_products_plasma_expanders', "subcategory" = 'human_albumin'
WHERE lower("name") LIKE '%human albumin%' OR lower(coalesce("generic_name", '')) LIKE '%human albumin%';
UPDATE "drug_catalogue"
SET "primary_category" = 'psychiatric_mental_health', "subcategory" = 'controlled_sedatives',
    "tier" = '1', "max_units_per_order" = coalesce("max_units_per_order", 30)
WHERE lower("name") LIKE '%diazepam%' OR lower(coalesce("generic_name", '')) LIKE '%diazepam%';