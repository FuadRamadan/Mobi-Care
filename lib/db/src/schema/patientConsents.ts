import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { patientsTable } from "./patients";

/**
 * A patient's consent decisions, as a record rather than a flag.
 *
 * APPEND-ONLY. A row is never updated or deleted: withdrawing consent adds a
 * new row with `granted = false`. The current position is the most recent row
 * for a patient and consent type, and the history behind it is the evidence.
 *
 * Consent has to be provable after the fact — "did this person agree, to what,
 * and when" is a question a regulator, a partner pharmacy's own compliance, or
 * the patient themselves can ask. A boolean on the patient row answers none of
 * it, and is silently overwritten the moment the policy changes.
 *
 * `policyVersion` is why this is versioned rather than a yes/no. When the
 * privacy policy changes materially, the version changes, and consent given
 * against the old text no longer counts as consent to the new one.
 *
 * Deliberately NOT recorded: IP address and user agent. They are the usual
 * "evidence of consent" fields, and they are also personal data this platform
 * otherwise never stores. Collecting more personal data to prove a privacy
 * promise is the wrong trade; `source` records where the decision was made,
 * which is what actually helps when reconstructing what a patient saw.
 */
export const patientConsentsTable = pgTable(
  "patient_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    /** See CONSENT_TYPES in the API's lib/consent.ts. */
    consentType: text("consent_type").notNull(),
    /** The policy text this decision was made against. */
    policyVersion: text("policy_version").notNull(),
    granted: boolean("granted").notNull(),
    /** Where the decision was made: "registration" or "profile". */
    source: text("source").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Reading a patient's current position means "latest row per type", which
    // is this index walked backwards.
    index("patient_consents_patient_type_recorded_idx").on(
      table.patientId,
      table.consentType,
      table.recordedAt,
    ),
  ],
);

export type PatientConsent = typeof patientConsentsTable.$inferSelect;
