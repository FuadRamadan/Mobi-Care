/**
 * Integration test: full patient order flow end-to-end
 *
 * Covers: HQ bootstrap → approved pharmacy listing → patient register/search
 *         → 5% checkout pricing + stale/offline guards → payment → pharmacy
 *         fulfilment → HQ dispatch → patient receipt confirmation → exact
 *         settlement reconciliation → token rotation and revocation
 *
 * Security model:
 *   - Creates a one-time HQ account with a cryptographically-random username
 *     and password for this run only; account is deactivated in the cleanup step.
 *   - Never uses fixed/default credentials that could persist in a shared DB.
 *
 * Usage:
 *   # API server must be running (pnpm --filter @workspace/api-server run dev)
 *   pnpm --filter @workspace/api-server run test-patient-flow
 *
 * Optional env overrides:
 *   TEST_API_BASE_URL   default: http://localhost:$PORT (or :4000)
 */

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  hqStaffTable,
  auditLogTable,
  pharmacyInventoryTable,
  ordersTable,
  pharmaciesTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

// ─── config ──────────────────────────────────────────────────────────────────
const PORT = process.env["PORT"] ?? "4000";
const BASE_URL =
  (process.env["TEST_API_BASE_URL"] ?? `http://localhost:${PORT}`).replace(
    /\/$/,
    "",
  ) + "/api";

/**
 * One-time HQ credentials generated fresh every run.
 * Prevents a fixed username/password from persisting in a shared database
 * after the test completes (the account is deactivated in cleanup).
 */
const HQ_USERNAME = `tst_hq_${crypto.randomBytes(8).toString("hex")}`;
const HQ_PASSWORD = crypto.randomBytes(18).toString("base64url"); // ≥8 chars, high entropy
const HQ_NAME = "Integration Test HQ (ephemeral)";

/** Unique suffix so every test run creates fresh, non-conflicting data */
const RUN_EPOCH = Date.now(); // millisecond timestamp
const RUN_ID = RUN_EPOCH.toString(36).toUpperCase(); // short human-readable tag for logs
// Last 8 digits of the epoch — numeric-only, safe for phone fields
const RUN_DIGITS = String(RUN_EPOCH).slice(-8);

const PATIENT_PHONE = `+232${RUN_DIGITS}`;
const PATIENT_PASSWORD = "Patient_Pass_1!";
const PATIENT_NAME = `Test Patient ${RUN_ID}`;

const PHARMACY_NAME = `Test Pharmacy ${RUN_ID}`;
const PHARMACY_USERNAME = `testph${RUN_DIGITS}`.toLowerCase().slice(0, 30);

const DRUG_NAME = `TestDrug ${RUN_ID}`;
const TEST_STRENGTH = "500 mg";
const TEST_FORM = "Tablet";
const TEST_UNIT_OF_SALE = "Box";
const TEST_PRICE_LEONES = 5000.25;
const TEST_ORDER_QUANTITY = 2;
const SERVICE_FEE_BASIS_POINTS = 500;

// 1×1 transparent PNG — smallest valid image for prescription upload
const MOCK_PRESCRIPTION_B64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQ" +
  "AABjkB6QAAAABJRU5ErkJggg==";

// ─── helpers ─────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function log(label: string, ...args: unknown[]) {
  console.log(`  ${label}`, ...args);
}

