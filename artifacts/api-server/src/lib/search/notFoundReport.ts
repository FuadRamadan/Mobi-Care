/**
 * "Medicines not found": the report HQ shares with the Ministry of Health,
 * health organisations and pharmacies.
 *
 * One row per medicine (spelling variants grouped under the catalogue name),
 * with how often it was searched without success, by how many different
 * people, why, where, since when, and its weekly trend.
 *
 * Two audiences:
 *   HQ          everything, including single searches and what was typed.
 *   Shareable   only medicines and areas with at least SHAREABLE_MINIMUM
 *               different people, and never the typed words, so no figure can
 *               point to one patient.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { NotFoundReason } from "./notFound.js";

export const SHAREABLE_MINIMUM = 5;
/** Weeks shown in each medicine's trend, ending with the report's last week. */
export const TREND_WEEKS = 8;

export const REASON_LABELS: Record<NotFoundReason, string> = {
  out_of_stock: "Out of stock everywhere",
  not_listed: "No pharmacy offers it",
  misspelled: "Misspelled (it is available)",
  not_in_catalogue: "Not in MobiCare's catalogue",
};

export interface AreaCount {
  area: string;
  searches: number;
  people: number;
}

export interface NotFoundRow {
  medicine: string;
  /** Whether the name is a catalogue medicine (else it is what was typed). */
  inCatalogue: boolean;
  /** The most common reason for this medicine in the period. */
  reason: NotFoundReason;
  reasons: Partial<Record<NotFoundReason, number>>;
  searches: number;
  people: number;
  areas: AreaCount[];
  /** What patients typed, most common first (HQ only). */
  typed: string[];
  firstSeen: string;
  lastSeen: string;
  /** Searches per week, oldest first; weeks start on Monday. */
  weekly: Array<{ week: string; searches: number }>;
  /** Last week against the average of the weeks before it. */
  trend: "rising" | "falling" | "steady" | "new";
}

export interface NotFoundReport {
  range: { start: string; end: string };
  shareable: boolean;
  minimumPeople: number;
  summary: {
    searches: number;
    unavailableSearches: number;
    medicines: number;
    people: number;
  };
  reasons: Array<{ reason: NotFoundReason; label: string; searches: number }>;
  areas: AreaCount[];
  rows: NotFoundRow[];
}

