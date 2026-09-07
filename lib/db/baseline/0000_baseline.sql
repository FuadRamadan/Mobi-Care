-- MobiCare baseline schema — generated, do not hand-edit.
--
-- Captures the complete database as of the latest migration: the Drizzle model
-- plus the cumulative effect of every migration in lib/db/migrations. It exists
-- because those migrations begin at 0001 with ALTER statements and therefore
-- cannot build an empty database on their own.
--
-- Regenerate with: lib/db/scripts/generate-baseline.sh
-- Apply with:      node lib/db/scripts/migrate-tracked.mjs --init
--
-- NOT idempotent: it issues bare CREATE statements and will fail on a database
-- that already has these objects. Run it only through migrate-tracked.mjs,
-- which records it in schema_migrations, never applies it twice, and wraps it
-- in a transaction so a failure leaves the database untouched.
--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: commission_settlement_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."commission_settlement_status" AS ENUM (
    'unpaid',
    'partially_paid',
    'paid'
);


--
-- Name: delivery_confirmation_method; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."delivery_confirmation_method" AS ENUM (
    'patient',
    'hq'
);


--
-- Name: drug_primary_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."drug_primary_category" AS ENUM (
    'cardiovascular',
    'pain_inflammation',
    'anti_infectives',
    'gastrointestinal_nutrition',
    'endocrine_reproductive',
    'respiratory_allergy',
    'psychiatric_mental_health',
    'blood_products_plasma_expanders'
);


--
-- Name: drug_review_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."drug_review_status" AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: drug_subcategory; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."drug_subcategory" AS ENUM (
    'antihypertensives',
    'antianginals',
    'anticoagulants',
    'lipid_lowering',
    'diuretics',
    'analgesics_antipyretics',
    'anti_inflammatory',
    'anaesthetics',
    'muscle_relaxants',
    'gout_medicines',
    'antibiotics',
    'antimalarials',
    'antifungals',
    'antivirals',
    'antiparasitics',
    'antacids_antiulcer',
    'antiemetics',
    'laxatives',
    'antidiarrheals_ors',
    'vitamins_minerals',
    'diabetes',
    'thyroid_medicines',
    'corticosteroids',
    'contraceptives',
    'maternal_health',
    'asthma_copd',
    'cough_cold',
    'antihistamines',
    'nasal_preparations',
    'respiratory_other',
    'controlled_sedatives',
    'antidepressants',
    'antipsychotics',
    'antiepileptics',
    'neurological_medicines',
    'blood_products',
    'plasma_expanders',
    'human_albumin',
    'haematinics',
    'other'
);


--
-- Name: drug_tier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."drug_tier" AS ENUM (
    '1',
    '2',
    '3'
);


--
-- Name: flag_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."flag_status" AS ENUM (
    'open',
    'reviewed'
);


--
-- Name: flag_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."flag_type" AS ENUM (
    'velocity',
    'duplicate',
    'payment_anomaly'
);


--
-- Name: fulfillment_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."fulfillment_type" AS ENUM (
    'delivery',
    'collection'
);


--
-- Name: inventory_completion_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."inventory_completion_status" AS ENUM (
    'incomplete',
    'complete'
);


--
-- Name: order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."order_status" AS ENUM (
    'awaiting_payment',
    'paid',
    'confirmed',
    'packaging',
    'ready',
    'assigned',
    'picked_up',
    'delivering',
    'delivered',
    'collected',
    'cancelled'
);


--
-- Name: prescription_reject_reason; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."prescription_reject_reason" AS ENUM (
    'illegible_image',
    'expired_prescription',
    'invalid_prescription',
    'drug_unavailable',
    'controlled_substance_not_authorized',
    'patient_mismatch',
    'quantity_exceeded'
);


--
-- Name: prescription_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."prescription_status" AS ENUM (
    'pending',
    'approved',
    'rejected'
);


--
-- Name: settlement_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "public"."settlement_status" AS ENUM (
    'pending',
    'paid'
);