function pass(name: string, detail?: string) {
  passed++;
  console.log(`  ✅ PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, reason: unknown) {
  failed++;
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(`  ❌ FAIL  ${name} — ${msg}`);
}

async function api(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text().catch(() => "(no body)");
  }
  return { status: res.status, body };
}

/** Assert status and return body, or throw with detail */
function expect(
  testName: string,
  res: { status: number; body: unknown },
  expectedStatus: number,
): unknown {
  if (res.status !== expectedStatus) {
    throw new Error(
      `expected HTTP ${expectedStatus}, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  return res.body;
}

// ─── step 0: health-check (fail fast if server is down) ──────────────────────
async function checkHealth() {
  try {
    const r = await fetch(`${BASE_URL}/healthz`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    pass("Health check", `${BASE_URL}/healthz → 200`);
  } catch (e) {
    fail(
      "Health check",
      `Cannot reach ${BASE_URL}/healthz — is the API server running? ${e}`,
    );
    throw new Error("abort: server unreachable");
  }
}

// ─── step 1: bootstrap ephemeral HQ account (direct-DB, fresh every run) ────
async function bootstrapHQ(): Promise<{ hqToken: string; hqId: string }> {
  // Always creates a new account — username is random, so no collision risk.
  const hash = await bcrypt.hash(HQ_PASSWORD, 10);
  const [created] = await db
    .insert(hqStaffTable)
    .values({
      username: HQ_USERNAME,
      name: HQ_NAME,
      passwordHash: hash,
      canManageSettlements: true,
    })
    .returning({ id: hqStaffTable.id });
  await db.insert(auditLogTable).values({
    actorType: "system",
    actorName: "test-patient-flow script",
    action: "hq_staff.bootstrap",
    entityType: "hq_staff",
    entityId: created!.id,
    details: {
      username: HQ_USERNAME,
      note: "ephemeral test account — deactivated after test",
    },
  });
  log("Created ephemeral HQ account", HQ_USERNAME);

  // Login to get HQ token
  const loginRes = await api("POST", "/auth/login", {
    body: { identifier: HQ_USERNAME, password: HQ_PASSWORD },
  });
  const loginBody = expect("HQ login", loginRes, 200) as {
    accessToken: string;
  };
  pass("HQ login");
  return { hqToken: loginBody.accessToken, hqId: created!.id };
}

// ─── step 2: create test pharmacy via HQ API ─────────────────────────────────
async function createTestPharmacy(hqToken: string): Promise<{
  pharmacyId: string;
  pharmacyToken: string;
}> {
  const res = await api("POST", "/hq/pharmacies", {
    token: hqToken,
    body: {
      name: PHARMACY_NAME,
      username: PHARMACY_USERNAME,
      phone: `+2327${RUN_DIGITS}`,
      address: "1 Test Street, Freetown",
    },
  });
  const body = expect("Create test pharmacy", res, 201) as {
    pharmacy: { id: string };
    tempPassword: string;
  };
  pass("Create test pharmacy", `id=${body.pharmacy.id}`);

  // Change the temp password so the pharmacy can use the API
  const loginRes = await api("POST", "/auth/login", {
    body: { identifier: PHARMACY_USERNAME, password: body.tempPassword },
  });
  const loginBody = expect("Pharmacy first login", loginRes, 200) as {
    accessToken: string;
  };
  pass("Pharmacy first login (temp password)");

  const changeRes = await api("POST", "/auth/change-password", {
    token: loginBody.accessToken,
    body: { currentPassword: body.tempPassword, newPassword: "PharmacyPwd_2!" },
  });
  expect("Pharmacy password change", changeRes, 200);
  pass("Pharmacy password change");

  const finalLogin = await api("POST", "/auth/login", {
    body: { identifier: PHARMACY_USERNAME, password: "PharmacyPwd_2!" },
  });
  const finalBody = expect("Pharmacy re-login", finalLogin, 200) as {
    accessToken: string;
  };
  pass("Pharmacy re-login");

  return { pharmacyId: body.pharmacy.id, pharmacyToken: finalBody.accessToken };
}

// ─── step 3: create approved drug via HQ API ─────────────────────────────────
async function createTestDrug(hqToken: string): Promise<string> {
  const res = await api("POST", "/hq/drugs", {
    token: hqToken,
    body: {
      name: DRUG_NAME,
      genericName: "Testamol",
      description: "A harmless test-only drug entry",
      tier: "3",
      unit: "Tablet",
      commonStrengths: [TEST_STRENGTH],
      commonForms: [TEST_FORM],
      primaryCategory: "pain_inflammation",
      subcategory: "analgesics_antipyretics",
    },
  });
  const body = expect("Create test drug (HQ)", res, 201) as { id: string };
  pass("Create test drug (HQ)", `id=${body.id}`);
  return body.id;
}

// ─── step 4: add inventory for the test pharmacy ──────────────────────────────
async function addInventory(
  pharmacyToken: string,
  drugId: string,
): Promise<string> {
  const res = await api("POST", "/pharmacy/inventory", {
    token: pharmacyToken,
    body: {
      drugId,
      strength: TEST_STRENGTH,
      form: TEST_FORM,
      unitOfSale: TEST_UNIT_OF_SALE,
      expiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      brand: "TestBrand",
      manufacturer: "Test Manufacturer",
      priceLeones: 5000.25,
      stockQuantity: 3,
      availableForDelivery: true,
      availableForCollection: true,
    },
  });
  const body = expect("Add drug to pharmacy inventory", res, 201) as {
    id: string;
  };
  pass("Add drug to pharmacy inventory", `listingId=${body.id}`);
  return body.id;
}

// ─── step 5: register patient ─────────────────────────────────────────────────
async function registerPatient(): Promise<{
  accessToken: string;
  refreshToken: string;
  patientId: string;
}> {
  const res = await api("POST", "/auth/register", {
    body: {
      name: PATIENT_NAME,
      phone: PATIENT_PHONE,
      password: PATIENT_PASSWORD,
      dateOfBirth: "1990-01-01",
    },
  });
  const body = expect("Register patient", res, 201) as {
    accessToken: string;
    refreshToken: string;
    user: { id: string; role: string };
  };
  if (body.user.role !== "patient") {
    throw new Error(`Expected role=patient, got ${body.user.role}`);
  }
  pass("Register new patient", `id=${body.user.id}`);
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    patientId: body.user.id,
  };
}

// ─── step 6: search for the drug ─────────────────────────────────────────────
async function searchDrug(
  token: string,
  drugName: string,
): Promise<{
  drugId: string;
  pharmacyId: string;
  inventoryId: string;
  priceLeones: number;
}> {
  const query = drugName.slice(0, 8); // Use first 8 chars as search term
  const res = await api(
    "GET",
    `/patient/search?q=${encodeURIComponent(query)}`,
    { token },
  );
  const results = expect("Search for drug", res, 200) as Array<{
    drugId: string;
    name: string;
    offers: Array<{
      pharmacyId: string;
      inventoryId: string;
      priceLeones: number;
      inStock: boolean;
    }>;
  }>;
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error(
      `No results for query "${query}". Got: ${JSON.stringify(results)}`,
    );
  }
  const match = results.find((r) => r.name === drugName);
  if (!match) {
    throw new Error(
      `Drug "${drugName}" not found in results: ${results.map((r) => r.name).join(", ")}`,
    );
  }
  const offer = match.offers.find((o) => o.inStock);
  if (!offer) {
    throw new Error(`No in-stock offer for drug "${drugName}"`);
  }
  pass("Search returns test drug", `inventoryId=${offer.inventoryId}`);
  return {
    drugId: match.drugId,
    pharmacyId: offer.pharmacyId,
    inventoryId: offer.inventoryId,
    priceLeones: offer.priceLeones,
  };
}

