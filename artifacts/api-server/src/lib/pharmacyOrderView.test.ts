import assert from "node:assert/strict";
import { test } from "node:test";
import type { Order } from "@workspace/db/schema";
import { pharmacyOrderView } from "./pharmacyOrderView.js";

const order = (pricingModel: string) =>
  ({
    id: "o1",
    pricingModel,
    totalLeones: "96.20",
    pharmacyMedicineTotalMinor: 6000,
    pharmacyCommissionMinor: 300,
    patientServiceFeeMinor: 120,
    patientMedicineTotalMinor: 6120,
    medicineCommissionMinor: 420,
    medicineMarkupBasisPoints: 200,
  }) as unknown as Order;

test("an online-paid order never carries the patient's service fee or total to the pharmacy", () => {
  const view = pharmacyOrderView(order("split_v1")) as Record<string, unknown>;
  for (const hidden of ["patientServiceFeeMinor", "patientMedicineTotalMinor", "medicineCommissionMinor", "medicineMarkupBasisPoints"]) {
    assert.equal(hidden in view, false, `${hidden} should be removed`);
  }
  assert.equal(view.totalLeones, "60.00");
  assert.equal(view.pharmacyCommissionMinor, 300);
});

test("an order paid directly to the pharmacy is unchanged", () => {
  const direct = order("patient_fee_v1");
  assert.equal(pharmacyOrderView(direct), direct);
});
