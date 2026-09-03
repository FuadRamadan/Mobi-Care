import { safeRouter } from "../../lib/safeRouter.js";
import { db } from "@workspace/db";
import { writeAudit } from "../../lib/audit.js";
import { z } from "zod";
import { sql } from "drizzle-orm";
import type { AuthRequest } from "../../middlewares/auth.js";

const router = safeRouter();
const completedStatuses = ["delivered", "collected"];

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

async function logAccess(actorId: string, actorName: string, action: string, details: Record<string, unknown>) {
  await writeAudit({ actorType: "hq", actorId, actorName, action, entityType: "data_insights", details });
}

function periodQuery(table: "search_events" | "orders" | "pharmacies" | "patients", bucket: string, start: Date, end: Date, activeOnly = false) {
  const createdRange = table === "pharmacies" ? sql`created_at >= ${start} AND created_at <= ${end}` : sql`created_at >= ${start} AND created_at <= ${end}`;
  const count = activeOnly ? sql`count(*) FILTER (WHERE is_active)` : sql`count(*)`;
  return sql`SELECT date_trunc(${bucket}, created_at)::date::text AS period, ${count}::int AS count
    FROM ${sql.raw(table)} WHERE ${createdRange} GROUP BY 1 ORDER BY 1`;
}

// Aggregate-only reporting. Counts are returned for every group, including one.
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
    db.execute(sql`SELECT normalized_query AS label, count(*)::int AS count FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND normalized_query IS NOT NULL GROUP BY 1 ORDER BY count DESC`),
    db.execute(sql`SELECT primary_category AS label, count(*)::int AS count FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND primary_category IS NOT NULL GROUP BY 1 ORDER BY count DESC`),
    db.execute(sql`SELECT p.name AS label, sum(o.total_leones)::float AS revenue, count(DISTINCT o.id)::int AS count FROM orders o JOIN pharmacies p ON p.id = o.pharmacy_id WHERE o.completed_at >= ${start} AND o.completed_at <= ${end} AND o.status IN (${values}) GROUP BY p.id, p.name ORDER BY revenue DESC`),
    db.execute(sql`SELECT i.primary_category AS label, sum(o.total_leones)::float AS revenue, count(DISTINCT o.id)::int AS count FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN pharmacy_inventory i ON i.id = oi.inventory_id WHERE o.completed_at >= ${start} AND o.completed_at <= ${end} AND o.status IN (${values}) GROUP BY i.primary_category ORDER BY revenue DESC`),
    db.execute(sql`SELECT i.primary_category AS label, count(DISTINCT o.id)::int AS count FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN pharmacy_inventory i ON i.id = oi.inventory_id WHERE o.created_at >= ${start} AND o.created_at <= ${end} GROUP BY i.primary_category ORDER BY count DESC`),
    db.execute(sql`SELECT normalized_query AS label, count(*)::int AS count FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND normalized_query IS NOT NULL AND result_count = 0 GROUP BY 1 ORDER BY count DESC`),
    db.execute(sql`SELECT area_district AS label, count(*)::int AS count FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} GROUP BY 1 ORDER BY count DESC`),
    db.execute(sql`SELECT primary_category AS category, area_district AS area, count(*)::int AS count FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND primary_category IS NOT NULL GROUP BY primary_category, area_district ORDER BY count DESC`),
  ]);
  const search = searchResult.rows[0] ?? {};
  const order = orderResult.rows[0] ?? {};
  const rates = prescriptionResult.rows[0] ?? {};
  const searchTotals = { totalSearches: Number(search.searches ?? 0), uniqueDrugsSearched: Number(search.unique_drugs ?? 0) };
  const zeroResultSearches = Number(search.zero_result_searches ?? 0);
  const orderTotals = {
    orderVolume: Number(order.order_volume ?? 0),
    completedOrders: Number(order.completed_orders ?? 0),
    totalRevenue: Number(order.total_revenue ?? 0),
    medicineMarkupMinor: Number(order.medicine_markup_minor ?? 0),
    deliveryCommissionMinor: Number(order.delivery_commission_minor ?? 0),
    averageOrderValue: Number(order.average_order_value ?? 0),
  };
  const reviewed = Number(rates.reviewed);
  await logAccess(req.pharmacy!.sub, req.pharmacy!.name, "data_insights.viewed", { start: start.toISOString(), end: end.toISOString(), interval: bucket });
  res.json({
    dateRange: { start: start.toISOString(), end: end.toISOString(), interval: bucket },
    totals: { ...searchTotals, zeroResultSearches, ...orderTotals, prescriptionApprovalRate: reviewed ? Number(rates.approved) / reviewed : 0, prescriptionRejectionRate: reviewed ? Number(rates.rejected) / reviewed : 0 },
    trends: { searches: searchTrend.rows, orders: orderTrend.rows, activePharmacies: pharmacyTrend.rows, registeredPatients: patientTrend.rows },
    rankings: { topSearchedDrugs: topDrugs.rows, topSearchedCategories: topCategories.rows, revenueByPharmacy: pharmacyRevenue.rows, revenueByDrugCategory: categoryRevenue.rows, demandByCategory: demand.rows, highSearchLowFulfillment: lowFulfillment.rows, searchVolumeByArea: areas.rows, demandByCategoryArea: categoryAreas.rows },
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
    db.execute(sql`SELECT normalized_query AS label, count(*)::int AS value FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND normalized_query IS NOT NULL GROUP BY 1 ORDER BY value DESC`),
    db.execute(sql`SELECT primary_category AS label, count(*)::int AS value FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND primary_category IS NOT NULL GROUP BY 1 ORDER BY value DESC`),
    db.execute(sql`SELECT p.name AS label, sum(o.total_leones)::float AS value FROM orders o JOIN pharmacies p ON p.id=o.pharmacy_id WHERE o.status IN (${values}) AND o.completed_at >= ${start} AND o.completed_at <= ${end} GROUP BY p.id,p.name ORDER BY value DESC`),
    db.execute(sql`SELECT i.primary_category AS label, sum(o.total_leones)::float AS value FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN pharmacy_inventory i ON i.id=oi.inventory_id WHERE o.status IN (${values}) AND o.completed_at >= ${start} AND o.completed_at <= ${end} GROUP BY i.primary_category ORDER BY value DESC`),
    db.execute(sql`SELECT i.primary_category AS label, count(DISTINCT o.id)::int AS value FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN pharmacy_inventory i ON i.id=oi.inventory_id WHERE o.created_at >= ${start} AND o.created_at <= ${end} GROUP BY i.primary_category ORDER BY value DESC`),
    db.execute(sql`SELECT area_district AS label, count(*)::int AS value FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} GROUP BY 1 ORDER BY value DESC`),
    db.execute(sql`SELECT primary_category || ' — ' || area_district AS label, count(*)::int AS value FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND primary_category IS NOT NULL GROUP BY primary_category,area_district ORDER BY value DESC`),
    db.execute(sql`SELECT normalized_query AS label, count(*)::int AS value FROM search_events WHERE created_at >= ${start} AND created_at <= ${end} AND normalized_query IS NOT NULL AND result_count=0 GROUP BY 1 ORDER BY value DESC`),
  ]);
  const search = searchResult.rows[0] ?? {};
  const order = orderResult.rows[0] ?? {};
  const prescription = prescriptionResult.rows[0] ?? {};
  const reviewed = Number(prescription.reviewed ?? 0);
  const totals = { searches: Number(search.searches ?? 0), unique_drugs: Number(search.unique_drugs ?? 0), zero_result_searches: Number(search.zero_result_searches ?? 0), order_volume: Number(order.order_volume ?? 0), completed_orders: Number(order.completed_orders ?? 0), total_revenue: Number(order.total_revenue ?? 0), medicine_markup_minor: Number(order.medicine_markup_minor ?? 0), delivery_commission_minor: Number(order.delivery_commission_minor ?? 0), average_order_value: Number(order.average_order_value ?? 0), prescription_approval_rate: reviewed ? Number(prescription.approved) / reviewed : 0, prescription_rejection_rate: reviewed ? Number(prescription.rejected) / reviewed : 0 };
  const rows = ["section,label,value"];
  for (const [label, value] of Object.entries(totals)) rows.push(`totals,${label},${value}`);
  for (const [section, result] of Object.entries({ search_trend: searchesByPeriod, order_trend: ordersByPeriod, active_pharmacies_trend: pharmaciesByPeriod, registered_patients_trend: patientsByPeriod, top_drugs: drugs, top_categories: categories, revenue_by_pharmacy: pharmacyRevenue, revenue_by_category: categoryRevenue, demand_by_category: demand, search_volume_by_area: areas, demand_by_category_area: categoryAreas, high_search_low_fulfillment: lowFulfillment })) {
    for (const row of result.rows as Array<{ period?: string; label?: string; count?: string | number; value?: string | number }>) rows.push(`${section},${JSON.stringify(row.label ?? row.period)},${row.value ?? row.count}`);
  }
  await logAccess(req.pharmacy!.sub, req.pharmacy!.name, "data_insights.exported_csv", { start: start.toISOString(), end: end.toISOString(), interval: bucket });
  res.type("text/csv").attachment("mobicare-data-insights.csv").send(`${rows.join("\r\n")}\r\n`);
});

export default router;