function expectedOrderTotals(priceLeones: number, quantity: number) {
  const drugTotalMinor = Math.round(priceLeones * 100) * quantity;
  const serviceFeeMinor = Math.round(
    (drugTotalMinor * SERVICE_FEE_BASIS_POINTS) / 10_000,
  );
  return {
    drugTotalMinor,
    serviceFeeMinor,
    totalMinor: drugTotalMinor + serviceFeeMinor,
  };
}

// ─── step 7: upload prescription ─────────────────────────────────────────────
async function uploadPrescription(token: string): Promise<string> {
  const res = await api("POST", "/patient/uploads/prescription", {
    token,
    body: { image: MOCK_PRESCRIPTION_B64 },
  });
  const body = expect("Upload prescription image", res, 201) as {
    imageKey: string;
  };
  pass("Upload prescription image", `key=${body.imageKey}`);
  return body.imageKey;
}

// ─── step 8: place order ──────────────────────────────────────────────────────
async function placeOrder(
  token: string,
  pharmacyId: string,
  inventoryId: string,
  prescriptionImageKey?: string,
  quantity = TEST_ORDER_QUANTITY,
  expectedTotalMinor?: number,
): Promise<string> {
  if (expectedTotalMinor === undefined) {
    throw new Error("expectedTotalMinor is required for patient checkout");
  }
  const res = await api("POST", "/patient/orders", {
    token,
    body: {
      pharmacyId,
      fulfillmentType: "delivery",
      deliveryAddress: "12 Test Avenue, Freetown",
      prescriptionImageKey,
      expectedTotalMinor,
      items: [{ inventoryId, quantity }],
    },
  });
  const body = expect("Place order", res, 201) as {
    id: string;
    status: string;
  };
  if (body.status !== "awaiting_payment") {
    throw new Error(`Expected status=awaiting_payment, got ${body.status}`);
  }
  pass("Place order", `orderId=${body.id}`);
  return body.id;
}