--
-- Name: trim_saved_api_request_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION "public"."trim_saved_api_request_history"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  DELETE FROM saved_api_request_history
  WHERE request_id = NEW.request_id
    AND id IN (
      SELECT id FROM saved_api_request_history
      WHERE request_id = NEW.request_id
      ORDER BY created_at DESC, id DESC
      OFFSET 50
    );
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: advertisement_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."advertisement_uploads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requested_by_hq_staff_id" "uuid" NOT NULL,
    "object_path" "text" NOT NULL,
    "content_type" "text" NOT NULL,
    "file_size" integer NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: advertisements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."advertisements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "alt" "text",
    "caption" "text",
    "media_kind" "text" NOT NULL,
    "object_path" "text" NOT NULL,
    "content_type" "text" NOT NULL,
    "file_size" integer NOT NULL,
    "link_url" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "created_by_hq_staff_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: api_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."api_connections" (
    "id" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "credentials_encrypted" "text",
    "public_config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_enabled" boolean DEFAULT false NOT NULL,
    "last_tested_at" timestamp with time zone,
    "last_test_status" "text",
    "last_test_message" "text",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_type" "text" NOT NULL,
    "actor_id" "uuid",
    "actor_name" "text",
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: commission_settlement_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."commission_settlement_adjustments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "settlement_id" "uuid" NOT NULL,
    "amount_minor" integer NOT NULL,
    "reason" "text" NOT NULL,
    "source_order_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: commission_settlement_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."commission_settlement_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "settlement_id" "uuid" NOT NULL,
    "amount_minor" integer NOT NULL,
    "paid_at" timestamp with time zone NOT NULL,
    "payment_reference" "text" NOT NULL,
    "recorded_by_hq_staff_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: commission_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."commission_settlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pharmacy_id" "uuid" NOT NULL,
    "settlement_date" "date" NOT NULL,
    "business_timezone" "text" NOT NULL,
    "orders_count" integer NOT NULL,
    "gross_collected_minor" integer NOT NULL,
    "drug_amount_total_minor" integer NOT NULL,
    "commission_due_minor" integer NOT NULL,
    "amount_paid_minor" integer DEFAULT 0 NOT NULL,
    "balance_minor" integer NOT NULL,
    "status" "public"."commission_settlement_status" DEFAULT 'unpaid'::"public"."commission_settlement_status" NOT NULL,
    "paid_at" timestamp with time zone,
    "payment_reference" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: courier_photo_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."courier_photo_uploads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "courier_id" "uuid" NOT NULL,
    "requested_by_hq_staff_id" "uuid" NOT NULL,
    "object_path" "text" NOT NULL,
    "content_type" "text" NOT NULL,
    "file_size" integer NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: courier_settlement_duplicate_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."courier_settlement_duplicate_archive" (
    "id" "uuid",
    "courier_id" "uuid",
    "amount_leones" integer,
    "amount_minor" integer,
    "period_start" timestamp with time zone,
    "period_end" timestamp with time zone,
    "delivery_count" integer,
    "status" "public"."settlement_status",
    "paid_at" timestamp with time zone,
    "reference" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "canonical_settlement_id" "uuid" NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: courier_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."courier_settlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "courier_id" "uuid" NOT NULL,
    "amount_leones" integer NOT NULL,
    "amount_minor" integer DEFAULT 0 NOT NULL,
    "period_start" timestamp with time zone NOT NULL,
    "period_end" timestamp with time zone NOT NULL,
    "delivery_count" integer DEFAULT 0 NOT NULL,
    "status" "public"."settlement_status" DEFAULT 'pending'::"public"."settlement_status" NOT NULL,
    "paid_at" timestamp with time zone,
    "reference" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: couriers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."couriers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "vehicle_type" "text" DEFAULT 'motorbike'::"text" NOT NULL,
    "photo_path" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


--
-- Name: drug_catalogue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."drug_catalogue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "generic_name" "text",
    "description" "text",
    "tier" "public"."drug_tier" DEFAULT '3'::"public"."drug_tier" NOT NULL,
    "unit" "text" DEFAULT 'tablets'::"text" NOT NULL,
    "common_strengths" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "common_forms" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "primary_category" "public"."drug_primary_category",
    "subcategory" "public"."drug_subcategory",
    "is_approved" boolean DEFAULT true NOT NULL,
    "review_status" "public"."drug_review_status" DEFAULT 'approved'::"public"."drug_review_status" NOT NULL,
    "rejection_reason" "text",
    "reviewed_at" timestamp with time zone,
    "reviewed_by_hq_staff_id" "uuid",
    "max_units_per_order" integer,
    "proposed_by_pharmacy_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: financial_migration_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."financial_migration_state" (
    "key" "text" NOT NULL,
    "applied_at" timestamp with time zone NOT NULL
);


