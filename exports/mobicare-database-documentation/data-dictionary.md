# MobiCare Database Data Dictionary

This document describes database structure only; it contains no row data.

## `api_connections`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `text` | NO | `` | PK |
| `provider` | `text` | NO | `` |  |
| `display_name` | `text` | NO | `` |  |
| `category` | `text` | NO | `` |  |
| `credentials_encrypted` | `text` | YES | `` |  |
| `public_config` | `jsonb` | NO | `'{}'::jsonb` |  |
| `is_enabled` | `bool` | NO | `false` |  |
| `last_tested_at` | `timestamptz` | YES | `` |  |
| `last_test_status` | `text` | YES | `` |  |
| `last_test_message` | `text` | YES | `` |  |
| `updated_by` | `uuid` | YES | `` | FK |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `updated_at` | `timestamptz` | NO | `now()` |  |

**Foreign keys**

- `updated_by` → `hq_staff.id` (on delete: SET NULL)

## `audit_log`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `actor_type` | `text` | NO | `` |  |
| `actor_id` | `uuid` | YES | `` |  |
| `actor_name` | `text` | YES | `` |  |
| `action` | `text` | NO | `` |  |
| `entity_type` | `text` | NO | `` |  |
| `entity_id` | `uuid` | YES | `` |  |
| `details` | `jsonb` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |

## `courier_settlements`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `courier_id` | `uuid` | NO | `` | FK |
| `amount_leones` | `int4` | NO | `` |  |
| `period_start` | `timestamptz` | NO | `` |  |
| `period_end` | `timestamptz` | NO | `` |  |
| `delivery_count` | `int4` | NO | `0` |  |
| `status` | `settlement_status` | NO | `'pending'::settlement_status` |  |
| `paid_at` | `timestamptz` | YES | `` |  |
| `reference` | `text` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `updated_at` | `timestamptz` | NO | `now()` |  |

**Foreign keys**

- `courier_id` → `couriers.id` (on delete: RESTRICT)

## `couriers`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `name` | `text` | NO | `` |  |
| `phone` | `text` | NO | `` |  |
| `vehicle_type` | `text` | NO | `'motorbike'::text` |  |
| `is_active` | `bool` | NO | `true` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `updated_at` | `timestamptz` | NO | `now()` |  |

## `drug_catalogue`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `name` | `text` | NO | `` |  |
| `generic_name` | `text` | YES | `` |  |
| `description` | `text` | YES | `` |  |
| `tier` | `drug_tier` | NO | `'3'::drug_tier` |  |
| `unit` | `text` | NO | `'tablets'::text` |  |
| `is_approved` | `bool` | NO | `true` |  |
| `proposed_by_pharmacy_id` | `uuid` | YES | `` | FK |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `updated_at` | `timestamptz` | NO | `now()` |  |
| `max_units_per_order` | `int4` | YES | `` |  |
| `common_strengths` | `_text` | NO | `'{}'::text[]` |  |
| `common_forms` | `_text` | NO | `'{}'::text[]` |  |
| `primary_category` | `drug_primary_category` | YES | `` |  |
| `subcategory` | `drug_subcategory` | YES | `` |  |
| `review_status` | `drug_review_status` | NO | `'approved'::drug_review_status` |  |
| `rejection_reason` | `text` | YES | `` |  |
| `reviewed_at` | `timestamptz` | YES | `` |  |
| `reviewed_by_hq_staff_id` | `uuid` | YES | `` | FK |

**Foreign keys**

- `proposed_by_pharmacy_id` → `pharmacies.id` (on delete: SET NULL)
- `reviewed_by_hq_staff_id` → `hq_staff.id` (on delete: SET NULL)

## `flags`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `order_id` | `uuid` | NO | `` | FK |
| `type` | `flag_type` | NO | `` |  |
| `reason` | `text` | NO | `` |  |
| `details` | `jsonb` | YES | `` |  |
| `status` | `flag_status` | NO | `'open'::flag_status` |  |
| `reviewed_by_hq_staff_id` | `uuid` | YES | `` |  |
| `review_note` | `text` | YES | `` |  |
| `reviewed_at` | `timestamptz` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |

**Foreign keys**

- `order_id` → `orders.id` (on delete: CASCADE)