async function verifyCheckoutGuards(
  token: string,
  pharmacyId: string,
  inventoryId: string,
  expectedTotalMinor: number,
): Promise<void> {
  const stalePrice = await api("POST", "/patient/orders", {
    token,
    body: {
      pharmacyId,
      fulfillmentType: "delivery",
      deliveryAddress: "12 Test Avenue, Freetown",
      expectedTotalMinor: expectedTotalMinor + 1,
      items: [{ inventoryId, quantity: TEST_ORDER_QUANTITY }],
    },
  });
  if (
    stalePrice.status !== 409 ||
    (stalePrice.body as { code?: string }).code !== "PRICE_CHANGED"
  ) {
    throw new Error(
      `Expected stale displayed price to be rejected with PRICE_CHANGED, got ${stalePrice.status}: ${JSON.stringify(stalePrice.body)}`,
    );
  }
  pass("Stale displayed price is rejected", "code=PRICE_CHANGED");

  await db
    .update(pharmaciesTable)
    .set({ isOnline: false, updatedAt: new Date() })
    .where(eq(pharmaciesTable.id, pharmacyId));
  try {
    const offline = await api("POST", "/patient/orders", {
      token,
      body: {
        pharmacyId,
        fulfillmentType: "delivery",
        deliveryAddress: "12 Test Avenue, Freetown",
        expectedTotalMinor,
        items: [{ inventoryId, quantity: TEST_ORDER_QUANTITY }],
      },
    });
    if (offline.status !== 409) {
      throw new Error(
        `Expected offline pharmacy to be rejected with 409, got ${offline.status}: ${JSON.stringify(offline.body)}`,
      );
    }
    pass("Offline pharmacy is rejected");
  } finally {
    await db
      .update(pharmaciesTable)
      .set({ isOnline: true, updatedAt: new Date() })
      .where(eq(pharmaciesTable.id, pharmacyId));
  }
}

// ─── step 9: pay for order ────────────────────────────────────────────────────
async function getStock(inventoryId: string): Promise<number> {
  const [row] = await db
    .select({ stockQuantity: pharmacyInventoryTable.stockQuantity })
    .from(pharmacyInventoryTable)
    .where(eq(pharmacyInventoryTable.id, inventoryId));
  if (!row) throw new Error(`Inventory ${inventoryId} not found`);
  return row.stockQuantity;
}

async function payOrderConcurrently(
  token: string,
  orderId: string,
  inventoryId: string,
): Promise<void> {
  const before = await getStock(inventoryId);
  if (before !== 3) {
    throw new Error(
      `Expected stock to remain 3 after unpaid order creation, got ${before}`,
    );
  }
  pass("Unpaid order does not reserve stock", `stock=${before}`);

  const responses = await Promise.all([
    api("POST", `/patient/orders/${orderId}/pay`, { token, body: {} }),
    api("POST", `/patient/orders/${orderId}/pay`, { token, body: {} }),
  ]);
  const successes = responses.filter((response) => response.status === 200);
  const conflicts = responses.filter((response) => response.status === 409);
  if (successes.length !== 1 || conflicts.length !== 1) {
    throw new Error(
      `Expected one payment success and one conflict, got ${responses.map((r) => r.status).join(", ")}`,
    );
  }
  const body = successes[0]!.body as { id: string; status: string };
  if (body.status !== "paid") {
    throw new Error(`Expected status=paid, got ${body.status}`);
  }
  const after = await getStock(inventoryId);
  if (after !== 1) {
    throw new Error(
      `Expected one exact stock deduction to leave 1, got ${after}`,
    );
  }
  pass("Concurrent payment deducts inventory exactly once", `stock=${after}`);
}

async function verifyPaymentStockConflict(
  token: string,
  pharmacyId: string,
  inventoryId: string,
): Promise<void> {
  const conflictOrderId = await placeOrder(
    token,
    pharmacyId,
    inventoryId,
    undefined,
    1,
    expectedOrderTotals(TEST_PRICE_LEONES, 1).totalMinor,
  );
  await db
    .update(pharmacyInventoryTable)
    .set({ stockQuantity: 0, updatedAt: new Date() })
    .where(eq(pharmacyInventoryTable.id, inventoryId));

  const response = await api("POST", `/patient/orders/${conflictOrderId}/pay`, {
    token,
    body: {},
  });
  expect("Pay order after stock changed", response, 409);
  const [order] = await db
    .select({ status: ordersTable.status })
    .from(ordersTable)
    .where(eq(ordersTable.id, conflictOrderId));
  if (order?.status !== "awaiting_payment") {
    throw new Error(
      `Stock-conflicted payment changed order status to ${order?.status}`,
    );
  }
  if ((await getStock(inventoryId)) !== 0) {
    throw new Error("Stock-conflicted payment changed inventory");
  }
  pass("Stock conflict rolls payment back without deducting or marking paid");
}

