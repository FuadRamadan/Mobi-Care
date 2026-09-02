import { safeRouter } from "../../lib/safeRouter.js";
import { db } from "@workspace/db";
import { writeAudit } from "../../lib/audit.js";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { AuthRequest } from "../../middlewares/auth.js";

const router = safeRouter();
const MINIMUM_GROUP_SIZE = 10;
const completedStatuses = ["delivered", "collected"];
const SUPPRESSED = `Suppressed: fewer than ${MINIMUM_GROUP_SIZE} contributing records.`;

const querySchema = z.object({
  start: z.string().date().optional(),
  end: z.string().date().optional(),
  interval: z.enum(["day", "week", "month"]).default("day"),
});

function getRange(input: z.infer<typeof querySchema>) {
  const end = input.end ? new Date(`${input.end}T23:59:59.999Z`) : new Date();
  const start = input.start ? new Date(`${input.start}T00:00:00.000Z`) : new Date(end.getTime() - 29 * 86400000);
  return { start, end };
}

function reportable(value: unknown) {
  return Number(value) >= MINIMUM_GROUP_SIZE;
}

function suppressedTotals<T extends Record<string, unknown>>(cohort: unknown, totals: T): Record<keyof T, number | null> {
  return Object.fromEntries(Object.keys(totals).map(key => [key, reportable(cohort) ? Number(totals[key]) : null])) as Record<keyof T, number | null>;
}

async function logAccess(actorId: string, actorName: string, action: string, details: Record<string, unknown>) {
  await writeAudit({ actorType: "hq", actorId, actorName, action, entityType: "data_insights", details });
}

function periodQuery(table: "search_events" | "orders" | "pharmacies" | "patients", bucket: string, start: Date, end: Date, activeOnly = false) {
  const createdRange = table === "pharmacies" ? sql`created_at >= ${start} AND created_at <= ${end}` : sql`created_at >= ${start} AND created_at <= ${end}`;
  const count = activeOnly ? sql`count(*) FILTER (WHERE is_active)` : sql`count(*)`;
  return sql`SELECT date_trunc(${bucket}, created_at)::date::text AS period, ${count}::int AS count
    FROM ${sql.raw(table)} WHERE ${createdRange} GROUP BY 1 HAVING ${count} >= ${MINIMUM_GROUP_SIZE} ORDER BY 1`;
}

