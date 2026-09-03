import { safeRouter } from "../../lib/safeRouter.js";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { writeAudit } from "../../lib/audit.js";
import type { AuthRequest } from "../../middlewares/auth.js";

const router = safeRouter();
const resources = {
  orders: sql`SELECT o.id, o.created_at, o.updated_at, o.status, o.fulfillment_type,
    o.patient_name, o.patient_phone, p.name AS pharmacy_name, o.total_leones,
    o.payment_method, o.completed_at
    FROM orders o JOIN pharmacies p ON p.id = o.pharmacy_id
    ORDER BY o.created_at DESC`,
  patients: sql`SELECT id, name, phone, email, date_of_birth, nationality, address,
    is_active, created_at, updated_at FROM patients ORDER BY created_at DESC`,
  notifications: sql`SELECT 'patient' AS audience, pn.id, pt.name AS recipient,
    pn.title, pn.body, pn.type, pn.read_at, pn.created_at
    FROM patient_notifications pn JOIN patients pt ON pt.id = pn.patient_id
    UNION ALL
    SELECT 'pharmacy' AS audience, n.id, p.name AS recipient,
    n.title, n.body, n.type, n.read_at, n.created_at
    FROM notifications n JOIN pharmacies p ON p.id = n.pharmacy_id
    ORDER BY created_at DESC`,
  catalogue: sql`SELECT id, name, generic_name, tier, unit, primary_category,
    subcategory, is_approved, review_status, common_strengths, common_forms,
    max_units_per_order, created_at, updated_at FROM drug_catalogue
    ORDER BY name`,
  inventory: sql`SELECT i.id, p.name AS pharmacy_name, d.name AS drug_name,
    i.strength, i.form, i.unit_of_sale, i.price_leones, i.stock_quantity,
    i.expiry_date, i.is_active, i.updated_at
    FROM pharmacy_inventory i
    JOIN pharmacies p ON p.id = i.pharmacy_id
    JOIN drug_catalogue d ON d.id = i.drug_id
    ORDER BY p.name, d.name`,
} as const;

type Resource = keyof typeof resources;

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = Array.isArray(value)
    ? value.join(" | ")
    : value instanceof Date
      ? value.toISOString()
      : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

router.get("/:resource.csv", async (req: AuthRequest, res) => {
  const resource = req.params.resource as Resource;
  if (!(resource in resources)) {
    res.status(404).json({ error: "Export type not found" });
    return;
  }
  const result = await db.execute(resources[resource]);
  const rows = result.rows as Record<string, unknown>[];
  const columns = rows.length ? Object.keys(rows[0]!) : [];
  const csv = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\r\n");
  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "data_export.downloaded",
    entityType: resource,
    details: { rowCount: rows.length },
  });
  res
    .type("text/csv")
    .attachment(`mobicare-${resource}-${new Date().toISOString().slice(0, 10)}.csv`)
    .send(`${csv}\r\n`);
});

export default router;