async function fulfillThroughDelivery(
  pharmacyToken: string,
  hqToken: string,
  patientToken: string,
  orderId: string,
): Promise<{ courierId: string; completedOrder: Record<string, any> }> {
  const confirm = await api("PATCH", `/pharmacy/orders/${orderId}/status`, {
    token: pharmacyToken,
    body: { status: "confirmed" },
  });
  expect("Pharmacy confirms paid order", confirm, 200);
  if ((confirm.body as { status?: string }).status !== "confirmed") {
    throw new Error("Pharmacy confirmation did not return status=confirmed");
  }
  pass("Pharmacy confirms paid order");

  const ready = await api("PATCH", `/pharmacy/orders/${orderId}/status`, {
    token: pharmacyToken,
    body: { status: "ready" },
  });
  expect("Pharmacy marks order ready", ready, 200);
  if ((ready.body as { status?: string }).status !== "ready") {
    throw new Error("Pharmacy ready transition did not return status=ready");
  }
  pass("Pharmacy marks order ready");

  const courierRes = await api("POST", "/hq/couriers", {
    token: hqToken,
    body: {
      name: `Test Courier ${RUN_ID}`,
      phone: `+2328${RUN_DIGITS}`,
      vehicleType: "motorbike",
    },
  });
  const courierBody = expect("Create test courier", courierRes, 201) as {
    id: string;
  };
  pass("HQ creates delivery courier", `id=${courierBody.id}`);

  const assigned = await api("POST", `/hq/orders/${orderId}/assign-courier`, {
    token: hqToken,
    body: { courierId: courierBody.id },
  });
  expect("HQ assigns courier", assigned, 200);
  if ((assigned.body as { status?: string }).status !== "assigned") {
    throw new Error("Courier assignment did not return status=assigned");
  }
  pass("HQ assigns courier");

  const pickedUp = await api("POST", `/pharmacy/orders/${orderId}/picked-up`, {
    token: pharmacyToken,
    body: {},
  });
  expect("Pharmacy records courier handoff", pickedUp, 200);
  if ((pickedUp.body as { status?: string }).status !== "picked_up") {
    throw new Error("Courier handoff did not return status=picked_up");
  }
  pass("Pharmacy records courier handoff");

  const delivering = await api(
    "PATCH",
    `/hq/orders/${orderId}/courier-status`,
    {
      token: hqToken,
      body: { status: "delivering" },
    },
  );
  expect("HQ advances order to delivering", delivering, 200);
  if ((delivering.body as { status?: string }).status !== "delivering") {
    throw new Error("HQ delivery transition did not return status=delivering");
  }
  pass("HQ advances order to delivering");

  const delivered = await api(
    "POST",
    `/patient/orders/${orderId}/confirm-receipt`,
    {
      token: patientToken,
      body: {},
    },
  );
  const completedOrder = expect(
    "Patient confirms receipt",
    delivered,
    200,
  ) as Record<string, any>;
  if (
    completedOrder.status !== "delivered" ||
    completedOrder.deliveryConfirmationMethod !== "patient"
  ) {
    throw new Error(
      `Expected patient-confirmed delivered order, got ${JSON.stringify({
        status: completedOrder.status,
        deliveryConfirmationMethod:
          completedOrder.deliveryConfirmationMethod,
      })}`,
    );
  }
  pass("Patient confirms delivered order");

  return { courierId: courierBody.id, completedOrder };
}