// Aggregate-only reporting. Every returned value has a cohort of at least ten
// events, orders, patients, pharmacies, or reviewed prescriptions.
router.get("/", async (req: AuthRequest, res): Promise<void> => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "start/end must be YYYY-MM-DD and interval must be day, week, or month" }); return; }
  const { start, end } = getRange(parsed.data);
  const bucket = parsed.data.interval;
  const values = sql.join(completedStatuses.map(status => sql`${status}`), sql`, `);
  const [searchResult, orderResult, prescriptionResult, searchTrend, orderTrend, pharmacyTrend, patientTrend, topDrugs, topCategories, pharmacyRevenue, categoryRevenue, demand, lowFulfillment, areas, categoryAreas] = await Promise.all([
    db.execute(sql`SELECT count(*)::int AS searches, count(DISTINCT normalized_query) FILTER (WHERE normalized_query IS NOT NULL)::int AS unique_drugs,
      count(*) FILTER (WHERE result_count = 0)::int AS zero_result_searches FROM search_events WHERE created_at >= ${start} AND created_at <= ${end}`),
    db.execute(sql`SELECT
      (SELECT count(*) FROM orders WHERE created_at >= ${start} AND created_at <= ${end})::int AS order_volume,
      (SELECT count(*) FROM orders WHERE status IN (${values}) AND completed_at >= ${start} AND completed_at <= ${end})::int AS completed_orders,
      (SELECT coalesce(sum(total_leones), 0) FROM orders WHERE status IN (${values}) AND completed_at >= ${start} AND completed_at <= ${end})::float AS total_revenue,
      (SELECT coalesce(sum(medicine_commission_minor), 0) FROM orders WHERE status IN (${values}) AND completed_at >= ${start} AND completed_at <= ${end})::int AS medicine_markup_minor,
      (SELECT coalesce(sum(delivery_commission_minor), 0) FROM orders WHERE status IN (${values}) AND completed_at >= ${start} AND completed_at <= ${end})::int AS delivery_commission_minor,
      (SELECT coalesce(avg(total_leones), 0) FROM orders WHERE status IN (${values}) AND completed_at >= ${start} AND completed_at <= ${end})::float AS average_order_value`),
    db.execute(sql`SELECT count(*) FILTER (WHERE status = 'approved')::int AS approved, count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
      count(*) FILTER (WHERE status IN ('approved', 'rejected'))::int AS reviewed FROM prescriptions WHERE created_at >= ${start} AND created_at <= ${end}`),
    db.execute(periodQuery("search_events", bucket, start, end)),
    db.execute(periodQuery("orders", bucket, start, end)),
    db.execute(periodQuery("pharmacies", bucket, start, end, true)),
    db.execute(periodQuery("patients", bucket, start, end)),
    db.execute(sql`SELECT normalized_query AS label, count(*)::int AS count FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND normalized_query IS NOT NULL GROUP BY 1 HAVING count(*) >= ${MINIMUM_GROUP_SIZE} ORDER BY count DESC LIMIT 10`),
    db.execute(sql`SELECT primary_category AS label, count(*)::int AS count FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND primary_category IS NOT NULL GROUP BY 1 HAVING count(*) >= ${MINIMUM_GROUP_SIZE} ORDER BY count DESC LIMIT 10`),
    db.execute(sql`SELECT p.name AS label, sum(o.total_leones)::float AS revenue, count(DISTINCT o.id)::int AS count FROM orders o JOIN pharmacies p ON p.id = o.pharmacy_id WHERE o.completed_at >= ${start} AND o.completed_at <= ${end} AND o.status IN (${values}) GROUP BY p.id, p.name HAVING count(DISTINCT o.id) >= ${MINIMUM_GROUP_SIZE} ORDER BY revenue DESC LIMIT 20`),
    db.execute(sql`SELECT i.primary_category AS label, sum(o.total_leones)::float AS revenue, count(DISTINCT o.id)::int AS count FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN pharmacy_inventory i ON i.id = oi.inventory_id WHERE o.completed_at >= ${start} AND o.completed_at <= ${end} AND o.status IN (${values}) GROUP BY i.primary_category HAVING count(DISTINCT o.id) >= ${MINIMUM_GROUP_SIZE} ORDER BY revenue DESC`),
    db.execute(sql`SELECT i.primary_category AS label, count(DISTINCT o.id)::int AS count FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN pharmacy_inventory i ON i.id = oi.inventory_id WHERE o.created_at >= ${start} AND o.created_at <= ${end} GROUP BY i.primary_category HAVING count(DISTINCT o.id) >= ${MINIMUM_GROUP_SIZE} ORDER BY count DESC`),
    db.execute(sql`SELECT normalized_query AS label, count(*)::int AS count FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND normalized_query IS NOT NULL AND result_count = 0 GROUP BY 1 HAVING count(*) >= ${MINIMUM_GROUP_SIZE} ORDER BY count DESC LIMIT 10`),
    db.execute(sql`SELECT area_district AS label, count(*)::int AS count FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} GROUP BY 1 HAVING count(*) >= ${MINIMUM_GROUP_SIZE} ORDER BY count DESC`),
    db.execute(sql`SELECT primary_category AS category, area_district AS area, count(*)::int AS count FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND primary_category IS NOT NULL GROUP BY primary_category, area_district HAVING count(*) >= ${MINIMUM_GROUP_SIZE} ORDER BY count DESC`),
  ]);
  const search = searchResult.rows[0] ?? {};
  const order = orderResult.rows[0] ?? {};
  const rates = prescriptionResult.rows[0] ?? {};
  const searchTotals = suppressedTotals(search.searches, { totalSearches: search.searches, uniqueDrugsSearched: search.unique_drugs });
  const zeroResultSearches = reportable(search.zero_result_searches) ? Number(search.zero_result_searches) : null;
  const orderTotals = {
    ...suppressedTotals(order.order_volume, { orderVolume: order.order_volume }),
    ...suppressedTotals(order.completed_orders, { completedOrders: order.completed_orders, totalRevenue: order.total_revenue, medicineMarkupMinor: order.medicine_markup_minor, deliveryCommissionMinor: order.delivery_commission_minor, averageOrderValue: order.average_order_value }),
  };
  const reviewed = Number(rates.reviewed);
  await logAccess(req.pharmacy!.sub, req.pharmacy!.name, "data_insights.viewed", { start: start.toISOString(), end: end.toISOString(), interval: bucket });
  res.json({
    minimumGroupSize: MINIMUM_GROUP_SIZE,
    dateRange: { start: start.toISOString(), end: end.toISOString(), interval: bucket },
    totals: { ...searchTotals, zeroResultSearches, ...orderTotals, prescriptionApprovalRate: reportable(reviewed) ? Number(rates.approved) / reviewed : null, prescriptionRejectionRate: reportable(reviewed) ? Number(rates.rejected) / reviewed : null },
    trends: { searches: searchTrend.rows, orders: orderTrend.rows, activePharmacies: pharmacyTrend.rows, registeredPatients: patientTrend.rows },
    rankings: { topSearchedDrugs: topDrugs.rows, topSearchedCategories: topCategories.rows, revenueByPharmacy: pharmacyRevenue.rows, revenueByDrugCategory: categoryRevenue.rows, demandByCategory: demand.rows, highSearchLowFulfillment: lowFulfillment.rows, searchVolumeByArea: areas.rows, demandByCategoryArea: categoryAreas.rows },
    suppression: {
      totalSearches: reportable(search.searches) ? "Reported." : SUPPRESSED,
      uniqueDrugsSearched: reportable(search.searches) ? "Reported." : SUPPRESSED,
      zeroResultSearches: reportable(search.zero_result_searches) ? "Reported." : SUPPRESSED,
      orderVolume: reportable(order.order_volume) ? "Reported." : SUPPRESSED,
      completedOrders: reportable(order.completed_orders) ? "Reported." : SUPPRESSED,
      totalRevenue: reportable(order.completed_orders) ? "Reported." : SUPPRESSED,
      medicineMarkupMinor: reportable(order.completed_orders) ? "Reported." : SUPPRESSED,
      deliveryCommissionMinor: reportable(order.completed_orders) ? "Reported." : SUPPRESSED,
      averageOrderValue: reportable(order.completed_orders) ? "Reported." : SUPPRESSED,
      prescriptionApprovalRate: reportable(reviewed) ? "Reported." : `Suppressed: fewer than ${MINIMUM_GROUP_SIZE} reviewed prescriptions.`,
      prescriptionRejectionRate: reportable(reviewed) ? "Reported." : `Suppressed: fewer than ${MINIMUM_GROUP_SIZE} reviewed prescriptions.`,
      searches: `Periods with fewer than ${MINIMUM_GROUP_SIZE} contributing search events are omitted.`,
      orders: `Periods with fewer than ${MINIMUM_GROUP_SIZE} contributing orders are omitted.`,
      activePharmacies: `Periods with fewer than ${MINIMUM_GROUP_SIZE} active pharmacies are omitted.`,
      registeredPatients: `Periods with fewer than ${MINIMUM_GROUP_SIZE} contributing patients are omitted.`,
      topSearchedDrugs: `Groups with fewer than ${MINIMUM_GROUP_SIZE} contributing search events are omitted.`,
      topSearchedCategories: `Groups with fewer than ${MINIMUM_GROUP_SIZE} contributing search events are omitted.`,
      revenueByPharmacy: `Groups with fewer than ${MINIMUM_GROUP_SIZE} completed orders are omitted.`,
      revenueByDrugCategory: `Groups with fewer than ${MINIMUM_GROUP_SIZE} completed orders are omitted.`,
      demandByCategory: `Groups with fewer than ${MINIMUM_GROUP_SIZE} contributing orders are omitted.`,
      highSearchLowFulfillment: `Groups with fewer than ${MINIMUM_GROUP_SIZE} zero-result search events are omitted.`,
      searchVolumeByArea: "Only a recognized coarse district derived from an existing profile address, or Unknown, is retained. Exact addresses and groups under 10 are never shown.",
      demandByCategoryArea: `Groups with fewer than ${MINIMUM_GROUP_SIZE} contributing search events are omitted.`,
    },
  });
});