/** Monday of the week containing `date`, as YYYY-MM-DD (UTC = Freetown). */
export function weekStart(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

/** The TREND_WEEKS week starts ending with the week of `end`. */
export function trendWeeks(end: Date): string[] {
  const last = new Date(`${weekStart(end)}T00:00:00Z`);
  return Array.from({ length: TREND_WEEKS }, (_, i) => {
    const d = new Date(last);
    d.setUTCDate(d.getUTCDate() - 7 * (TREND_WEEKS - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

/**
 * Rising when last week is at least 1.5× the average of the weeks before it
 * (and at least 3 searches), falling when at most half; "new" when nothing
 * came before it.
 */
export function trendOf(weekly: number[]): NotFoundRow["trend"] {
  const last = weekly[weekly.length - 1] ?? 0;
  const before = weekly.slice(0, -1);
  const earlier = before.reduce((sum, n) => sum + n, 0);
  if (earlier === 0) return last > 0 ? "new" : "steady";
  const average = earlier / before.length;
  if (last >= 3 && last >= average * 1.5) return "rising";
  if (last <= average * 0.5) return "falling";
  return "steady";
}

type Num = number | string;

/** Builds the report from the query results; pure, so it can be tested. */
export function assembleReport(input: {
  start: Date;
  end: Date;
  shareable: boolean;
  totals: { searches: Num; unavailable: Num; people: Num };
  medicines: Array<{ medicine: string; in_catalogue: boolean; searches: Num; people: Num; first_seen: string | Date; last_seen: string | Date }>;
  reasons: Array<{ medicine: string; reason: string; searches: Num }>;
  areas: Array<{ medicine: string; area: string; searches: Num; people: Num }>;
  typed: Array<{ medicine: string; typed: string; searches: Num }>;
  weekly: Array<{ medicine: string; week: string | Date; searches: Num }>;
}): NotFoundReport {
  const minimum = input.shareable ? SHAREABLE_MINIMUM : 1;
  const iso = (value: string | Date) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());
  const day = (value: string | Date) => iso(value).slice(0, 10);
  const weeks = trendWeeks(input.end);

  const rows: NotFoundRow[] = input.medicines
    .filter((m) => Number(m.people) >= minimum)
    .map((m) => {
      const reasons: Partial<Record<NotFoundReason, number>> = {};
      for (const r of input.reasons) {
        if (r.medicine === m.medicine) reasons[r.reason as NotFoundReason] = Number(r.searches);
      }
      const reason = (Object.entries(reasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "not_in_catalogue") as NotFoundReason;
      const areas = input.areas
        .filter((a) => a.medicine === m.medicine && Number(a.people) >= minimum)
        .map((a) => ({ area: a.area, searches: Number(a.searches), people: Number(a.people) }))
        .sort((a, b) => b.searches - a.searches);
      const byWeek = new Map(input.weekly.filter((w) => w.medicine === m.medicine).map((w) => [day(w.week), Number(w.searches)]));
      const weekly = weeks.map((week) => ({ week, searches: byWeek.get(week) ?? 0 }));
      return {
        medicine: m.medicine,
        inCatalogue: Boolean(m.in_catalogue),
        reason,
        reasons,
        searches: Number(m.searches),
        people: Number(m.people),
        areas,
        typed: input.shareable
          ? []
          : input.typed
              .filter((t) => t.medicine === m.medicine)
              .sort((a, b) => Number(b.searches) - Number(a.searches))
              .slice(0, 5)
              .map((t) => t.typed),
        firstSeen: iso(m.first_seen),
        lastSeen: iso(m.last_seen),
        weekly,
        trend: trendOf(weekly.map((w) => w.searches)),
      };
    })
    .sort((a, b) => b.searches - a.searches || a.medicine.localeCompare(b.medicine));

  const shownMedicines = new Set(rows.map((r) => r.medicine));
  const reasonTotals = new Map<NotFoundReason, number>();
  for (const r of input.reasons) {
    if (!shownMedicines.has(r.medicine)) continue;
    const key = r.reason as NotFoundReason;
    reasonTotals.set(key, (reasonTotals.get(key) ?? 0) + Number(r.searches));
  }
  const areaTotals = new Map<string, AreaCount>();
  for (const row of rows) {
    for (const a of row.areas) {
      const t = areaTotals.get(a.area) ?? { area: a.area, searches: 0, people: 0 };
      t.searches += a.searches;
      t.people += a.people;
      areaTotals.set(a.area, t);
    }
  }

  return {
    range: { start: day(input.start), end: day(input.end) },
    shareable: input.shareable,
    minimumPeople: minimum,
    summary: {
      searches: Number(input.totals.searches),
      unavailableSearches: input.shareable ? rows.reduce((s, r) => s + r.searches, 0) : Number(input.totals.unavailable),
      medicines: rows.length,
      people: input.shareable && Number(input.totals.people) < minimum ? 0 : Number(input.totals.people),
    },
    reasons: (Object.keys(REASON_LABELS) as NotFoundReason[])
      .map((reason) => ({ reason, label: REASON_LABELS[reason], searches: reasonTotals.get(reason) ?? 0 }))
      .filter((r) => r.searches > 0),
    areas: [...areaTotals.values()].sort((a, b) => b.searches - a.searches),
    rows,
  };
}

/** Runs the queries for `start`..`end` (and the trend weeks before `end`). */
export async function notFoundReport(start: Date, end: Date, shareable: boolean, area?: string): Promise<NotFoundReport> {
  const weeks = trendWeeks(end);
  const trendStart = new Date(`${weeks[0]}T00:00:00Z`);
  const areaFilter = area ? sql` AND coalesce(area_zone, area_district) = ${area}` : sql``;
  const base = sql`
    SELECT patient_id, normalized_query, unavailable_reason, created_at,
      coalesce(matched_drug_name, initcap(normalized_query)) AS medicine,
      matched_drug_id IS NOT NULL AS in_catalogue,
      coalesce(area_zone, area_district, 'Unknown') AS area
    FROM search_events
    WHERE unavailable_reason IS NOT NULL AND unavailable_reason <> 'misspelled'
      AND normalized_query IS NOT NULL${areaFilter}`;
  const inRange = sql`created_at >= ${start} AND created_at <= ${end}`;
  const [totals, medicines, reasons, areas, typed, weekly] = await Promise.all([
    db.execute(sql`SELECT
        (SELECT count(*) FROM search_events WHERE ${inRange} AND normalized_query IS NOT NULL${areaFilter})::int AS searches,
        count(*)::int AS unavailable, count(DISTINCT patient_id)::int AS people
      FROM (${base}) u WHERE ${inRange}`),
    db.execute(sql`SELECT medicine, bool_or(in_catalogue) AS in_catalogue, count(*)::int AS searches,
        count(DISTINCT patient_id)::int AS people, min(created_at) AS first_seen, max(created_at) AS last_seen
      FROM (${base}) u WHERE ${inRange} GROUP BY medicine`),
    db.execute(sql`SELECT medicine, unavailable_reason AS reason, count(*)::int AS searches
      FROM (${base}) u WHERE ${inRange} GROUP BY 1, 2`),
    db.execute(sql`SELECT medicine, area, count(*)::int AS searches, count(DISTINCT patient_id)::int AS people
      FROM (${base}) u WHERE ${inRange} GROUP BY 1, 2`),
    db.execute(sql`SELECT medicine, normalized_query AS typed, count(*)::int AS searches
      FROM (${base}) u WHERE ${inRange} GROUP BY 1, 2`),
    db.execute(sql`SELECT medicine, date_trunc('week', created_at)::date::text AS week, count(*)::int AS searches
      FROM (${base}) u WHERE created_at >= ${trendStart} AND created_at <= ${end} GROUP BY 1, 2`),
  ]);
  return assembleReport({
    start,
    end,
    shareable,
    totals: (totals.rows[0] ?? { searches: 0, unavailable: 0, people: 0 }) as never,
    medicines: medicines.rows as never,
    reasons: reasons.rows as never,
    areas: areas.rows as never,
    typed: typed.rows as never,
    weekly: weekly.rows as never,
  });
}

const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The report as a spreadsheet-friendly CSV. */
export function notFoundCsv(report: NotFoundReport): string {
  const header = [
    "Medicine",
    "In MobiCare catalogue",
    "Main reason",
    "Times searched",
    "Different people",
    "Areas (searches)",
    ...report.rows[0]?.weekly.map((w) => `Week of ${w.week}`) ?? [],
    "Trend",
    "First seen",
    "Last seen",
    ...(report.shareable ? [] : ["What was typed"]),
  ];
  const lines = [
    `MobiCare: medicines not found, ${report.range.start} to ${report.range.end}`,
    report.shareable
      ? `Shareable: only medicines and areas searched by at least ${report.minimumPeople} different people. No personal data.`
      : "HQ copy: includes single searches and what was typed. Do not share outside MobiCare.",
    "",
    header.map(csvCell).join(","),
    ...report.rows.map((row) =>
      [
        row.medicine,
        row.inCatalogue ? "Yes" : "No",
        REASON_LABELS[row.reason],
        row.searches,
        row.people,
        row.areas.map((a) => `${a.area} (${a.searches})`).join("; "),
        ...row.weekly.map((w) => w.searches),
        row.trend,
        row.firstSeen.slice(0, 10),
        row.lastSeen.slice(0, 10),
        ...(report.shareable ? [] : [row.typed.join("; ")]),
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  return `${lines.join("\r\n")}\r\n`;
}