async function verifyFinancialReconciliation(
  hqToken: string,
  pharmacyId: string,
  courierId: string,
  completedOrder: Record<string, any>,
  expected: ReturnType<typeof expectedOrderTotals>,
): Promise<void> {
  const completedAt = new Date(completedOrder.completedAt);
  if (isNaN(completedAt.getTime())) {
    throw new Error("Delivered order did not include a valid completedAt");
  }
  const periodStart = completedAt.toISOString();
  const periodEnd = new Date(completedAt.getTime() + 1).toISOString();

  const generated = await api("POST", "/hq/settlements/generate", {
    token: hqToken,
    body: { periodStart, periodEnd },
  });
  expect("Generate completed-order settlements", generated, 201);
  pass("Generate completed-order settlements");

  const reportRes = await api(
    "GET",
    `/hq/settlements?start=${encodeURIComponent(periodStart)}&end=${encodeURIComponent(periodEnd)}`,
    { token: hqToken },
  );
  const report = expect(
    "Read completed-order financial report",
    reportRes,
    200,
  ) as {
    pharmacy: Array<{
      pharmacyId: string;
      amountMinor: number;
      orderCount: number;
      periodStart: string;
      periodEnd: string;
    }>;
    courier: Array<{
      courierId: string;
      amountMinor: number;
      deliveryCount: number;
      periodStart: string;
      periodEnd: string;
    }>;
    metrics: {
      patientPaidLeones: number;
      medicineCommissionMinor: number;
      commissionIncomeMinor: number;
      owedPharmacyMinor: number;
      owedCourierMinor: number;
      completedOrders: number;
      completedDeliveries: number;
    };
    pharmacyBreakdown: Array<{
      pharmacyId: string;
      orderCount: number;
      pharmacyEarningsMinor: number;
      medicineCommissionMinor: number;
    }>;
  };

  const orderTotalMinor = Math.round(Number(completedOrder.totalLeones) * 100);
  const pharmacyEarningsMinor = completedOrder.pharmacyMedicineTotalMinor;
  const serviceFeeMinor = completedOrder.medicineCommissionMinor;
  if (
    orderTotalMinor !== expected.totalMinor ||
    pharmacyEarningsMinor !== expected.drugTotalMinor ||
    serviceFeeMinor !== expected.serviceFeeMinor ||
    completedOrder.deliveryCommissionMinor !== 0 ||
    orderTotalMinor !== pharmacyEarningsMinor + serviceFeeMinor
  ) {
    throw new Error(
      `Order financial snapshot does not reconcile: ${JSON.stringify({
        orderTotalMinor,
        pharmacyEarningsMinor,
        serviceFeeMinor,
        deliveryCommissionMinor: completedOrder.deliveryCommissionMinor,
        expected,
      })}`,
    );
  }
  pass(
    "Order financial snapshot reconciles",
    `${pharmacyEarningsMinor} + ${serviceFeeMinor} = ${orderTotalMinor} minor units`,
  );

  const metrics = report.metrics;
  if (
    metrics.completedOrders !== 1 ||
    metrics.completedDeliveries !== 1 ||
    Math.round(metrics.patientPaidLeones * 100) !== orderTotalMinor ||
    metrics.owedPharmacyMinor !== pharmacyEarningsMinor ||
    metrics.medicineCommissionMinor !== serviceFeeMinor ||
    metrics.commissionIncomeMinor !== serviceFeeMinor
  ) {
    throw new Error(
      `Financial report does not reconcile to the completed order: ${JSON.stringify({
        metrics,
        expected: {
          orderTotalMinor,
          pharmacyEarningsMinor,
          serviceFeeMinor,
        },
      })}`,
    );
  }
  pass(
    "Patient-paid revenue, pharmacy earnings, and service-fee income reconcile",
    `patient=${orderTotalMinor}, pharmacy=${pharmacyEarningsMinor}, fee=${serviceFeeMinor}`,
  );

  const pharmacySettlement = report.pharmacy.find(
    (row) =>
      row.pharmacyId === pharmacyId &&
      row.amountMinor === pharmacyEarningsMinor &&
      new Date(row.periodStart).toISOString() === periodStart &&
      new Date(row.periodEnd).toISOString() === periodEnd,
  );
  if (!pharmacySettlement || pharmacySettlement.orderCount !== 1) {
    throw new Error(
      `Missing exact pharmacy settlement: ${JSON.stringify(report.pharmacy)}`,
    );
  }
  const courierSettlement = report.courier.find(
    (row) =>
      row.courierId === courierId &&
      new Date(row.periodStart).toISOString() === periodStart &&
      new Date(row.periodEnd).toISOString() === periodEnd,
  );
  if (!courierSettlement || courierSettlement.deliveryCount !== 1) {
    throw new Error(
      `Missing exact courier settlement: ${JSON.stringify(report.courier)}`,
    );
  }
  const breakdown = report.pharmacyBreakdown.find(
    (row) => row.pharmacyId === pharmacyId,
  );
  if (
    !breakdown ||
    breakdown.orderCount !== 1 ||
    breakdown.pharmacyEarningsMinor !== pharmacyEarningsMinor ||
    breakdown.medicineCommissionMinor !== serviceFeeMinor
  ) {
    throw new Error(
      `Missing exact pharmacy earnings breakdown: ${JSON.stringify(
        report.pharmacyBreakdown,
      )}`,
    );
  }
  pass("Pharmacy and courier settlements match completed-order snapshots");
}

// ─── step 10: verify order in list ───────────────────────────────────────────
async function verifyOrderInList(
  token: string,
  orderId: string,
): Promise<void> {
  const res = await api("GET", "/patient/orders", { token });
  const orders = expect("List patient orders", res, 200) as Array<{
    id: string;
    status: string;
  }>;
  const found = orders.find((o) => o.id === orderId);
  if (!found) {
    throw new Error(
      `Order ${orderId} not found in list (${orders.length} orders returned)`,
    );
  }
  if (found.status !== "paid") {
    throw new Error(`Order found but status=${found.status}, expected paid`);
  }
  pass("Order appears in list with status=paid");

  // Also fetch individual order
  const detailRes = await api("GET", `/patient/orders/${orderId}`, { token });
  const detail = expect("Fetch single order by ID", detailRes, 200) as {
    id: string;
    status: string;
    prescription: unknown;
    items: unknown[];
    pharmacy: { name: string };
  };
  if (detail.id !== orderId) throw new Error("Returned wrong order");
  pass("Fetch single order by ID", `pharmacy=${detail.pharmacy?.name}`);
}

