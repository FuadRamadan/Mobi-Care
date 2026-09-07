/**
 * What a pilot-data reset removes, and in what order.
 *
 * Kept apart from the route so the rules can be read — and tested — without a
 * database, an HTTP request, or object storage. The ordering here is the whole
 * correctness argument, so it is worth being able to assert on directly.
 *
 * Scope is deliberately narrow: the operational record the Data & Insights
 * screen is built from — searches, orders, prescriptions — and the money ledger
 * derived from those orders. Everything that makes the platform a platform
 * survives: pharmacies, patients, HQ staff, the drug catalogue, pharmacy
 * inventory, adverts, the password policy, and the audit log.
 *
 * Two things are worth understanding before reading the step list.
 *
 * Order matters. Deleting orders is blocked by two foreign keys declared
 * ON DELETE RESTRICT: commission_settlement_adjustments.source_order_id, and
 * the settlement rows those adjustments hang off. So the settlement ledger is
 * cleared first. Anything declared ON DELETE CASCADE (order_items, flags) would
 * follow orders automatically, but is deleted explicitly anyway so the reported
 * count is a real count rather than a silent side effect.
 *
 * The settlement ledger goes too, and that is not scope creep. Every commission
 * settlement is computed from orders; keeping them would leave pharmacies
 * invoiced for orders that no longer exist. The confirmation dialog says so
 * plainly rather than burying it.
 *
 * The audit log is never touched. It is append-only by design (see lib/audit.ts)
 * and the reset writes its own entry into it, so who cleared what stays on the
 * record after the data is gone.
 */

/** Typed by the operator to confirm. Deliberately not a word typed by accident. */
export const CONFIRMATION_PHRASE = "RESET PILOT DATA";

export interface ResetStep {
  /** Table emptied by this step. */
  table: string;
  /** Shown in the confirmation dialog. */
  label: string;
  /**
   * SQL predicate limiting which rows go, or null for every row in the table.
   *
   * These are fixed strings written here, never anything from a request, which
   * is why they can be interpolated raw.
   */
  scope: string | null;
}

/**
 * Notifications are cleared only where they point at an order or a prescription
 * that is about to be deleted. A notification about anything else — a drug
 * proposal decision, an account change — is not pilot traffic and stays.
 */
const NOTIFIES_DELETED_RECORD =
  "reference_id IS NOT NULL AND (reference_id IN (SELECT id FROM orders) " +
  "OR reference_id IN (SELECT id FROM prescriptions))";

/** Executed top to bottom. The order satisfies every foreign key. */
export const RESET_STEPS: ResetStep[] = [
  // Notifications first: they carry no foreign key, so nothing forces this,
  // but a notification linking to a deleted order is a dead end in the app.
  { table: "notifications", label: "Pharmacy notifications about pilot orders", scope: NOTIFIES_DELETED_RECORD },
  { table: "patient_notifications", label: "Patient notifications about pilot orders", scope: NOTIFIES_DELETED_RECORD },
  { table: "hq_notifications", label: "HQ notifications about pilot orders", scope: NOTIFIES_DELETED_RECORD },

  // Settlement ledger, innermost first — every one of these is RESTRICT.
  { table: "commission_settlement_payments", label: "Commission payments recorded against pilot settlements", scope: null },
  { table: "commission_settlement_adjustments", label: "Commission adjustments and refunds", scope: null },
  { table: "commission_settlements", label: "Daily commission settlements", scope: null },
  { table: "settlements", label: "Pharmacy payout records", scope: null },
  { table: "courier_settlements", label: "Courier payout records", scope: null },

  // Orders and everything hanging off them.
  { table: "flags", label: "Fraud and anomaly flags", scope: null },
  { table: "order_items", label: "Order lines", scope: null },
  { table: "orders", label: "Orders", scope: null },

  // Prescriptions and the upload ledger behind them.
  { table: "prescriptions", label: "Prescription reviews", scope: null },
  { table: "prescription_uploads", label: "Uploaded prescription images", scope: null },

  // The search log the demand reporting is built from.
  { table: "search_events", label: "Patient searches", scope: null },
];

/**
 * Named in the confirmation dialog. Saying what survives is as important as
 * saying what goes — the fear when clearing data is not knowing the boundary.
 */
export const PRESERVED = [
  "Pharmacy accounts, and their inventory and prices",
  "Patient accounts and profiles",
  "HQ staff accounts and permissions",
  "The HQ drug catalogue, including tiers and categories",
  "Adverts, password policy and platform settings",
  "The audit log — including a record of this reset",
];

const where = (step: ResetStep): string => (step.scope ? ` WHERE ${step.scope}` : "");

/** Both queries are built from one scope, so the preview cannot drift from the deletion. */
export const countSql = (step: ResetStep): string =>
  `SELECT count(*)::int AS n FROM ${step.table}${where(step)}`;

export const deleteSql = (step: ResetStep): string =>
  `DELETE FROM ${step.table}${where(step)}`;

