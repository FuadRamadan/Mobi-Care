-- Recorded consent, and the mark left by an erasure request.
--
-- Until now the platform asked for no consent at all: a sentence on a public
-- marketing page said that using MobiCare implied it. That is not consent
-- anyone can prove, and it is not a choice the patient ever made — there was no
-- moment at which they agreed, and nothing recorded if they had.
--
-- patient_consents is append-only. Withdrawing consent adds a row saying so; it
-- never edits or removes the row that granted it. The current position is the
-- most recent row per patient and consent type, and everything behind it is the
-- evidence of what was agreed and when.
--
-- policy_version is what makes this a record rather than a flag: when the
-- privacy policy changes materially the version changes with it, and consent
-- given against the old text stops counting for the new one.

CREATE TABLE IF NOT EXISTS patient_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Named explicitly so it matches what Drizzle generates. An unnamed inline
  -- REFERENCES gets PostgreSQL's default name instead, and a database built
  -- from the baseline would then carry a differently-named constraint from one
  -- built by migration.
  patient_id     uuid NOT NULL CONSTRAINT patient_consents_patient_id_patients_id_fk
                 REFERENCES patients(id) ON DELETE CASCADE,
  consent_type   text NOT NULL,
  policy_version text NOT NULL,
  granted        boolean NOT NULL,
  source         text NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_consents_patient_type_recorded_idx
  ON patient_consents (patient_id, consent_type, recorded_at);

-- Erasure keeps the row and empties it. Orders and prescriptions reference the
-- patient, and a pharmacy's record of what it dispensed cannot simply vanish;
-- what goes is the identity attached to it.
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS erased_at timestamptz;

-- Existing patients registered before consent was asked for. They are not
-- backfilled as having consented — that would be inventing a record of a
-- decision nobody made. They are prompted on next sign-in instead.