## `hq_notifications`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `hq_staff_id` | `uuid` | NO | `` | FK |
| `title` | `text` | NO | `` |  |
| `body` | `text` | NO | `` |  |
| `type` | `text` | YES | `` |  |
| `reference_id` | `uuid` | YES | `` |  |
| `read_at` | `timestamptz` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |

**Foreign keys**

- `hq_staff_id` → `hq_staff.id` (on delete: CASCADE)

## `hq_refresh_tokens`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `hq_staff_id` | `uuid` | NO | `` | FK |
| `token_hash` | `text` | NO | `` |  |
| `expires_at` | `timestamptz` | NO | `` |  |
| `revoked_at` | `timestamptz` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |

**Foreign keys**

- `hq_staff_id` → `hq_staff.id` (on delete: CASCADE)

## `hq_staff`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `name` | `text` | NO | `` |  |
| `username` | `text` | NO | `` |  |
| `phone` | `text` | YES | `` |  |
| `is_active` | `bool` | NO | `true` |  |
| `password_hash` | `text` | NO | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `updated_at` | `timestamptz` | NO | `now()` |  |
| `can_manage_integrations` | `bool` | NO | `false` |  |

## `notifications`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `pharmacy_id` | `uuid` | NO | `` | FK |
| `title` | `text` | NO | `` |  |
| `body` | `text` | NO | `` |  |
| `type` | `text` | YES | `` |  |
| `reference_id` | `uuid` | YES | `` |  |
| `read_at` | `timestamptz` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |

**Foreign keys**

- `pharmacy_id` → `pharmacies.id` (on delete: CASCADE)

## `order_items`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `order_id` | `uuid` | NO | `` | FK |
| `drug_id` | `uuid` | NO | `` | FK |
| `drug_name` | `text` | NO | `` |  |
| `quantity` | `int4` | NO | `` |  |
| `unit_price_leones` | `numeric` | NO | `` |  |
| `prescription_id` | `uuid` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `inventory_id` | `uuid` | YES | `` | FK |

**Foreign keys**

- `drug_id` → `drug_catalogue.id` (on delete: RESTRICT)
- `inventory_id` → `pharmacy_inventory.id` (on delete: RESTRICT)
- `order_id` → `orders.id` (on delete: CASCADE)

## `orders`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `pharmacy_id` | `uuid` | NO | `` | FK |
| `patient_name` | `text` | NO | `` |  |
| `patient_phone` | `text` | NO | `` |  |
| `status` | `order_status` | NO | `'awaiting_payment'::order_status` |  |
| `fulfillment_type` | `fulfillment_type` | NO | `` |  |
| `id_checked` | `bool` | NO | `false` |  |
| `total_leones` | `numeric` | NO | `` |  |
| `prescription_id` | `uuid` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `updated_at` | `timestamptz` | NO | `now()` |  |
| `courier_id` | `uuid` | YES | `` |  |
| `cash_collected` | `bool` | NO | `false` |  |
| `cash_collected_at` | `timestamptz` | YES | `` |  |
| `payment_method` | `text` | NO | `'orange_money'::text` |  |
| `patient_id` | `uuid` | YES | `` |  |
| `delivery_address` | `text` | YES | `` |  |

**Foreign keys**

- `pharmacy_id` → `pharmacies.id` (on delete: RESTRICT)

## `patient_notifications`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `patient_id` | `uuid` | NO | `` | FK |
| `title` | `text` | NO | `` |  |
| `body` | `text` | NO | `` |  |
| `type` | `text` | YES | `` |  |
| `reference_id` | `uuid` | YES | `` |  |
| `read_at` | `timestamptz` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |

**Foreign keys**

- `patient_id` → `patients.id` (on delete: CASCADE)

## `patient_password_reset_codes`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `patient_id` | `uuid` | YES | `` | FK |
| `phone_hash` | `text` | NO | `` |  |
| `requester_hash` | `text` | NO | `` |  |
| `code_hash` | `text` | NO | `` |  |
| `attempt_count` | `int4` | NO | `0` |  |
| `expires_at` | `timestamptz` | NO | `` |  |
| `used_at` | `timestamptz` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |

**Foreign keys**

- `patient_id` → `patients.id` (on delete: CASCADE)

## `patient_refresh_tokens`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `patient_id` | `uuid` | NO | `` | FK |
| `token_hash` | `text` | NO | `` |  |
| `expires_at` | `timestamptz` | NO | `` |  |
| `revoked_at` | `timestamptz` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |

**Foreign keys**

