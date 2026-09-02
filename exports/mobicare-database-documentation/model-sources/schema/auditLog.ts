import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Platform-wide audit trail. APPEND-ONLY:
 *  - The API exposes no update or delete path for this table.
 *  - Do not add one. Its whole value is being tamper-evident.
 * Every mutating handler across the HQ and pharmacy APIs writes an entry
 * via the writeAudit() helper in api-server lib/audit.ts.
 */
export const auditLogTable = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Who performed the action
  actorType: text("actor_type").notNull(), // "hq" | "pharmacy" | "system"
  actorId: uuid("actor_id"),
  actorName: text("actor_name"),
  // What happened
  action: text("action").notNull(), // e.g. "order.assign_courier", "pharmacy.onboard"
  entityType: text("entity_type").notNull(), // e.g. "order", "pharmacy", "drug", "settlement"
  entityId: uuid("entity_id"),
  // Snapshot of relevant change data
  details: jsonb("details"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuditLogEntry = typeof auditLogTable.$inferSelect;
