# Build Prompt: Pharmacy Inventory — Drug Entry Module

Use this prompt with your AI coding assistant (Claude Code, Cursor, etc.) to implement the feature. Paste it as-is, or trim sections that don't apply to your current sprint.

---

## Prompt

You are implementing the **Pharmacy Inventory Drug Entry module** for MobiCare (Node.js/Express backend, PostgreSQL database, Pharmacy Portal + HQ Dashboard + Patient PWA). This module governs how partner pharmacies add medicines to their inventory, and how that inventory is surfaced to patients. Data quality here is core to MobiCare's promise of real-time stock visibility — build accordingly, with validation enforced server-side, not left to pharmacist diligence.

### 1. Prerequisite: Master Drug Catalogue

Before building inventory entry, build the **centrally maintained master drug catalogue**. Pharmacies must select drugs from this catalogue — never free text — for these reasons:
- **Search integrity**: free text produces duplicate, unsearchable variants of the same drug (e.g., "Paracetamol," "paracetamol 500," "Panadol").
- **Safety**: `drug_tier` (which governs prescription review and controlled-substance handling) must be locked at the catalogue level. A pharmacy must never be able to set or alter this.
- **Cross-pharmacy aggregation**: demand and stock aggregation across the network only works if every pharmacy references the same drug by the same identifier.

**Catalogue entry structure:**
```
drug_catalogue
- drug_id              UUID / PK
- generic_name          TEXT (e.g., "Paracetamol")
- common_strengths[]    TEXT[] (e.g., ["250mg", "500mg"])
- common_forms[]        TEXT[] (e.g., ["tablet", "syrup"])
- drug_tier             ENUM: OPEN | PRESCRIPTION | CONTROLLED
- category              FK -> category taxonomy (see section 6)
```

**Catalogue governance:**
- Pharmacies can browse/search the catalogue and select from it, but **cannot create or edit catalogue entries directly.**
- If a pharmacy needs a drug not in the catalogue, build a **"Request New Drug"** flow: pharmacy submits generic name, strength, form, and suggested category → routes to an HQ review queue → HQ admin approves (creates the catalogue entry, sets `drug_tier`) or rejects with a reason.
- This catalogue and its request/review flow should be built and stable before the inventory entry screens depend on it.

### 2. Inventory Entry — Required Fields

A medicine cannot be saved to a pharmacy's inventory unless **all** of the following are provided and pass validation:

| Field | Type | Notes |
|---|---|---|
| `drug_id` | FK / Select | Selected from master catalogue, not free text |
| `strength` | Text | May pre-fill from the catalogue's `common_strengths` |
| `form` | Select | Tablet, capsule, syrup, injection, cream, etc. |
| `pharmacy_price` | Decimal | Pharmacy's own price, before MobiCare markup |
| `quantity_in_stock` | Integer | Actual unit count — not a boolean in-stock flag |
| `unit_of_sale` | Select | Per tablet, per vial, per bottle, per pack |
| `expiry_date` | Date | From physical packaging |
| `drug_tier` | Auto (read-only) | Inherited from catalogue; pharmacy cannot edit |

**Critical: `unit_of_sale` is not cosmetic.** A price of Le 1,955 per 100ml vial and Le 1,955 per tablet are different products entirely. Never render price to a patient without its unit.

### 3. Inventory Entry — Optional Fields

These enrich the patient experience but must never block a save:

| Field | Type | Notes |
|---|---|---|
| `brand_name` | Text | e.g., "Panadol" where generic is Paracetamol |
| `manufacturer` | Text | Free text for the pilot (see Phase 2 note) |
| `category` | Select | Must map to the taxonomy in section 6 and to patient-app filter chips |
| `country_of_origin` | Text | e.g., "India," "USA" |

### 4. Server-Side Validation Rules (enforce, do not rely on UI alone)

- **Expired stock**: reject any entry with an `expiry_date` in the past.
- **Quantity**: must be ≥ 0. Zero is valid (temporarily out of stock) but must render as unavailable to patients, not simply absent.
- **Price**: must be > 0, stored as `DECIMAL`, never `FLOAT`.
- **Duplicates**: prevent two active inventory records for the same pharmacy with identical `drug_id` + `strength` + `form` + `unit_of_sale`. On collision, prompt the pharmacy to update the existing record instead of creating a new one.

### 5. Explicitly Out of Scope for This Build (Phase 2 — do not implement now)

