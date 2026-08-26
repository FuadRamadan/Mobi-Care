import { db } from "@workspace/db";
import { auditLogTable } from "@workspace/db/schema";

export interface AuditEntry {
  actorType: "hq" | "pharmacy" | "patient" | "system";
  actorId?: string | null;
  actorName?: string | null;
  action: string;      // e.g. "order.assign_courier"
  entityType: string;  // e.g. "order"
  entityId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Append an entry to the platform audit log.
 * APPEND-ONLY: there is deliberately no update/delete helper and no API route
 * that mutates audit_log rows. Never add one.
 *
 * Audit writes must never break the main operation — failures are logged
 * and swallowed (the mutation itself already succeeded).
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      actorName: entry.actorName ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      details: entry.details ?? null,
    });
  } catch (err) {
    console.error("[audit] failed to write audit entry", entry.action, err);
  }
}