--
-- Name: flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."flags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "type" "public"."flag_type" NOT NULL,
    "reason" "text" NOT NULL,
    "details" "jsonb",
    "status" "public"."flag_status" DEFAULT 'open'::"public"."flag_status" NOT NULL,
    "reviewed_by_hq_staff_id" "uuid",
    "review_note" "text",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: hq_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."hq_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hq_staff_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "type" "text",
    "reference_id" "uuid",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: hq_refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."hq_refresh_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hq_staff_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: hq_staff; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."hq_staff" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "username" "text" NOT NULL,
    "phone" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "can_manage_integrations" boolean DEFAULT false NOT NULL,
    "can_manage_settlements" boolean DEFAULT false NOT NULL,
    "can_view_data_insights" boolean DEFAULT false NOT NULL,
    "password_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pharmacy_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "type" "text",
    "reference_id" "uuid",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."order_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "drug_id" "uuid" NOT NULL,
    "inventory_id" "uuid",
    "drug_name" "text" NOT NULL,
    "quantity" integer NOT NULL,
    "unit_price_leones" numeric(12,2) NOT NULL,
    "base_unit_price_minor" integer DEFAULT 0 NOT NULL,
    "patient_unit_price_minor" integer DEFAULT 0 NOT NULL,
    "patient_line_total_minor" integer DEFAULT 0 NOT NULL,
    "prescription_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pharmacy_id" "uuid" NOT NULL,
    "patient_name" "text" NOT NULL,
    "patient_phone" "text" NOT NULL,
    "patient_id" "uuid",
    "delivery_address" "text",
    "status" "public"."order_status" DEFAULT 'awaiting_payment'::"public"."order_status" NOT NULL,
    "fulfillment_type" "public"."fulfillment_type" NOT NULL,
    "id_checked" boolean DEFAULT false NOT NULL,
    "total_leones" numeric(14,2) NOT NULL,
    "medicine_markup_basis_points" integer DEFAULT 500 NOT NULL,
    "pharmacy_medicine_total_minor" integer DEFAULT 0 NOT NULL,
    "medicine_commission_minor" integer DEFAULT 0 NOT NULL,
    "patient_medicine_total_minor" integer DEFAULT 0 NOT NULL,
    "delivery_fee_minor" integer DEFAULT 0 NOT NULL,
    "courier_payout_minor" integer DEFAULT 0 NOT NULL,
    "delivery_commission_minor" integer DEFAULT 0 NOT NULL,
    "prescription_id" "uuid",
    "courier_id" "uuid",
    "cash_collected" boolean DEFAULT false NOT NULL,
    "cash_collected_at" timestamp with time zone,
    "payment_method" "text" DEFAULT 'orange_money'::"text" NOT NULL,
    "completed_at" timestamp with time zone,
    "delivery_confirmed_at" timestamp with time zone,
    "delivery_confirmation_method" "public"."delivery_confirmation_method",
    "delivery_confirmed_by_hq_user_id" "uuid",
    "patient_hidden_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: patient_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."patient_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "patient_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "type" "text",
    "reference_id" "uuid",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: patient_password_reset_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."patient_password_reset_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "patient_id" "uuid",
    "phone_hash" "text" NOT NULL,
    "requester_hash" "text" NOT NULL,
    "code_hash" "text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: patient_refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."patient_refresh_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "patient_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: patients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."patients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "password_hash" "text" NOT NULL,
    "age" integer DEFAULT 18 NOT NULL,
    "date_of_birth" "date",
    "nin" "text",
    "address" "text",
    "email" "text",
    "nationality" "text",
    "profile_image_key" "text",
    "session_version" integer DEFAULT 1 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "expo_push_token" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "patients_age_adult_check" CHECK (("age" >= 18))
);


--
-- Name: pharmacies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."pharmacies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "username" "text" NOT NULL,
    "phone" "text",
    "address" "text",
    "email" "text",
    "orange_money_number" "text",
    "afri_money_number" "text",
    "mobile_money_number" "text",
    "mobile_money_provider" "text",
    "mobile_money_account_name" "text",
    "latitude" "text",
    "longitude" "text",
    "location_lat" "text",
    "location_lng" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "controlled_substance_authorized" boolean DEFAULT false NOT NULL,
    "must_change_password" boolean DEFAULT false NOT NULL,
    "password_hash" "text" NOT NULL,
    "password_last_changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "temporary_password_expires_at" timestamp with time zone,
    "session_version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: pharmacy_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."pharmacy_inventory" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pharmacy_id" "uuid" NOT NULL,
    "drug_id" "uuid" NOT NULL,
    "strength" character varying(50),
    "form" character varying(50),
    "unit_of_sale" character varying(80),
    "expiry_date" "date",
    "brand" character varying(100),
    "manufacturer" character varying(150),
    "country_of_origin" character varying(100),
    "primary_category" "public"."drug_primary_category",
    "subcategory" "public"."drug_subcategory",
    "other_category_text" "text",
    "requires_hq_review" boolean DEFAULT false NOT NULL,
    "completion_status" "public"."inventory_completion_status" DEFAULT 'incomplete'::"public"."inventory_completion_status" NOT NULL,
    "price_leones" numeric(12,2) NOT NULL,
    "stock_quantity" integer DEFAULT 0 NOT NULL,
    "low_stock_alert_at" integer DEFAULT 10 NOT NULL,
    "available_for_delivery" boolean DEFAULT true NOT NULL,
    "available_for_collection" boolean DEFAULT true NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: pharmacy_password_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."pharmacy_password_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sequence" integer NOT NULL,
    "pharmacy_id" "uuid" NOT NULL,
    "password_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: pharmacy_password_history_sequence_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE "public"."pharmacy_password_history_sequence_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pharmacy_password_history_sequence_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE "public"."pharmacy_password_history_sequence_seq" OWNED BY "public"."pharmacy_password_history"."sequence";


