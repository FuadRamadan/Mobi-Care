-- Delivery zones: fixed-fee delivery priced by where the patient's pin falls.
--
-- MobiCare now runs its own riders, so delivery has a price again (migration
-- 0023 removed the unset figures the pilot never used). The price is set by
-- zone, not by distance: HQ draws each zone on a map and gives it a fee, and
-- checkout asks which zone contains the patient's pin and which contains the
-- pharmacy. Same zone pays the lowest active fee; different zones pay the
-- higher of the two.
--
-- Fees are kept apart from zones, one row per change, so that a price change
-- can be scheduled for midnight and take effect by itself, and so every price a
-- zone has ever charged stays on record.
--
-- Constraint names are written out so a database built by this migration and
-- one built from the baseline carry identical names.

CREATE TABLE IF NOT EXISTS delivery_zones (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL CONSTRAINT delivery_zones_name_unique UNIQUE,
  description             text NOT NULL DEFAULT '',
  boundary                jsonb NOT NULL,
  is_active               boolean NOT NULL DEFAULT true,
  updated_by_hq_staff_id  uuid CONSTRAINT delivery_zones_updated_by_hq_staff_id_hq_staff_id_fk
                          REFERENCES hq_staff(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_zone_fees (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id                 uuid NOT NULL CONSTRAINT delivery_zone_fees_zone_id_delivery_zones_id_fk
                          REFERENCES delivery_zones(id) ON DELETE RESTRICT,
  fee_minor               integer NOT NULL,
  effective_from          timestamptz NOT NULL,
  created_by_hq_staff_id  uuid CONSTRAINT delivery_zone_fees_created_by_hq_staff_id_hq_staff_id_fk
                          REFERENCES hq_staff(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_zone_fees_fee_minor_nonnegative CHECK (fee_minor >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_zone_fees_zone_effective_uq
  ON delivery_zone_fees (zone_id, effective_from);
CREATE INDEX IF NOT EXISTS delivery_zone_fees_effective_idx
  ON delivery_zone_fees (effective_from);

-- What each delivery order was priced from, fixed when it is placed.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_latitude  numeric(9, 6);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_longitude numeric(9, 6);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_zone_id   uuid;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_zone_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_pricing   text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_delivery_zone_id_delivery_zones_id_fk'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_delivery_zone_id_delivery_zones_id_fk
      FOREIGN KEY (delivery_zone_id) REFERENCES delivery_zones(id) ON DELETE RESTRICT;
  END IF;
END $$;