- `patient_id` → `patients.id` (on delete: CASCADE)

## `patients`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `name` | `text` | NO | `` |  |
| `phone` | `text` | NO | `` |  |
| `password_hash` | `text` | NO | `` |  |
| `is_active` | `bool` | NO | `true` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `updated_at` | `timestamptz` | NO | `now()` |  |
| `expo_push_token` | `text` | YES | `` |  |
| `session_version` | `int4` | NO | `1` |  |

## `pharmacies`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `name` | `text` | NO | `` |  |
| `username` | `text` | NO | `` |  |
| `phone` | `text` | YES | `` |  |
| `address` | `text` | YES | `` |  |
| `location_lat` | `text` | YES | `` |  |
| `location_lng` | `text` | YES | `` |  |
| `is_active` | `bool` | NO | `true` |  |
| `controlled_substance_authorized` | `bool` | NO | `false` |  |
| `password_hash` | `text` | NO | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `updated_at` | `timestamptz` | NO | `now()` |  |
| `must_change_password` | `bool` | NO | `false` |  |
| `password_last_changed_at` | `timestamptz` | NO | `now()` |  |
| `temporary_password_expires_at` | `timestamptz` | YES | `` |  |
| `session_version` | `int4` | NO | `1` |  |

## `pharmacy_inventory`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `pharmacy_id` | `uuid` | NO | `` | FK |
| `drug_id` | `uuid` | NO | `` | FK |
| `price_leones` | `numeric` | NO | `` |  |
| `stock_quantity` | `int4` | NO | `0` |  |
| `available_for_delivery` | `bool` | NO | `true` |  |
| `available_for_collection` | `bool` | NO | `true` |  |
| `is_active` | `bool` | NO | `true` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `updated_at` | `timestamptz` | NO | `now()` |  |
| `brand` | `varchar` | YES | `` |  |
| `country_of_origin` | `varchar` | YES | `` |  |
| `low_stock_alert_at` | `int4` | NO | `10` |  |
| `strength` | `varchar` | YES | `` |  |
| `form` | `varchar` | YES | `` |  |
| `unit_of_sale` | `varchar` | YES | `` |  |
| `expiry_date` | `date` | YES | `` |  |
| `manufacturer` | `varchar` | YES | `` |  |
| `primary_category` | `drug_primary_category` | YES | `` |  |
| `subcategory` | `drug_subcategory` | YES | `` |  |
| `other_category_text` | `text` | YES | `` |  |
| `requires_hq_review` | `bool` | NO | `false` |  |
| `completion_status` | `inventory_completion_status` | NO | `'incomplete'::inventory_completion_status` |  |

**Foreign keys**

- `drug_id` → `drug_catalogue.id` (on delete: RESTRICT)
- `pharmacy_id` → `pharmacies.id` (on delete: CASCADE)

## `pharmacy_password_history`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `pharmacy_id` | `uuid` | NO | `` | FK |
| `password_hash` | `text` | NO | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `sequence` | `int4` | NO | `nextval('pharmacy_password_history_sequence_seq'::regclass)` |  |

**Foreign keys**

- `pharmacy_id` → `pharmacies.id` (on delete: CASCADE)

## `pharmacy_password_policy`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `int4` | NO | `1` | PK |
| `max_password_age_days` | `int4` | NO | `90` |  |
| `min_password_length` | `int4` | NO | `12` |  |
| `require_uppercase` | `bool` | NO | `true` |  |
| `require_lowercase` | `bool` | NO | `true` |  |
| `require_number` | `bool` | NO | `true` |  |
| `require_symbol` | `bool` | NO | `true` |  |
| `password_history_count` | `int4` | NO | `5` |  |
| `temporary_password_expiry_hours` | `int4` | NO | `24` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `updated_at` | `timestamptz` | NO | `now()` |  |
| `password_expiry_warning_days` | `int4` | NO | `7` |  |

## `prescription_uploads`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `patient_id` | `uuid` | NO | `` | FK |
| `image_key` | `text` | NO | `` |  |
| `consumed_at` | `timestamptz` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |

**Foreign keys**

- `patient_id` → `patients.id` (on delete: CASCADE)