// ─── step 11: token refresh edge-case ────────────────────────────────────────
async function testTokenRefresh(
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  // 11a: Refresh token produces new pair
  const refreshRes = await api("POST", "/auth/refresh", {
    body: { refreshToken },
  });
  const refreshBody = expect("Refresh tokens", refreshRes, 200) as {
    accessToken: string;
    refreshToken: string;
  };
  if (!refreshBody.accessToken || !refreshBody.refreshToken) {
    throw new Error("Refresh response missing tokens");
  }
  // JWTs signed in the same second share the same iat → identical bytes; that's
  // expected JWT behaviour (not a rotation bug). The important property is that
  // the *refresh* token is a new opaque value.
  if (refreshBody.refreshToken === refreshToken) {
    throw new Error(
      "New refresh token is identical to old one — rotation is broken",
    );
  }
  pass("Token refresh returns new token pair (refresh token rotated)");

  // 11b: New access token works for authenticated endpoint
  const ordersRes = await api("GET", "/patient/orders", {
    token: refreshBody.accessToken,
  });
  expect("New access token is accepted by API", ordersRes, 200);
  pass("New access token is accepted by API");

  // 11c: Old refresh token must be revoked immediately after rotation
  const reuseRes = await api("POST", "/auth/refresh", {
    body: { refreshToken },
  });
  if (reuseRes.status !== 401) {
    throw new Error(
      `Old refresh token after rotation returned HTTP ${reuseRes.status} (expected 401). ` +
        "Token rotation is not enforced — this is a security vulnerability.",
    );
  }
  pass("Old refresh token is revoked after rotation");

  // 11d: Logout invalidates the new refresh token
  const logoutRes = await api("POST", "/auth/logout", {
    body: { refreshToken: refreshBody.refreshToken },
  });
  expect("Logout invalidates session", logoutRes, 200);
  pass("Logout invalidates session");

  // 11e: Revoked token is now rejected
  const afterLogoutRes = await api("POST", "/auth/refresh", {
    body: { refreshToken: refreshBody.refreshToken },
  });
  if (afterLogoutRes.status !== 401) {
    throw new Error(
      `Expected 401 after logout, got ${afterLogoutRes.status}: ${JSON.stringify(afterLogoutRes.body)}`,
    );
  }
  pass("Revoked refresh token rejected after logout");
}

