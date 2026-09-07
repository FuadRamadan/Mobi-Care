/**
 * The pilot reset is one transaction against a live database, so the ordering
 * of its deletions cannot be discovered by trying it — a wrong order aborts on
 * a foreign key and the whole thing rolls back, at the moment someone is
 * clearing production data for launch.
 *
 * These assert the properties that ordering has to satisfy, from the schema's
 * own foreign keys, so a table added to the list in the wrong place fails here
 * instead of there.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  CONFIRMATION_PHRASE,
  countSql,
  deleteSql,
  PRESERVED,
  RESET_STEPS,
} from "./pilotResetPlan.js";

const order = new Map(RESET_STEPS.map((step, index) => [step.table, index]));

/** Every foreign key that points into something the reset deletes. */
const DEPENDENCIES: Array<[dependent: string, referenced: string]> = [
  // ON DELETE RESTRICT — these genuinely block the parent delete.
  ["commission_settlement_payments", "commission_settlements"],
  ["commission_settlement_adjustments", "commission_settlements"],
  ["commission_settlement_adjustments", "orders"],
  // ON DELETE CASCADE — ordering is not enforced by the database, but deleting
  // these first is what makes the reported counts real rather than zero.
  ["order_items", "orders"],
  ["flags", "orders"],
];

test("every dependent table is emptied before the table it points at", () => {
  for (const [dependent, referenced] of DEPENDENCIES) {
    const from = order.get(dependent);
    const to = order.get(referenced);
    assert.ok(from !== undefined, `${dependent} is missing from the reset plan`);
    assert.ok(to !== undefined, `${referenced} is missing from the reset plan`);
    assert.ok(
      from! < to!,
      `${dependent} must be deleted before ${referenced}, or the transaction ` +
        "aborts on a foreign key",
    );
  }
});

test("the plan never touches a table the reset promises to keep", () => {
  // The promise made in the confirmation dialog, as a test. The audit log
  // matters most: it is append-only and records the reset itself.
  for (const table of [
    "audit_log",
    "pharmacies",
    "patients",
    "hq_staff",
    "drug_catalogue",
    "pharmacy_inventory",
    "advertisements",
    "platform_settings",
    "pharmacy_password_policy",
  ]) {
    assert.equal(
      order.has(table),
      false,
      `${table} must survive a pilot reset`,
    );
  }
});

test("no table is listed twice", () => {
  assert.equal(order.size, RESET_STEPS.length);
});

test("every step is labelled for the confirmation dialog", () => {
  for (const step of RESET_STEPS) {
    assert.ok(step.label.trim().length > 0, `${step.table} needs a label`);
  }
  assert.ok(PRESERVED.length > 0);
  assert.ok(PRESERVED.some((line) => /audit log/i.test(line)));
});

test("the preview counts exactly the rows the deletion removes", () => {
  // Preview and deletion are shown separately in the UI, so a scope that
  // applied to only one of them would quietly under-report or over-delete.
  for (const step of RESET_STEPS) {
    const counted = countSql(step);
    const deleted = deleteSql(step);
    assert.ok(counted.startsWith(`SELECT count(*)::int AS n FROM ${step.table}`));
    assert.ok(deleted.startsWith(`DELETE FROM ${step.table}`));
    assert.equal(
      counted.slice(`SELECT count(*)::int AS n FROM ${step.table}`.length),
      deleted.slice(`DELETE FROM ${step.table}`.length),
    );
  }
});

test("scoped steps are limited to records the reset is deleting", () => {
  // Notifications are the only scoped tables: an account notification that has
  // nothing to do with pilot orders must survive.
  const scoped = RESET_STEPS.filter((step) => step.scope !== null);
  assert.deepEqual(
    scoped.map((step) => step.table),
    ["notifications", "patient_notifications", "hq_notifications"],
  );
  for (const step of scoped) {
    assert.match(step.scope!, /reference_id IN \(SELECT id FROM orders\)/);
    assert.match(step.scope!, /reference_id IN \(SELECT id FROM prescriptions\)/);
  }
});

test("the confirmation phrase is not something typed by accident", () => {
  assert.equal(CONFIRMATION_PHRASE, "RESET PILOT DATA");
  assert.ok(CONFIRMATION_PHRASE.length >= 10);
});