router.get("/export.csv", async (req: AuthRequest, res): Promise<void> => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid date range" }); return; }
  const { start, end } = getRange(parsed.data);
  const bucket = parsed.data.interval;
  const values = sql.join(completedStatuses.map(status => sql`${status}`), sql`, `);
  const [searchResult, orderResult, prescriptionResult, searchesByPeriod, ordersByPeriod, pharmaciesByPeriod, patientsByPeriod, drugs, categories, pharmacyRevenue, categoryRevenue, demand, areas, categoryAreas, lowFulfillment] = await Promise.all([
    db.execute(sql`SELECT count(*)::int AS searches, count(DISTINCT normalized_query) FILTER (WHERE normalized_query IS NOT NULL)::int AS unique_drugs, count(*) FILTER (WHERE result_count = 0)::int AS zero_result_searches FROM search_events WHERE created_at >= ${start} AND created_at <= ${end}`),
    db.execute(sql`SELECT (SELECT count(*) FROM orders WHERE created_at >= ${start} AND created_at <= ${end})::int AS order_volume, (SELECT count(*) FROM orders WHERE status IN (${values}) AND completed_at >= ${start} AND completed_at <= ${end})::int AS completed_orders, (SELECT coalesce(sum(total_leones), 0) FROM orders WHERE status IN (${values}) AND completed_at >= ${start} AND completed_at <= ${end})::float AS total_revenue, (SELECT coalesce(sum(medicine_commission_minor), 0) FROM orders WHERE status IN (${values}) AND completed_at >= ${start} AND completed_at <= ${end})::int AS medicine_markup_minor, (SELECT coalesce(sum(delivery_commission_minor), 0) FROM orders WHERE status IN (${values}) AND completed_at >= ${start} AND completed_at <= ${end})::int AS delivery_commission_minor, (SELECT coalesce(avg(total_leones), 0) FROM orders WHERE status IN (${values}) AND completed_at >= ${start} AND completed_at <= ${end})::float AS average_order_value`),
    db.execute(sql`SELECT count(*) FILTER (WHERE status = 'approved')::int AS approved, count(*) FILTER (WHERE status = 'rejected')::int AS rejected, count(*) FILTER (WHERE status IN ('approved', 'rejected'))::int AS reviewed FROM prescriptions WHERE created_at >= ${start} AND created_at <= ${end}`),
    db.execute(periodQuery("search_events", bucket, start, end)), db.execute(periodQuery("orders", bucket, start, end)), db.execute(periodQuery("pharmacies", bucket, start, end, true)), db.execute(periodQuery("patients", bucket, start, end)),
    db.execute(sql`SELECT normalized_query AS label, count(*)::int AS value FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND normalized_query IS NOT NULL GROUP BY 1 HAVING count(*) >= ${MINIMUM_GROUP_SIZE} ORDER BY value DESC LIMIT 10`),
    db.execute(sql`SELECT primary_category AS label, count(*)::int AS value FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND primary_category IS NOT NULL GROUP BY 1 HAVING count(*) >= ${MINIMUM_GROUP_SIZE} ORDER BY value DESC`),
    db.execute(sql`SELECT p.name AS label, sum(o.total_leones)::float AS value FROM orders o JOIN pharmacies p ON p.id=o.pharmacy_id WHERE o.status IN (${values}) AND o.completed_at >= ${start} AND o.completed_at <= ${end} GROUP BY p.id,p.name HAVING count(DISTINCT o.id) >= ${MINIMUM_GROUP_SIZE} ORDER BY value DESC`),
    db.execute(sql`SELECT i.primary_category AS label, sum(o.total_leones)::float AS value FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN pharmacy_inventory i ON i.id=oi.inventory_id WHERE o.status IN (${values}) AND o.completed_at >= ${start} AND o.completed_at <= ${end} GROUP BY i.primary_category HAVING count(DISTINCT o.id) >= ${MINIMUM_GROUP_SIZE} ORDER BY value DESC`),
    db.execute(sql`SELECT i.primary_category AS label, count(DISTINCT o.id)::int AS value FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN pharmacy_inventory i ON i.id=oi.inventory_id WHERE o.created_at >= ${start} AND o.created_at <= ${end} GROUP BY i.primary_category HAVING count(DISTINCT o.id) >= ${MINIMUM_GROUP_SIZE} ORDER BY value DESC`),
    db.execute(sql`SELECT area_district AS label, count(*)::int AS value FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} GROUP BY 1 HAVING count(*) >= ${MINIMUM_GROUP_SIZE} ORDER BY value DESC`),
    db.execute(sql`SELECT primary_category || ' — ' || area_district AS label, count(*)::int AS value FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND primary_category IS NOT NULL GROUP BY primary_category,area_district HAVING count(*) >= ${MINIMUM_GROUP_SIZE} ORDER BY value DESC`),
    db.execute(sql`SELECT normalized_query AS label, count(*)::int AS value FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND normalized_query IS NOT NULL AND result_count=0 GROUP BY 1 HAVING count(*) >= ${MINIMUM_GROUP_SIZE} ORDER BY value DESC`),
  ]);
  const search = searchResult.rows[0] ?? {};
  const order = orderResult.rows[0] ?? {};
  const prescription = prescriptionResult.rows[0] ?? {};
  const totals = { ...suppressedTotals(search.searches, { searches: search.searches, unique_drugs: search.unique_drugs }), zero_result_searches: reportable(search.zero_result_searches) ? Number(search.zero_result_searches) : null, ...suppressedTotals(order.order_volume, { order_volume: order.order_volume }), ...suppressedTotals(order.completed_orders, { completed_orders: order.completed_orders, total_revenue: order.total_revenue, medicine_markup_minor: order.medicine_markup_minor, delivery_commission_minor: order.delivery_commission_minor, average_order_value: order.average_order_value }), prescription_approval_rate: reportable(prescription.reviewed) ? Number(prescription.approved) / Number(prescription.reviewed) : null, prescription_rejection_rate: reportable(prescription.reviewed) ? Number(prescription.rejected) / Number(prescription.reviewed) : null };
  const rows = ["section,label,value"];
  for (const [label, value] of Object.entries(totals)) rows.push(`totals,${label},${value === null ? "SUPPRESSED" : value}`);
  rows.push(`suppression,minimum_group_size,${MINIMUM_GROUP_SIZE}`);
  rows.push(`suppression,totals,${JSON.stringify(SUPPRESSED)}`);
  for (const [section, result] of Object.entries({ search_trend: searchesByPeriod, order_trend: ordersByPeriod, active_pharmacies_trend: pharmaciesByPeriod, registered_patients_trend: patientsByPeriod, top_drugs: drugs, top_categories: categories, revenue_by_pharmacy: pharmacyRevenue, revenue_by_category: categoryRevenue, demand_by_category: demand, search_volume_by_area: areas, demand_by_category_area: categoryAreas, high_search_low_fulfillment: lowFulfillment })) {
    for (const row of result.rows as Array<{ period?: string; label?: string; count?: string | number; value?: string | number }>) rows.push(`${section},${JSON.stringify(row.label ?? row.period)},${row.value ?? row.count}`);
  }
  await logAccess(req.pharmacy!.sub, req.pharmacy!.name, "data_insights.exported_csv", { start: start.toISOString(), end: end.toISOString(), interval: bucket });
  res.type("text/csv").attachment("mobicare-data-insights.csv").send(`${rows.join("\r\n")}\r\n`);
});

export default router;