// ─── step 12: cleanup — deactivate test pharmacy and ephemeral HQ account ───
async function cleanup(
  hqToken: string,
  pharmacyId: string | null,
  hqId: string,
  courierId: string | null = null,
): Promise<void> {
  if (courierId) {
    const res = await api("DELETE", `/hq/couriers/${courierId}`, {
      token: hqToken,
    });
    if (res.status !== 200) {
      console.warn(
        `  ⚠️  WARN  Could not retire test courier (${res.status})`,
      );
    } else {
      log("Retired test courier", courierId);
    }
  }

  // Deactivate test pharmacy
  if (pharmacyId) {
    const res = await api("PATCH", `/hq/pharmacies/${pharmacyId}`, {
      token: hqToken,
      body: { isActive: false },
    });
    if (res.status !== 200) {
      console.warn(
        `  ⚠️  WARN  Could not deactivate test pharmacy (${res.status})`,
      );
    } else {
      log("Deactivated test pharmacy", pharmacyId);
    }
  }

  // Deactivate the ephemeral HQ account so it cannot be used after this run
  try {
    await db
      .update(hqStaffTable)
      .set({ isActive: false })
      .where(eq(hqStaffTable.id, hqId));
    log("Deactivated ephemeral HQ account", HQ_USERNAME);
  } catch (e) {
    console.warn(`  ⚠️  WARN  Could not deactivate ephemeral HQ account: ${e}`);
  }
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(
    "\n═══════════════════════════════════════════════════════════════",
  );
  console.log("  MobiCare — Patient Order Flow Integration Test");
  console.log(`  API base : ${BASE_URL}`);
  console.log(`  Run ID   : ${RUN_ID}`);
  console.log(
    "═══════════════════════════════════════════════════════════════\n",
  );

  // ------ Setup ------
  console.log(
    "── Setup ──────────────────────────────────────────────────────",
  );
  try {
    await checkHealth();
  } catch {
    process.exit(1);
  }

  let hqToken: string;
  let hqId: string;
  try {
    ({ hqToken, hqId } = await bootstrapHQ());
  } catch (e) {
    fail("HQ bootstrap/login", e);
    process.exit(1);
  }

  let pharmacyId: string | null = null;
  let pharmacyToken: string;
  try {
    ({ pharmacyId, pharmacyToken } = await createTestPharmacy(hqToken));
  } catch (e) {
    fail("Create test pharmacy", e);
    await cleanup(hqToken, null, hqId);
    process.exit(1);
  }

  let drugId: string;
  try {
    drugId = await createTestDrug(hqToken);
  } catch (e) {
    fail("Create test drug", e);
    await cleanup(hqToken, pharmacyId, hqId);
    process.exit(1);
  }

  try {
    await addInventory(pharmacyToken, drugId);
  } catch (e) {
    fail("Add inventory", e);
    await cleanup(hqToken, pharmacyId, hqId);
    process.exit(1);
  }

  // ------ Patient flow ------
  console.log(
    "\n── Patient Flow ────────────────────────────────────────────────",
  );

  let accessToken: string;
  let refreshToken: string;

  try {
    ({ accessToken, refreshToken } = await registerPatient());
  } catch (e) {
    fail("Register patient", e);
    await cleanup(hqToken, pharmacyId, hqId);
    process.exit(1);
  }

  const token = accessToken; // alias (token stays valid for the order flow steps)

  // Search
  let searchResult: Awaited<ReturnType<typeof searchDrug>>;
  try {
    searchResult = await searchDrug(token, DRUG_NAME);
  } catch (e) {
    fail("Search for drug", e);
    await cleanup(hqToken, pharmacyId, hqId);
    process.exit(1);
  }

  // Upload prescription (tier-3 drug doesn't require one, but we test the upload path anyway)
  let prescriptionKey: string;
  try {
    prescriptionKey = await uploadPrescription(token);
  } catch (e) {
    fail("Upload prescription", e);
    await cleanup(hqToken, pharmacyId, hqId);
    process.exit(1);
  }

  // Place order
  let orderId: string;
  const checkoutTotals = expectedOrderTotals(
    searchResult.priceLeones,
    TEST_ORDER_QUANTITY,
  );
  try {
    if (searchResult.priceLeones !== TEST_PRICE_LEONES) {
      throw new Error(
        `Expected approved listing price ${TEST_PRICE_LEONES}, got ${searchResult.priceLeones}`,
      );
    }
    pass(
      "Approved listing price and 5% service fee verified",
      `drug=${checkoutTotals.drugTotalMinor}, fee=${checkoutTotals.serviceFeeMinor}`,
    );
    await verifyCheckoutGuards(
      token,
      searchResult.pharmacyId,
      searchResult.inventoryId,
      checkoutTotals.totalMinor,
    );
    orderId = await placeOrder(
      token,
      searchResult.pharmacyId,
      searchResult.inventoryId,
      prescriptionKey,
      TEST_ORDER_QUANTITY,
      checkoutTotals.totalMinor,
    );
  } catch (e) {
    fail("Place order", e);
    await cleanup(hqToken, pharmacyId, hqId);
    process.exit(1);
  }

  // Pay
  try {
    await payOrderConcurrently(token, orderId, searchResult.inventoryId);
    await verifyPaymentStockConflict(
      token,
      searchResult.pharmacyId,
      searchResult.inventoryId,
    );
  } catch (e) {
    fail("Pay order", e);
  }

  // Verify in list
  try {
    await verifyOrderInList(token, orderId);
  } catch (e) {
    fail("Verify order in list", e);
  }

  // ------ Pharmacy / HQ Delivery Flow ------
  console.log(
    "\n── Pharmacy / HQ Delivery Flow ────────────────────────────────",
  );
  let courierId: string | null = null;
  try {
    const delivery = await fulfillThroughDelivery(
      pharmacyToken,
      hqToken,
      token,
      orderId,
    );
    courierId = delivery.courierId;
    await verifyFinancialReconciliation(
      hqToken,
      searchResult.pharmacyId,
      courierId,
      delivery.completedOrder,
      checkoutTotals,
    );
  } catch (e) {
    fail("Pharmacy / HQ delivery and financial reconciliation", e);
  }

  // ------ Auth refresh ------
  console.log(
    "\n── Auth / Token Refresh ────────────────────────────────────────",
  );
  try {
    await testTokenRefresh(accessToken, refreshToken);
  } catch (e) {
    fail("Token refresh flow", e);
  }

  // ------ Cleanup ------
  console.log(
    "\n── Cleanup ─────────────────────────────────────────────────────",
  );
  await cleanup(hqToken, pharmacyId, hqId, courierId);

  // ------ Summary ------
  const total = passed + failed;
  console.log(
    "\n═══════════════════════════════════════════════════════════════",
  );
  console.log(`  Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.log(`  ❌ ${failed} test(s) FAILED`);
    console.log(
      "═══════════════════════════════════════════════════════════════\n",
    );
    process.exit(1);
  } else {
    console.log("  🎉 All tests passed!");
    console.log(
      "═══════════════════════════════════════════════════════════════\n",
    );
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
