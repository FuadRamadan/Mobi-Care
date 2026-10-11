/**
 * HQ alerts for medicines patients suddenly cannot find.
 *
 * Every hour, each medicine's unsuccessful searches over the last 7 days are
 * compared with the 3 weeks before. HQ staff who can see Data & Insights are
 * notified when one rises sharply, e.g. an antimalarial that 12 people could
 * not get this week against about 3 a week before: the early sign of a
 * stock-out worth telling pharmacies, suppliers or the Ministry about.
 *
 * Misspellings are left out (the medicine is available; the search is the
 * problem). A medicine is alerted on at most once a week.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db, hqNotificationsTable, hqStaffTable } from "@workspace/db";
import { logger } from "../logger.js";
import { REASON_LABELS } from "./notFoundReport.js";
import type { NotFoundReason } from "./notFound.js";

export const ALERT_TYPE = "medicine_alert";
/** Different people in the last 7 days before anything is said. */
export const MIN_PEOPLE = 5;
/** This week against the average week before it. */
export const RISE_FACTOR = 2;
const WEEK_MS = 7 * 24 * 60 * 60_000;
const CHECK_EVERY_MS = 60 * 60_000;

export interface MedicineWindow {
  medicine: string;
  /** Unsuccessful searches and different people in the last 7 days. */
  recentSearches: number;
  recentPeople: number;
  /** Unsuccessful searches in the 21 days before that. */
  earlierSearches: number;
  reason: NotFoundReason;
  areas: string[];
}

export interface MedicineAlert {
  medicine: string;
  title: string;
  body: string;
}

/** Pure: which medicines to alert on, most people first. */
export function risingMedicines(windows: MedicineWindow[]): MedicineAlert[] {
  return windows
    .filter((w) => w.reason !== "misspelled" && w.recentPeople >= MIN_PEOPLE)
    .filter((w) => {
      const weeklyBefore = w.earlierSearches / 3;
      return weeklyBefore === 0 || w.recentSearches >= weeklyBefore * RISE_FACTOR;
    })
    .sort((a, b) => b.recentPeople - a.recentPeople || a.medicine.localeCompare(b.medicine))
    .map((w) => {
      const weeklyBefore = Math.round(w.earlierSearches / 3);
      const comparison =
        w.earlierSearches === 0
          ? "None in the 3 weeks before."
          : `About ${weeklyBefore} a week in the 3 weeks before.`;
      const where = w.areas.length ? ` Mostly ${w.areas.slice(0, 3).join(", ")}.` : "";
      return {
        medicine: w.medicine,
        title: `Hard to find: ${w.medicine}`,
        body:
          `${w.recentPeople} people could not get ${w.medicine} in the last 7 days ` +
          `(${w.recentSearches} searches). ${comparison}${where} ` +
          `Reason: ${REASON_LABELS[w.reason]}. See Data & Insights → Medicines not found.`,
      };
    });
}

/** The last 7 days and the 21 before, per medicine, as of `now`. */
async function windows(now: Date): Promise<MedicineWindow[]> {
  const recentStart = new Date(now.getTime() - WEEK_MS);
  const earlierStart = new Date(now.getTime() - 4 * WEEK_MS);
  const base = sql`
    SELECT patient_id, unavailable_reason, created_at,
      coalesce(matched_drug_name, initcap(normalized_query)) AS medicine,
      coalesce(area_zone, area_district, 'Unknown') AS area
    FROM search_events
    WHERE unavailable_reason IS NOT NULL AND unavailable_reason <> 'misspelled'
      AND normalized_query IS NOT NULL
      AND created_at >= ${earlierStart} AND created_at <= ${now}`;
  const [counts, reasons, areas] = await Promise.all([
    db.execute(sql`SELECT medicine,
        count(*) FILTER (WHERE created_at >= ${recentStart})::int AS recent_searches,
        count(DISTINCT patient_id) FILTER (WHERE created_at >= ${recentStart})::int AS recent_people,
        count(*) FILTER (WHERE created_at < ${recentStart})::int AS earlier_searches
      FROM (${base}) u GROUP BY medicine`),
    db.execute(sql`SELECT medicine, unavailable_reason AS reason, count(*)::int AS n
      FROM (${base}) u WHERE created_at >= ${recentStart} GROUP BY 1, 2`),
    db.execute(sql`SELECT medicine, area, count(*)::int AS n
      FROM (${base}) u WHERE created_at >= ${recentStart} AND area <> 'Unknown' GROUP BY 1, 2`),
  ]);
  const top = <T extends { medicine: string; n: number | string }>(rows: T[], medicine: string) =>
    rows.filter((r) => r.medicine === medicine).sort((a, b) => Number(b.n) - Number(a.n));
  const reasonRows = reasons.rows as Array<{ medicine: string; reason: string; n: number }>;
  const areaRows = areas.rows as Array<{ medicine: string; area: string; n: number }>;
  return (counts.rows as Array<{ medicine: string; recent_searches: number; recent_people: number; earlier_searches: number }>)
    .filter((r) => Number(r.recent_searches) > 0)
    .map((r) => ({
      medicine: r.medicine,
      recentSearches: Number(r.recent_searches),
      recentPeople: Number(r.recent_people),
      earlierSearches: Number(r.earlier_searches),
      reason: (top(reasonRows, r.medicine)[0]?.reason ?? "not_in_catalogue") as NotFoundReason,
      areas: top(areaRows, r.medicine).map((a) => a.area),
    }));
}

/**
 * Checks once and notifies. Safe to run on several servers at once: the
 * check-and-send runs under one database lock, and a medicine already alerted
 * on in the last 7 days is skipped.
 */
export async function checkMedicineAlerts(now = new Date()): Promise<MedicineAlert[]> {
  const alerts = risingMedicines(await windows(now));
  if (alerts.length === 0) return [];
  const sent: MedicineAlert[] = [];
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('mobicare:medicine-alerts'))`);
    const recipients = await tx
      .select({ id: hqStaffTable.id })
      .from(hqStaffTable)
      .where(and(eq(hqStaffTable.isActive, true), eq(hqStaffTable.canViewDataInsights, true)));
    if (recipients.length === 0) return;
    const recent = await tx
      .selectDistinct({ title: hqNotificationsTable.title })
      .from(hqNotificationsTable)
      .where(and(eq(hqNotificationsTable.type, ALERT_TYPE), gte(hqNotificationsTable.createdAt, new Date(now.getTime() - WEEK_MS))));
    const alreadySent = new Set(recent.map((r) => r.title));
    for (const alert of alerts) {
      if (alreadySent.has(alert.title)) continue;
      await tx.insert(hqNotificationsTable).values(
        recipients.map((staff) => ({ hqStaffId: staff.id, title: alert.title, body: alert.body, type: ALERT_TYPE })),
      );
      sent.push(alert);
    }
  });
  for (const alert of sent) logger.info({ medicine: alert.medicine }, "Medicine alert sent to HQ");
  return sent;
}

let timer: NodeJS.Timeout | null = null;

export function startMedicineAlerts(): void {
  const run = () =>
    void checkMedicineAlerts().catch((err) => logger.error({ err }, "Medicine alert check failed"));
  // A minute after start, then hourly.
  setTimeout(run, 60_000).unref();
  timer = setInterval(run, CHECK_EVERY_MS);
  timer.unref();
}

export function stopMedicineAlerts(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