## `prescriptions`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `pharmacy_id` | `uuid` | NO | `` | FK |
| `patient_name` | `text` | NO | `` |  |
| `patient_phone` | `text` | NO | `` |  |
| `image_key` | `text` | NO | `` |  |
| `status` | `prescription_status` | NO | `'pending'::prescription_status` |  |
| `approved_drug_ids` | `_uuid` | YES | `` |  |
| `reject_reason` | `prescription_reject_reason` | YES | `` |  |
| `reject_note` | `text` | YES | `` |  |
| `reviewed_at` | `timestamptz` | YES | `` |  |
| `order_id` | `uuid` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `updated_at` | `timestamptz` | NO | `now()` |  |

**Foreign keys**

- `pharmacy_id` → `pharmacies.id` (on delete: RESTRICT)

## `refresh_tokens`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `pharmacy_id` | `uuid` | NO | `` | FK |
| `token_hash` | `text` | NO | `` |  |
| `expires_at` | `timestamptz` | NO | `` |  |
| `revoked_at` | `timestamptz` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `session_version` | `int4` | NO | `1` |  |

**Foreign keys**

- `pharmacy_id` → `pharmacies.id` (on delete: CASCADE)

## `saved_api_request_history`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `request_id` | `uuid` | NO | `` | FK |
| `actor_id` | `uuid` | YES | `` | FK |
| `method` | `text` | NO | `` |  |
| `url` | `text` | NO | `` |  |
| `status` | `int4` | YES | `` |  |
| `duration_ms` | `int4` | NO | `` |  |
| `response_headers` | `jsonb` | NO | `'{}'::jsonb` |  |
| `response_body` | `text` | YES | `` |  |
| `error` | `text` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |

**Foreign keys**

- `actor_id` → `hq_staff.id` (on delete: SET NULL)
- `request_id` → `saved_api_requests.id` (on delete: CASCADE)

## `saved_api_requests`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `name` | `text` | NO | `` |  |
| `url` | `text` | NO | `` |  |
| `method` | `text` | NO | `` |  |
| `auth_type` | `text` | NO | `'none'::text` |  |
| `auth_config_encrypted` | `text` | YES | `` |  |
| `params` | `jsonb` | NO | `'[]'::jsonb` |  |
| `headers` | `jsonb` | NO | `'[]'::jsonb` |  |
| `body` | `text` | YES | `` |  |
| `created_by` | `uuid` | YES | `` | FK |
| `updated_by` | `uuid` | YES | `` | FK |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `updated_at` | `timestamptz` | NO | `now()` |  |
| `params_encrypted` | `text` | YES | `` |  |
| `headers_encrypted` | `text` | YES | `` |  |

**Foreign keys**

- `created_by` → `hq_staff.id` (on delete: SET NULL)
- `updated_by` → `hq_staff.id` (on delete: SET NULL)

## `settlements`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `pharmacy_id` | `uuid` | NO | `` | FK |
| `amount_leones` | `int4` | NO | `` |  |
| `period_start` | `timestamptz` | NO | `` |  |
| `period_end` | `timestamptz` | NO | `` |  |
| `order_count` | `int4` | NO | `0` |  |
| `status` | `settlement_status` | NO | `'pending'::settlement_status` |  |
| `paid_at` | `timestamptz` | YES | `` |  |
| `reference` | `text` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `updated_at` | `timestamptz` | NO | `now()` |  |

**Foreign keys**

- `pharmacy_id` → `pharmacies.id` (on delete: RESTRICT)

## `team_members`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `slug` | `text` | NO | `` |  |
| `name` | `text` | NO | `` |  |
| `role` | `text` | NO | `` |  |
| `photo_path` | `text` | YES | `` |  |
| `sort_order` | `int4` | NO | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |
| `updated_at` | `timestamptz` | NO | `now()` |  |

## `team_photo_uploads`

| Column | Type | Nullable | Default | Key |
|---|---|---:|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `team_member_id` | `uuid` | NO | `` | FK |
| `requested_by_hq_staff_id` | `uuid` | NO | `` | FK |
| `object_path` | `text` | NO | `` |  |
| `content_type` | `text` | NO | `` |  |
| `file_size` | `int4` | NO | `` |  |
| `expires_at` | `timestamptz` | NO | `` |  |
| `consumed_at` | `timestamptz` | YES | `` |  |
| `created_at` | `timestamptz` | NO | `now()` |  |

**Foreign keys**

- `requested_by_hq_staff_id` → `hq_staff.id` (on delete: CASCADE)
- `team_member_id` → `team_members.id` (on delete: CASCADE)