--
-- Name: pharmacy_password_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."pharmacy_password_policy" (
    "id" integer DEFAULT 1 NOT NULL,
    "max_password_age_days" integer DEFAULT 90 NOT NULL,
    "password_expiry_warning_days" integer DEFAULT 7 NOT NULL,
    "min_password_length" integer DEFAULT 12 NOT NULL,
    "require_uppercase" boolean DEFAULT true NOT NULL,
    "require_lowercase" boolean DEFAULT true NOT NULL,
    "require_number" boolean DEFAULT true NOT NULL,
    "require_symbol" boolean DEFAULT true NOT NULL,
    "password_history_count" integer DEFAULT 5 NOT NULL,
    "temporary_password_expiry_hours" integer DEFAULT 24 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: platform_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."platform_settings" (
    "key" "text" NOT NULL,
    "value" integer NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: prescription_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."prescription_uploads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "patient_id" "uuid" NOT NULL,
    "image_key" "text" NOT NULL,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: prescriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."prescriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pharmacy_id" "uuid" NOT NULL,
    "patient_name" "text" NOT NULL,
    "patient_phone" "text" NOT NULL,
    "image_key" "text" NOT NULL,
    "status" "public"."prescription_status" DEFAULT 'pending'::"public"."prescription_status" NOT NULL,
    "approved_drug_ids" "uuid"[],
    "reject_reason" "public"."prescription_reject_reason",
    "reject_note" "text",
    "reviewed_at" timestamp with time zone,
    "order_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."refresh_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pharmacy_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "session_version" integer DEFAULT 1 NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: saved_api_request_execution_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."saved_api_request_execution_claims" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: saved_api_request_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."saved_api_request_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "request_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "method" "text" NOT NULL,
    "url" "text" NOT NULL,
    "status" integer,
    "duration_ms" integer NOT NULL,
    "response_headers" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "response_body" "text",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: saved_api_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."saved_api_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "url" "text" NOT NULL,
    "method" "text" NOT NULL,
    "auth_type" "text" DEFAULT 'none'::"text" NOT NULL,
    "auth_config_encrypted" "text",
    "params" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "headers" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "params_encrypted" "text",
    "headers_encrypted" "text",
    "body" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: search_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."search_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "patient_id" "uuid",
    "pharmacy_id" "uuid",
    "session_id" "text",
    "normalized_query" "text",
    "primary_category" "text",
    "subcategory" "text",
    "area_district" "text" DEFAULT 'Unknown'::"text" NOT NULL,
    "result_count" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: settlement_duplicate_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."settlement_duplicate_archive" (
    "id" "uuid",
    "pharmacy_id" "uuid",
    "amount_leones" integer,
    "amount_minor" integer,
    "period_start" timestamp with time zone,
    "period_end" timestamp with time zone,
    "order_count" integer,
    "status" "public"."settlement_status",
    "paid_at" timestamp with time zone,
    "reference" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "canonical_settlement_id" "uuid" NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."settlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pharmacy_id" "uuid" NOT NULL,
    "amount_leones" integer NOT NULL,
    "amount_minor" integer DEFAULT 0 NOT NULL,
    "period_start" timestamp with time zone NOT NULL,
    "period_end" timestamp with time zone NOT NULL,
    "order_count" integer DEFAULT 0 NOT NULL,
    "status" "public"."settlement_status" DEFAULT 'pending'::"public"."settlement_status" NOT NULL,
    "paid_at" timestamp with time zone,
    "reference" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."team_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "photo_path" "text",
    "sort_order" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: team_photo_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE "public"."team_photo_uploads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_member_id" "uuid" NOT NULL,
    "requested_by_hq_staff_id" "uuid" NOT NULL,
    "object_path" "text" NOT NULL,
    "content_type" "text" NOT NULL,
    "file_size" integer NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: pharmacy_password_history sequence; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pharmacy_password_history" ALTER COLUMN "sequence" SET DEFAULT "nextval"('"public"."pharmacy_password_history_sequence_seq"'::"regclass");


--
-- Name: advertisement_uploads advertisement_uploads_object_path_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."advertisement_uploads"
    ADD CONSTRAINT "advertisement_uploads_object_path_unique" UNIQUE ("object_path");


--
-- Name: advertisement_uploads advertisement_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."advertisement_uploads"
    ADD CONSTRAINT "advertisement_uploads_pkey" PRIMARY KEY ("id");


--
-- Name: advertisements advertisements_object_path_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."advertisements"
    ADD CONSTRAINT "advertisements_object_path_unique" UNIQUE ("object_path");


--
-- Name: advertisements advertisements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."advertisements"
    ADD CONSTRAINT "advertisements_pkey" PRIMARY KEY ("id");


--
-- Name: api_connections api_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."api_connections"
    ADD CONSTRAINT "api_connections_pkey" PRIMARY KEY ("id");


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");


--
-- Name: commission_settlement_adjustments commission_settlement_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."commission_settlement_adjustments"
    ADD CONSTRAINT "commission_settlement_adjustments_pkey" PRIMARY KEY ("id");


--
-- Name: commission_settlement_payments commission_settlement_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."commission_settlement_payments"
    ADD CONSTRAINT "commission_settlement_payments_pkey" PRIMARY KEY ("id");


--
-- Name: commission_settlements commission_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."commission_settlements"
    ADD CONSTRAINT "commission_settlements_pkey" PRIMARY KEY ("id");


--
-- Name: courier_photo_uploads courier_photo_uploads_object_path_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."courier_photo_uploads"
    ADD CONSTRAINT "courier_photo_uploads_object_path_unique" UNIQUE ("object_path");


--
-- Name: courier_photo_uploads courier_photo_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."courier_photo_uploads"
    ADD CONSTRAINT "courier_photo_uploads_pkey" PRIMARY KEY ("id");


--
-- Name: courier_settlements courier_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."courier_settlements"
    ADD CONSTRAINT "courier_settlements_pkey" PRIMARY KEY ("id");


--
-- Name: couriers couriers_phone_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."couriers"
    ADD CONSTRAINT "couriers_phone_unique" UNIQUE ("phone");


--
-- Name: couriers couriers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."couriers"
    ADD CONSTRAINT "couriers_pkey" PRIMARY KEY ("id");


--
-- Name: drug_catalogue drug_catalogue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."drug_catalogue"
    ADD CONSTRAINT "drug_catalogue_pkey" PRIMARY KEY ("id");


--
-- Name: financial_migration_state financial_migration_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."financial_migration_state"
    ADD CONSTRAINT "financial_migration_state_pkey" PRIMARY KEY ("key");


--
-- Name: flags flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."flags"
    ADD CONSTRAINT "flags_pkey" PRIMARY KEY ("id");


--
-- Name: hq_notifications hq_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."hq_notifications"
    ADD CONSTRAINT "hq_notifications_pkey" PRIMARY KEY ("id");


--
-- Name: hq_refresh_tokens hq_refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."hq_refresh_tokens"
    ADD CONSTRAINT "hq_refresh_tokens_pkey" PRIMARY KEY ("id");


--
-- Name: hq_refresh_tokens hq_refresh_tokens_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."hq_refresh_tokens"
    ADD CONSTRAINT "hq_refresh_tokens_token_hash_unique" UNIQUE ("token_hash");


--
-- Name: hq_staff hq_staff_phone_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."hq_staff"
    ADD CONSTRAINT "hq_staff_phone_unique" UNIQUE ("phone");


--
-- Name: hq_staff hq_staff_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."hq_staff"
    ADD CONSTRAINT "hq_staff_pkey" PRIMARY KEY ("id");


--
-- Name: hq_staff hq_staff_username_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."hq_staff"
    ADD CONSTRAINT "hq_staff_username_unique" UNIQUE ("username");


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");


--
-- Name: patient_notifications patient_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."patient_notifications"
    ADD CONSTRAINT "patient_notifications_pkey" PRIMARY KEY ("id");


--
-- Name: patient_password_reset_codes patient_password_reset_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."patient_password_reset_codes"
    ADD CONSTRAINT "patient_password_reset_codes_pkey" PRIMARY KEY ("id");


--
-- Name: patient_refresh_tokens patient_refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."patient_refresh_tokens"
    ADD CONSTRAINT "patient_refresh_tokens_pkey" PRIMARY KEY ("id");


--
-- Name: patient_refresh_tokens patient_refresh_tokens_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."patient_refresh_tokens"
    ADD CONSTRAINT "patient_refresh_tokens_token_hash_unique" UNIQUE ("token_hash");


--
-- Name: patients patients_phone_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."patients"
    ADD CONSTRAINT "patients_phone_unique" UNIQUE ("phone");


--
-- Name: patients patients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."patients"
    ADD CONSTRAINT "patients_pkey" PRIMARY KEY ("id");


--
-- Name: pharmacies pharmacies_phone_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pharmacies"
    ADD CONSTRAINT "pharmacies_phone_unique" UNIQUE ("phone");


--
-- Name: pharmacies pharmacies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pharmacies"
    ADD CONSTRAINT "pharmacies_pkey" PRIMARY KEY ("id");


--
-- Name: pharmacies pharmacies_username_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pharmacies"
    ADD CONSTRAINT "pharmacies_username_unique" UNIQUE ("username");


--
-- Name: pharmacy_inventory pharmacy_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pharmacy_inventory"
    ADD CONSTRAINT "pharmacy_inventory_pkey" PRIMARY KEY ("id");


--
-- Name: pharmacy_password_history pharmacy_password_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pharmacy_password_history"
    ADD CONSTRAINT "pharmacy_password_history_pkey" PRIMARY KEY ("id");


--
-- Name: pharmacy_password_policy pharmacy_password_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pharmacy_password_policy"
    ADD CONSTRAINT "pharmacy_password_policy_pkey" PRIMARY KEY ("id");


--
-- Name: platform_settings platform_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."platform_settings"
    ADD CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key");


--
-- Name: prescription_uploads prescription_uploads_image_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."prescription_uploads"
    ADD CONSTRAINT "prescription_uploads_image_key_unique" UNIQUE ("image_key");


--
-- Name: prescription_uploads prescription_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."prescription_uploads"
    ADD CONSTRAINT "prescription_uploads_pkey" PRIMARY KEY ("id");


--
-- Name: prescriptions prescriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."prescriptions"
    ADD CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id");


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id");


--
-- Name: refresh_tokens refresh_tokens_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE ("token_hash");


--
-- Name: saved_api_request_execution_claims saved_api_request_execution_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."saved_api_request_execution_claims"
    ADD CONSTRAINT "saved_api_request_execution_claims_pkey" PRIMARY KEY ("id");


--
-- Name: saved_api_request_history saved_api_request_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."saved_api_request_history"
    ADD CONSTRAINT "saved_api_request_history_pkey" PRIMARY KEY ("id");


--
-- Name: saved_api_requests saved_api_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."saved_api_requests"
    ADD CONSTRAINT "saved_api_requests_pkey" PRIMARY KEY ("id");


--
-- Name: search_events search_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."search_events"
    ADD CONSTRAINT "search_events_pkey" PRIMARY KEY ("id");


--
-- Name: settlements settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_pkey" PRIMARY KEY ("id");


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("id");


--
-- Name: team_members team_members_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_slug_unique" UNIQUE ("slug");


--
-- Name: team_photo_uploads team_photo_uploads_object_path_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."team_photo_uploads"
    ADD CONSTRAINT "team_photo_uploads_object_path_unique" UNIQUE ("object_path");


--
-- Name: team_photo_uploads team_photo_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."team_photo_uploads"
    ADD CONSTRAINT "team_photo_uploads_pkey" PRIMARY KEY ("id");


--
-- Name: advertisement_uploads_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "advertisement_uploads_expiry_idx" ON "public"."advertisement_uploads" USING "btree" ("expires_at") WHERE ("consumed_at" IS NULL);


--
-- Name: advertisements_public_display_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "advertisements_public_display_idx" ON "public"."advertisements" USING "btree" ("sort_order", "created_at") WHERE ("is_active" = true);


--
-- Name: api_connections_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "api_connections_provider_idx" ON "public"."api_connections" USING "btree" ("provider");


--
-- Name: commission_adjustment_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "commission_adjustment_order_idx" ON "public"."commission_settlement_adjustments" USING "btree" ("source_order_id");


--
-- Name: commission_adjustment_settlement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "commission_adjustment_settlement_idx" ON "public"."commission_settlement_adjustments" USING "btree" ("settlement_id");


--
-- Name: commission_payment_settlement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "commission_payment_settlement_idx" ON "public"."commission_settlement_payments" USING "btree" ("settlement_id");


--
-- Name: commission_settlements_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "commission_settlements_date_idx" ON "public"."commission_settlements" USING "btree" ("settlement_date");


--
-- Name: commission_settlements_pharmacy_day_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "commission_settlements_pharmacy_day_uq" ON "public"."commission_settlements" USING "btree" ("pharmacy_id", "settlement_date");


--
-- Name: commission_settlements_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "commission_settlements_status_idx" ON "public"."commission_settlements" USING "btree" ("status");


--
-- Name: courier_settlements_courier_period_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "courier_settlements_courier_period_uq" ON "public"."courier_settlements" USING "btree" ("courier_id", "period_start", "period_end");


--
-- Name: patient_password_reset_phone_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "patient_password_reset_phone_created_idx" ON "public"."patient_password_reset_codes" USING "btree" ("phone_hash", "created_at");


--
-- Name: patient_password_reset_requester_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "patient_password_reset_requester_created_idx" ON "public"."patient_password_reset_codes" USING "btree" ("requester_hash", "created_at");


--
-- Name: saved_api_request_execution_claims_actor_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "saved_api_request_execution_claims_actor_created_idx" ON "public"."saved_api_request_execution_claims" USING "btree" ("actor_id", "created_at" DESC);


--
-- Name: saved_api_request_history_request_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "saved_api_request_history_request_created_idx" ON "public"."saved_api_request_history" USING "btree" ("request_id", "created_at" DESC);


--
-- Name: search_events_area_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "search_events_area_created_at_idx" ON "public"."search_events" USING "btree" ("area_district", "created_at");


--
-- Name: search_events_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "search_events_created_at_idx" ON "public"."search_events" USING "btree" ("created_at");


--
-- Name: search_events_patient_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "search_events_patient_created_at_idx" ON "public"."search_events" USING "btree" ("patient_id", "created_at");


--
-- Name: search_events_query_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "search_events_query_created_at_idx" ON "public"."search_events" USING "btree" ("normalized_query", "created_at");


--
-- Name: settlements_pharmacy_period_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "settlements_pharmacy_period_uq" ON "public"."settlements" USING "btree" ("pharmacy_id", "period_start", "period_end");


--
-- Name: uniq_active_pharmacy_drug_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "uniq_active_pharmacy_drug_variant" ON "public"."pharmacy_inventory" USING "btree" ("pharmacy_id", "drug_id", "strength", "form", "unit_of_sale") WHERE ("is_active" = true);


--
-- Name: saved_api_request_history saved_api_request_history_trim; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER "saved_api_request_history_trim" AFTER INSERT ON "public"."saved_api_request_history" FOR EACH ROW EXECUTE FUNCTION "public"."trim_saved_api_request_history"();


--
-- Name: advertisement_uploads advertisement_uploads_requested_by_hq_staff_id_hq_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."advertisement_uploads"
    ADD CONSTRAINT "advertisement_uploads_requested_by_hq_staff_id_hq_staff_id_fk" FOREIGN KEY ("requested_by_hq_staff_id") REFERENCES "public"."hq_staff"("id") ON DELETE CASCADE;


--
-- Name: advertisements advertisements_created_by_hq_staff_id_hq_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."advertisements"
    ADD CONSTRAINT "advertisements_created_by_hq_staff_id_hq_staff_id_fk" FOREIGN KEY ("created_by_hq_staff_id") REFERENCES "public"."hq_staff"("id");


--
-- Name: api_connections api_connections_updated_by_hq_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."api_connections"
    ADD CONSTRAINT "api_connections_updated_by_hq_staff_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."hq_staff"("id") ON DELETE SET NULL;


--
-- Name: commission_settlement_adjustments commission_settlement_adjustments_settlement_id_commission_sett; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."commission_settlement_adjustments"
    ADD CONSTRAINT "commission_settlement_adjustments_settlement_id_commission_sett" FOREIGN KEY ("settlement_id") REFERENCES "public"."commission_settlements"("id") ON DELETE RESTRICT;


--
-- Name: commission_settlement_adjustments commission_settlement_adjustments_source_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."commission_settlement_adjustments"
    ADD CONSTRAINT "commission_settlement_adjustments_source_order_id_orders_id_fk" FOREIGN KEY ("source_order_id") REFERENCES "public"."orders"("id") ON DELETE RESTRICT;


--
-- Name: commission_settlement_payments commission_settlement_payments_recorded_by_hq_staff_id_hq_staff; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."commission_settlement_payments"
    ADD CONSTRAINT "commission_settlement_payments_recorded_by_hq_staff_id_hq_staff" FOREIGN KEY ("recorded_by_hq_staff_id") REFERENCES "public"."hq_staff"("id") ON DELETE SET NULL;


--
-- Name: commission_settlement_payments commission_settlement_payments_settlement_id_commission_settlem; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."commission_settlement_payments"
    ADD CONSTRAINT "commission_settlement_payments_settlement_id_commission_settlem" FOREIGN KEY ("settlement_id") REFERENCES "public"."commission_settlements"("id") ON DELETE RESTRICT;


--
-- Name: commission_settlements commission_settlements_pharmacy_id_pharmacies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."commission_settlements"
    ADD CONSTRAINT "commission_settlements_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE RESTRICT;


--
-- Name: courier_photo_uploads courier_photo_uploads_courier_id_couriers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."courier_photo_uploads"
    ADD CONSTRAINT "courier_photo_uploads_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE CASCADE;


--
-- Name: courier_photo_uploads courier_photo_uploads_requested_by_hq_staff_id_hq_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."courier_photo_uploads"
    ADD CONSTRAINT "courier_photo_uploads_requested_by_hq_staff_id_hq_staff_id_fk" FOREIGN KEY ("requested_by_hq_staff_id") REFERENCES "public"."hq_staff"("id") ON DELETE CASCADE;


--
-- Name: courier_settlements courier_settlements_courier_id_couriers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."courier_settlements"
    ADD CONSTRAINT "courier_settlements_courier_id_couriers_id_fk" FOREIGN KEY ("courier_id") REFERENCES "public"."couriers"("id") ON DELETE RESTRICT;


--
-- Name: drug_catalogue drug_catalogue_proposed_by_pharmacy_id_pharmacies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."drug_catalogue"
    ADD CONSTRAINT "drug_catalogue_proposed_by_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("proposed_by_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE SET NULL;


--
-- Name: drug_catalogue drug_catalogue_reviewed_by_hq_staff_id_hq_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."drug_catalogue"
    ADD CONSTRAINT "drug_catalogue_reviewed_by_hq_staff_id_hq_staff_id_fk" FOREIGN KEY ("reviewed_by_hq_staff_id") REFERENCES "public"."hq_staff"("id") ON DELETE SET NULL;


--
-- Name: flags flags_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."flags"
    ADD CONSTRAINT "flags_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;


--
-- Name: hq_notifications hq_notifications_hq_staff_id_hq_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."hq_notifications"
    ADD CONSTRAINT "hq_notifications_hq_staff_id_hq_staff_id_fk" FOREIGN KEY ("hq_staff_id") REFERENCES "public"."hq_staff"("id") ON DELETE CASCADE;


--
-- Name: hq_refresh_tokens hq_refresh_tokens_hq_staff_id_hq_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."hq_refresh_tokens"
    ADD CONSTRAINT "hq_refresh_tokens_hq_staff_id_hq_staff_id_fk" FOREIGN KEY ("hq_staff_id") REFERENCES "public"."hq_staff"("id") ON DELETE CASCADE;


--
-- Name: notifications notifications_pharmacy_id_pharmacies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE CASCADE;


--
-- Name: order_items order_items_drug_id_drug_catalogue_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_drug_id_drug_catalogue_id_fk" FOREIGN KEY ("drug_id") REFERENCES "public"."drug_catalogue"("id") ON DELETE RESTRICT;


--
-- Name: order_items order_items_inventory_id_pharmacy_inventory_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_inventory_id_pharmacy_inventory_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."pharmacy_inventory"("id") ON DELETE RESTRICT;


--
-- Name: order_items order_items_order_id_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;


--
-- Name: orders orders_delivery_confirmed_by_hq_user_id_hq_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_delivery_confirmed_by_hq_user_id_hq_staff_id_fk" FOREIGN KEY ("delivery_confirmed_by_hq_user_id") REFERENCES "public"."hq_staff"("id") ON DELETE SET NULL;


--
-- Name: orders orders_pharmacy_id_pharmacies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE RESTRICT;


--
-- Name: patient_notifications patient_notifications_patient_id_patients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."patient_notifications"
    ADD CONSTRAINT "patient_notifications_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE CASCADE;


--
-- Name: patient_password_reset_codes patient_password_reset_codes_patient_id_patients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."patient_password_reset_codes"
    ADD CONSTRAINT "patient_password_reset_codes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE CASCADE;


--
-- Name: patient_refresh_tokens patient_refresh_tokens_patient_id_patients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."patient_refresh_tokens"
    ADD CONSTRAINT "patient_refresh_tokens_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE CASCADE;


--
-- Name: pharmacy_inventory pharmacy_inventory_drug_id_drug_catalogue_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pharmacy_inventory"
    ADD CONSTRAINT "pharmacy_inventory_drug_id_drug_catalogue_id_fk" FOREIGN KEY ("drug_id") REFERENCES "public"."drug_catalogue"("id") ON DELETE RESTRICT;


--
-- Name: pharmacy_inventory pharmacy_inventory_pharmacy_id_pharmacies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pharmacy_inventory"
    ADD CONSTRAINT "pharmacy_inventory_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE CASCADE;


--
-- Name: pharmacy_password_history pharmacy_password_history_pharmacy_id_pharmacies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."pharmacy_password_history"
    ADD CONSTRAINT "pharmacy_password_history_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE CASCADE;


--
-- Name: prescription_uploads prescription_uploads_patient_id_patients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."prescription_uploads"
    ADD CONSTRAINT "prescription_uploads_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE CASCADE;


--
-- Name: prescriptions prescriptions_pharmacy_id_pharmacies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."prescriptions"
    ADD CONSTRAINT "prescriptions_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE RESTRICT;


--
-- Name: refresh_tokens refresh_tokens_pharmacy_id_pharmacies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE CASCADE;


--
-- Name: saved_api_request_execution_claims saved_api_request_execution_claims_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."saved_api_request_execution_claims"
    ADD CONSTRAINT "saved_api_request_execution_claims_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."hq_staff"("id") ON DELETE CASCADE;


--
-- Name: saved_api_request_history saved_api_request_history_actor_id_hq_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."saved_api_request_history"
    ADD CONSTRAINT "saved_api_request_history_actor_id_hq_staff_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."hq_staff"("id") ON DELETE SET NULL;


--
-- Name: saved_api_request_history saved_api_request_history_request_id_saved_api_requests_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."saved_api_request_history"
    ADD CONSTRAINT "saved_api_request_history_request_id_saved_api_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."saved_api_requests"("id") ON DELETE CASCADE;


--
-- Name: saved_api_requests saved_api_requests_created_by_hq_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."saved_api_requests"
    ADD CONSTRAINT "saved_api_requests_created_by_hq_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."hq_staff"("id") ON DELETE SET NULL;


--
-- Name: saved_api_requests saved_api_requests_updated_by_hq_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."saved_api_requests"
    ADD CONSTRAINT "saved_api_requests_updated_by_hq_staff_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."hq_staff"("id") ON DELETE SET NULL;


--
-- Name: search_events search_events_pharmacy_id_pharmacies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."search_events"
    ADD CONSTRAINT "search_events_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE SET NULL;


--
-- Name: settlements settlements_pharmacy_id_pharmacies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE RESTRICT;


--
-- Name: team_photo_uploads team_photo_uploads_requested_by_hq_staff_id_hq_staff_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."team_photo_uploads"
    ADD CONSTRAINT "team_photo_uploads_requested_by_hq_staff_id_hq_staff_id_fk" FOREIGN KEY ("requested_by_hq_staff_id") REFERENCES "public"."hq_staff"("id") ON DELETE CASCADE;


--
-- Name: team_photo_uploads team_photo_uploads_team_member_id_team_members_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY "public"."team_photo_uploads"
    ADD CONSTRAINT "team_photo_uploads_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

-- ── Seed rows ────────────────────────────────────────────────────────────────
-- Written by migrations 0013 and 0018 and read by the application at runtime.
-- platform_settings holds the fixed 5% patient service commission;
-- financial_migration_state marks reconciliation boundaries that a fresh
-- database satisfies on creation.
--
-- The delivery_fee_minor and courier_payout_minor rows migration 0013 seeded
-- are deliberately absent: MobiCare charges no delivery fee during the pilot,
-- and migration 0023 removes them from databases that already have them.


-- platform_settings
INSERT INTO "public"."platform_settings" VALUES ('medicine_markup_basis_points', 500, '2026-09-07 13:20:08.125832+00')
ON CONFLICT DO NOTHING;

-- financial_migration_state
INSERT INTO "public"."financial_migration_state" VALUES ('financial_snapshots_introduced', '2026-09-07 13:20:08.12859+00')
ON CONFLICT DO NOTHING;
INSERT INTO "public"."financial_migration_state" VALUES ('legacy_courier_payout_reconciled', '2026-09-07 13:20:08.171272+00')
ON CONFLICT DO NOTHING;