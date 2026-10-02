-- New catalogue categories for medicines on the national essential medicines
-- list that fitted none of the existing groups (vaccines, cancer medicines,
-- antidotes, eye, skin and ear preparations, and others).
--
-- Only adds values: no medicine changes category. ADD VALUE IF NOT EXISTS
-- makes each statement safe to re-run.

ALTER TYPE drug_primary_category ADD VALUE IF NOT EXISTS 'antidotes_poisoning';
ALTER TYPE drug_primary_category ADD VALUE IF NOT EXISTS 'cancer_immunosuppressants';
ALTER TYPE drug_primary_category ADD VALUE IF NOT EXISTS 'vaccines_immunologicals';
ALTER TYPE drug_primary_category ADD VALUE IF NOT EXISTS 'eye_preparations';
ALTER TYPE drug_primary_category ADD VALUE IF NOT EXISTS 'skin_preparations';
ALTER TYPE drug_primary_category ADD VALUE IF NOT EXISTS 'ear_nose_throat';

-- Subcategories of existing categories.
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'heart_failure_arrhythmia_shock';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'antispasmodics';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'hormones';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'chelating_agents';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'diluents_iv_preparation';

-- Subcategories of the new categories.
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'antidotes';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'adsorbents';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'antineoplastics';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'immunosuppressants';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'vaccines';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'antisera';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'immunoglobulins';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'glaucoma_medicines';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'mydriatics';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'eye_combinations';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'antiseptics';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'emollients';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'keratolytics';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'ear_preparations';
ALTER TYPE drug_subcategory ADD VALUE IF NOT EXISTS 'mouth_throat';