- **Batch/lot number** — deferred due to manual-transcription error risk; revisit alongside barcode/QR scanning in Phase 2. `expiry_date` alone covers baseline safety for the pilot.
- **Manufacturer as a controlled dropdown** — keep as free text for the pilot; convert to a catalogue-linked dropdown in Phase 2 once real onboarding data shows which manufacturers actually appear.
- **Product image and drug description fields** — removed from scope entirely. Do not build UI or schema for these.

### 6. Category Taxonomy

Implement `category` as a **two-tier controlled dropdown** (group → category within group) — a flat 40-item list is unusable on mobile. Structure:

```
Anti-infectives: Antibiotics, Antimalarials, Antifungals, Antivirals,
  Antiparasitics/Anthelmintics, Anti-tuberculosis

Pain, Inflammation and Fever: Pain Relief/Analgesics,
  Anti-inflammatory (NSAIDs), Anaesthetics

Cardiovascular and Blood: Cardiovascular, Antihypertensives,
  Blood Products & Plasma Expanders, Anticoagulants & Blood Thinners,
  Haematinics (Iron, Folic Acid, B12)

Chronic Conditions: Diabetes/Antidiabetics, Respiratory/Asthma,
  Thyroid & Hormonal

Gastrointestinal: Gastrointestinal, Antacids & Ulcer Treatment,
  Antidiarrhoeals & Rehydration

Neurological and Mental Health: Neurological, Antiepileptics,
  Psychiatric/Mental Health (controlled tier)

Maternal, Child and Reproductive Health: Maternal Health & Obstetrics,
  Contraceptives & Family Planning, Paediatric Formulations

Other Clinical Areas: Dermatological/Skin, Ophthalmic/Eye,
  ENT, Urological, Oncology, Immunosuppressants, Vaccines & Immunisation

Supportive and General: Vitamins & Supplements, Antihistamines & Allergy,
  Antiemetics, IV Fluids & Electrolytes, Medical Consumables & Devices,
  First Aid & Wound Care

Catch-all: Other (see below)
```

**"Other" category behavior:**
- Selecting "Other" reveals a free-text field — pharmacies must never be blocked from listing a legitimate medicine that doesn't fit an existing category.
- Entries under "Other" are flagged for HQ review, not silently promoted to a permanent category.
- HQ periodically reviews recurring free-text terms and promotes them into the controlled taxonomy when patterns emerge.
- Pharmacies can never create categories directly.

**Patient app filter chips:**
- Do not display all 40 categories as chips. Show only 8–12 highest-volume categories (e.g., All, Antibiotics, Antimalarials, Pain Relief, Cardiovascular) with the full taxonomy searchable, not chip-browsable.

### 7. Open Product Decisions (flag these back to the product owner — do not assume an answer)

- Should near-expiry stock (e.g., within 30 days) trigger a warning to the pharmacy, or only hard-block once actually expired?
- Who owns/maintains the master catalogue on an ongoing basis, and what's the committed turnaround time for a pharmacy's new-drug request?
- Does `quantity_in_stock` decrement automatically on order confirmation, or is it manually maintained by pharmacy staff? This materially affects the accuracy of "real-time" stock claims to patients — confirm before building the order-confirmation integration.

### 8. Acceptance Criteria

- [ ] Master drug catalogue exists and is queryable/searchable by pharmacies; pharmacies cannot create or edit entries directly.
- [ ] "Request New Drug" flow routes to an HQ review queue with approve/reject actions.
- [ ] Inventory entry form enforces all required fields; save is blocked (client and server) if any are missing.
- [ ] `drug_tier` is read-only and inherited from the catalogue on every inventory record.
- [ ] Server rejects expired `expiry_date`, negative `quantity_in_stock`, and price ≤ 0.
- [ ] Duplicate detection (same pharmacy + drug + strength + form + unit) blocks new-record creation and redirects to edit-existing.
- [ ] Category field is a working two-tier dropdown; "Other" reveals free text and flags the entry for HQ review.
- [ ] Patient-facing filter chips show only the curated high-volume subset, not all 40 categories.
- [ ] Batch/lot number, manufacturer dropdown, and product image/description fields are **not** present anywhere in this build.

---

Confirm the three open product decisions in Section 7 with your product owner before finalizing the order-confirmation and near-expiry warning logic — they affect schema and workflow decisions that are costly to retrofit later.
