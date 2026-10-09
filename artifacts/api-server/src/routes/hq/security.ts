import { db } from "@workspace/db";
import { securityEventsTable } from "@workspace/db/schema";
import { and, count, desc, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { safeRouter } from "../../lib/safeRouter.js";

/**
 * GET /hq/security/activity?days=7
 *
 * What the security monitor recorded (lib/securityEvents.ts): totals by kind,
 * the alerts sent, the accounts and networks with the most failed sign-ins,
 * and the latest events. For staff who can manage integrations.
 */
const router = safeRouter();

router.get("/activity", async (req, res): Promise<void> => {
  const days = z.coerce.number().int().min(1).max(90).catch(7).parse(req.query.days);
  const since = new Date(Date.now() - days * 24 * 60 * 60_000);
  const inRange = gte(securityEventsTable.createdAt, since);
  const failed = and(inRange, eq(securityEventsTable.kind, "failed_sign_in"));

  const [totals, alerts, accounts, networks, events] = await Promise.all([
    db
      .select({ kind: securityEventsTable.kind, count: count() })
      .from(securityEventsTable)
      .where(inRange)
      .groupBy(securityEventsTable.kind),
    db
      .select()
      .from(securityEventsTable)
      .where(and(inRange, eq(securityEventsTable.kind, "alert_sent")))
      .orderBy(desc(securityEventsTable.createdAt))
      .limit(20),
    db
      .select({
        identifier: securityEventsTable.identifier,
        role: securityEventsTable.role,
        count: count(),
        last: sql<string>`max(${securityEventsTable.createdAt})`,
      })
      .from(securityEventsTable)
      .where(and(failed, isNotNull(securityEventsTable.accountId)))
      .groupBy(securityEventsTable.identifier, securityEventsTable.role)
      .orderBy(desc(count()))
      .limit(5),
    db
      .select({
        ipAddress: securityEventsTable.ipAddress,
        count: count(),
        last: sql<string>`max(${securityEventsTable.createdAt})`,
      })
      .from(securityEventsTable)
      .where(and(inRange, isNotNull(securityEventsTable.ipAddress), sql`${securityEventsTable.kind} in ('failed_sign_in', 'sign_in_blocked')`))
      .groupBy(securityEventsTable.ipAddress)
      .orderBy(desc(count()))
      .limit(5),
    db
      .select()
      .from(securityEventsTable)
      .where(and(inRange, ne(securityEventsTable.kind, "alert_sent")))
      .orderBy(desc(securityEventsTable.createdAt))
      .limit(100),
  ]);

  const total = (kind: string) => Number(totals.find((t) => t.kind === kind)?.count ?? 0);
  res.json({
    days,
    totals: {
      failedSignIns: total("failed_sign_in"),
      signInsBlocked: total("sign_in_blocked"),
      contentBlocked: total("csp_violation"),
      serverErrors: total("server_error"),
      alerts: total("alert_sent"),
    },
    alerts: alerts.map((a) => ({
      id: a.id,
      title: String(a.details?.["title"] ?? "Alert"),
      body: String(a.details?.["body"] ?? ""),
      createdAt: a.createdAt.toISOString(),
    })),
    topAccounts: accounts.map((a) => ({
      identifier: a.identifier ?? "—",
      role: a.role,
      count: Number(a.count),
      lastAt: new Date(a.last).toISOString(),
    })),
    topNetworks: networks.map((n) => ({
      ipAddress: n.ipAddress ?? "—",
      count: Number(n.count),
      lastAt: new Date(n.last).toISOString(),
    })),
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      role: e.role,
      identifier: e.identifier,
      ipAddress: e.ipAddress,
      path: e.path,
      details: e.details ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});

export default router;
