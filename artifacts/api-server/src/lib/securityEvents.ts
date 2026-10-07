/**
 * Security monitoring.
 *
 * Records what an attack or a fault leaves behind — failed sign-ins, attempts
 * blocked for guessing, content the browser refused to load, server errors —
 * and alerts HQ when the numbers cross a line. The HQ staff who can manage
 * integrations (the technical admins) get the alerts and see the activity on
 * Security & Settings.
 *
 * Recording never fails the request that triggered it: a monitoring fault is
 * logged and the user carries on.
 */

import { db } from "@workspace/db";
import { hqNotificationsTable, hqStaffTable, securityEventsTable } from "@workspace/db/schema";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import { logger } from "./logger.js";

export type SecurityEventKind =
  | "failed_sign_in"
  | "sign_in_blocked"
  | "csp_violation"
  | "server_error"
  | "alert_sent";

export interface SecurityEventInput {
  kind: Exclude<SecurityEventKind, "alert_sent">;
  role?: "patient" | "pharmacy" | "hq" | null;
  accountId?: string | null;
  identifier?: string | null;
  ipAddress?: string | null;
  path?: string | null;
  details?: Record<string, unknown> | null;
}

export interface AlertRule {
  key: string;
  kind: SecurityEventInput["kind"];
  /** Counted per account rather than across everything. */
  perAccount?: boolean;
  threshold: number;
  windowMinutes: number;
  title: string;
  body: (count: number, subject: string | null) => string;
}

/** When an alert goes to HQ. One alert per rule (and account) per hour. */
export const ALERT_RULES: AlertRule[] = [
  {
    key: "account_guessing",
    kind: "failed_sign_in",
    perAccount: true,
    threshold: 5,
    windowMinutes: 15,
    title: "Possible password guessing",
    body: (n, who) =>
      `${n} wrong passwords for ${who ?? "one account"} in 15 minutes. If this was not the account holder, ` +
      "reset the password and check Security & Settings for where the attempts came from.",
  },
  {
    key: "many_failed_sign_ins",
    kind: "failed_sign_in",
    threshold: 30,
    windowMinutes: 15,
    title: "Many failed sign-ins",
    body: (n) => `${n} failed sign-ins across MobiCare in 15 minutes. Someone may be trying passwords on many accounts.`,
  },
  {
    key: "sign_in_blocked",
    kind: "sign_in_blocked",
    threshold: 3,
    windowMinutes: 15,
    title: "Sign-in attempts blocked",
    body: (n) => `${n} times in 15 minutes someone was blocked for too many sign-in attempts.`,
  },
  {
    key: "server_errors",
    kind: "server_error",
    threshold: 10,
    windowMinutes: 15,
    title: "Server errors",
    body: (n) => `${n} server errors in 15 minutes. Patients or pharmacies may be seeing failures — check the server logs.`,
  },
  {
    key: "content_blocked",
    kind: "csp_violation",
    threshold: 20,
    windowMinutes: 60,
    title: "Browsers blocked unexpected content",
    body: (n) =>
      `Browsers blocked ${n} attempts to load content from places MobiCare does not use, in the last hour. ` +
      "This can mean injected code, or a new service that needs adding to the policy.",
  },
];

const ALERT_REPEAT_MINUTES = 60;
export const RETENTION_DAYS = 90;

/** A phone number keeps its first four and last three digits; other names are kept. */
export function maskIdentifier(identifier: string | null | undefined): string | null {
  if (!identifier) return null;
  const value = identifier.trim().slice(0, 120);
  if (/^\+?[\d\s-]{7,}$/.test(value)) {
    const digits = value.replace(/[\s-]/g, "");
    return `${digits.slice(0, 4)}${"•".repeat(Math.max(digits.length - 7, 1))}${digits.slice(-3)}`;
  }
  const at = value.indexOf("@");
  if (at > 0) return `${value[0]}•••${value.slice(at)}`;
  return value;
}

/** Rules a new event of this kind should be checked against. */
export function rulesFor(kind: SecurityEventInput["kind"], hasAccount: boolean): AlertRule[] {
  return ALERT_RULES.filter((rule) => rule.kind === kind && (!rule.perAccount || hasAccount));
}

export async function recordSecurityEvent(event: SecurityEventInput): Promise<void> {
  try {
    const identifier = maskIdentifier(event.identifier);
    await db.insert(securityEventsTable).values({
      kind: event.kind,
      role: event.role ?? null,
      accountId: event.accountId ?? null,
      identifier,
      ipAddress: event.ipAddress ?? null,
      path: event.path ?? null,
      details: event.details ?? null,
    });
    logger.warn({ securityEvent: event.kind, role: event.role, identifier, ip: event.ipAddress, path: event.path }, `Security event: ${event.kind}`);
    for (const rule of rulesFor(event.kind, Boolean(event.accountId))) {
      await checkRule(rule, event.accountId ?? null, identifier);
    }
  } catch (error) {
    logger.error({ err: error, kind: event.kind }, "Could not record a security event");
  }
}

async function checkRule(rule: AlertRule, accountId: string | null, subject: string | null): Promise<void> {
  const since = new Date(Date.now() - rule.windowMinutes * 60_000);
  const [{ value: seen } = { value: 0 }] = await db
    .select({ value: count() })
    .from(securityEventsTable)
    .where(
      and(
        eq(securityEventsTable.kind, rule.kind),
        gte(securityEventsTable.createdAt, since),
        rule.perAccount && accountId ? eq(securityEventsTable.accountId, accountId) : undefined,
      ),
    );
  if (Number(seen) < rule.threshold) return;

  const alertKey = rule.perAccount ? `${rule.key}:${accountId}` : rule.key;
  const repeatSince = new Date(Date.now() - ALERT_REPEAT_MINUTES * 60_000);
  const body = rule.body(Number(seen), subject);
  // Two events arriving together must not both send the alert: the check and
  // the record of sending it happen under one lock per alert.
  const sent = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`security-alert:${alertKey}`}, 0))`);
    const [{ value: recent } = { value: 0 }] = await tx
      .select({ value: count() })
      .from(securityEventsTable)
      .where(
        and(
          eq(securityEventsTable.kind, "alert_sent"),
          gte(securityEventsTable.createdAt, repeatSince),
          sql`${securityEventsTable.details}->>'alertKey' = ${alertKey}`,
        ),
      );
    if (Number(recent) > 0) return false;
    await tx.insert(securityEventsTable).values({
      kind: "alert_sent",
      accountId: rule.perAccount ? accountId : null,
      identifier: rule.perAccount ? subject : null,
      details: { alertKey, rule: rule.key, title: rule.title, body, count: Number(seen) },
    });
    return true;
  });
  if (!sent) return;
  const recipients = await db
    .select({ id: hqStaffTable.id })
    .from(hqStaffTable)
    .where(and(eq(hqStaffTable.isActive, true), eq(hqStaffTable.canManageIntegrations, true)));
  if (recipients.length) {
    await db.insert(hqNotificationsTable).values(
      recipients.map((staff) => ({ hqStaffId: staff.id, title: rule.title, body, type: "security_alert" })),
    );
  }
  logger.warn({ alert: rule.key, count: Number(seen), subject }, `Security alert: ${rule.title}`);
}

/** Deletes events older than the retention period. Run once a day. */
export async function pruneSecurityEvents(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);
    await db.delete(securityEventsTable).where(lt(securityEventsTable.createdAt, cutoff));
  } catch (error) {
    logger.error({ err: error }, "Could not prune old security events");
  }
}

export function startSecurityEventPruning(): void {
  void pruneSecurityEvents();
  setInterval(() => void pruneSecurityEvents(), 24 * 60 * 60_000).unref();
}
