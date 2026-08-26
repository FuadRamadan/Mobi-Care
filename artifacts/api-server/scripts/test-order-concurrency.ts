/**
 * Integration test: concurrent pharmacy order transitions
 *
 * Covers the conditional-update guard in the pharmacy order API:
 *   - two simultaneous paid → confirmed requests
 *   - two simultaneous ready → collected confirmations
 *
 * The test uses uniquely generated database records and the real HTTP API.
 * It leaves the pharmacy inactive after the run, matching the disposable
 * account pattern used by the other API integration scripts.
 *
 * Usage:
 *   # API server must be running (pnpm --filter @workspace/api-server run dev)
 *   pnpm --filter @workspace/api-server run test-order-concurrency
 *
 * Optional env overrides:
 *   TEST_API_BASE_URL   default: http://localhost:$PORT (or :4000)
 */

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  auditLogTable,
  flagsTable,
  ordersTable,
  pharmaciesTable,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";

const PORT = process.env["PORT"] ?? "4000";
const BASE_URL =
  (process.env["TEST_API_BASE_URL"] ?? `http://localhost:${PORT}`).replace(/\/$/, "") + "/api";

const RUN_ID = Date.now().toString(36).toUpperCase();
const PHARMACY_USERNAME = `concph${crypto.randomBytes(8).toString("hex")}`;
const PHARMACY_PASSWORD = `Concurrency_${crypto.randomBytes(12).toString("base64url")}`;
const PHARMACY_NAME = `Concurrency Test Pharmacy ${RUN_ID}`;
const TEST_PHONE = `+232${String(Date.now()).slice(-8)}`;

let passed = 0;
let failed = 0;

function pass(name: string, detail?: string) {
  passed++;
  console.log(`  ✅ PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name: string, reason: unknown) {
  failed++;
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(`  ❌ FAIL  ${name} — ${message}`);
}

async function api(
  method: string,
  path: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = await response.text().catch(() => "(no body)");
  }
  return { status: response.status, body };
}

function expectStatus(
  name: string,
  response: { status: number; body: unknown },
  expectedStatus: number,
): void {
  if (response.status !== expectedStatus) {
    throw new Error(
      `${name}: expected HTTP ${expectedStatus}, got ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
}

function assertExactlyOne<T>(name: string, rows: T[]): T {
  if (rows.length !== 1) {
    throw new Error(`${name}: expected exactly one row, got ${rows.length}`);
  }
  return rows[0]!;
}

async function checkHealth(): Promise<void> {
  const response = await fetch(`${BASE_URL}/healthz`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`health check returned HTTP ${response.status}`);
  }
  pass("Health check");
}

async function createPharmacy(): Promise<{ id: string; token: string }> {
  const passwordHash = await bcrypt.hash(PHARMACY_PASSWORD, 10);
  const [pharmacy] = await db
    .insert(pharmaciesTable)
    .values({
      name: PHARMACY_NAME,
      username: PHARMACY_USERNAME,
      phone: TEST_PHONE,
      address: "Concurrency test address",
      passwordHash,
    })
    .returning({ id: pharmaciesTable.id });

  if (!pharmacy) {
    throw new Error("pharmacy insert returned no row");
  }

  const login = await api("POST", "/auth/login", {
    body: { identifier: PHARMACY_USERNAME, password: PHARMACY_PASSWORD },
  });
  expectStatus("pharmacy login", login, 200);

  const body = login.body as { accessToken?: unknown };
  if (typeof body.accessToken !== "string" || body.accessToken.length === 0) {
    throw new Error("pharmacy login did not return an access token");
  }

  pass("Pharmacy login");
  return { id: pharmacy.id, token: body.accessToken };
}

async function createOrder(
  pharmacyId: string,
  status: "paid" | "ready",
  fulfillmentType: "delivery" | "collection",
  totalLeones: number,
): Promise<string> {
  const [order] = await db
    .insert(ordersTable)
    .values({
      pharmacyId,
      patientName: `Concurrency Test Patient ${RUN_ID}`,
      patientPhone: `+2328${String(Date.now()).slice(-7)}`,
      fulfillmentType,
      status,
      totalLeones,
      deliveryAddress: fulfillmentType === "delivery" ? "Concurrency test address" : null,
    })
    .returning({ id: ordersTable.id });

  if (!order) {
    throw new Error(`could not create ${status} test order`);
  }
  return order.id;
}

async function assertConcurrentStatusTransition(
  token: string,
  pharmacyId: string,
  orderId: string,
): Promise<void> {
  const responses = await Promise.all([
    api("PATCH", `/pharmacy/orders/${orderId}/status`, {
      token,
      body: { status: "confirmed" },
    }),
    api("PATCH", `/pharmacy/orders/${orderId}/status`, {
      token,
      body: { status: "confirmed" },
    }),
  ]);

  const successful = responses.filter((response) => response.status === 200);
  const conflicts = responses.filter((response) => response.status === 409);
  if (successful.length !== 1 || conflicts.length !== 1) {
    throw new Error(
      `expected one 200 and one 409, got ${responses.map((response) => response.status).join(", ")}`,
    );
  }
  pass("Concurrent paid → confirmed requests resolve one winner and one conflict");

  const [order] = await db
    .select({ status: ordersTable.status })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.pharmacyId, pharmacyId)));
  if (order?.status !== "confirmed") {
    throw new Error(`expected final order status confirmed, got ${order?.status ?? "missing"}`);
  }
  pass("Status transition is applied exactly once", "final status=confirmed");

  const audits = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.entityType, "order"),
        eq(auditLogTable.entityId, orderId),
        eq(auditLogTable.action, "order.status_update"),
      ),
    );
  assertExactlyOne("status transition audit entries", audits);
  pass("Exactly one status-transition audit entry is written");

  // The deliberately large total makes checkOrderFlags produce a durable,
  // order-scoped result that proves only the winning request reached it.
  const flags = await db
    .select({ id: flagsTable.id })
    .from(flagsTable)
    .where(
      and(
        eq(flagsTable.orderId, orderId),
        eq(flagsTable.type, "payment_anomaly"),
      ),
    );
  assertExactlyOne("status transition payment-anomaly flags", flags);
  pass("Exactly one downstream order-flag result is written");
}

async function assertConcurrentCollection(
  token: string,
  pharmacyId: string,
  orderId: string,
): Promise<void> {
  const responses = await Promise.all([
    api("POST", `/pharmacy/orders/${orderId}/collected`, {
      token,
      body: { idChecked: true },
    }),
    api("POST", `/pharmacy/orders/${orderId}/collected`, {
      token,
      body: { idChecked: true },
    }),
  ]);

  const successful = responses.filter((response) => response.status === 200);
  const conflicts = responses.filter((response) => response.status === 409);
  if (successful.length !== 1 || conflicts.length !== 1) {
    throw new Error(
      `collection confirmation expected one 200 and one 409, got ${responses
        .map((response) => response.status)
        .join(", ")}`,
    );
  }
  pass("Concurrent ready → collected requests resolve one winner and one conflict");

  const [order] = await db
    .select({ status: ordersTable.status, idChecked: ordersTable.idChecked })
    .from(ordersTable)
    .where(and(eq(ordersTable.id, orderId), eq(ordersTable.pharmacyId, pharmacyId)));
  if (order?.status !== "collected" || order.idChecked !== true) {
    throw new Error(
      `expected final collection state collected/idChecked=true, got ${JSON.stringify(order)}`,
    );
  }
  pass("Collection transition is applied exactly once", "final status=collected");

  const audits = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.entityType, "order"),
        eq(auditLogTable.entityId, orderId),
        eq(auditLogTable.action, "order.collected"),
      ),
    );
  assertExactlyOne("collection audit entries", audits);
  pass("Exactly one collection audit entry is written");
}

async function deactivatePharmacy(pharmacyId: string): Promise<void> {
  await db
    .update(pharmaciesTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(pharmaciesTable.id, pharmacyId));
  console.log(`  Deactivated ephemeral pharmacy ${PHARMACY_USERNAME}`);
}

async function main() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  MobiCare — Pharmacy Order Concurrency Integration Test");
  console.log(`  API base : ${BASE_URL}`);
  console.log(`  Run ID   : ${RUN_ID}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  let pharmacyId: string | null = null;
  try {
    await checkHealth();
    const pharmacy = await createPharmacy();
    pharmacyId = pharmacy.id;

    const statusOrderId = await createOrder(
      pharmacy.id,
      "paid",
      "delivery",
      10_000_000,
    );
    await assertConcurrentStatusTransition(pharmacy.token, pharmacy.id, statusOrderId);

    const collectionOrderId = await createOrder(
      pharmacy.id,
      "ready",
      "collection",
      5_000,
    );
    await assertConcurrentCollection(pharmacy.token, pharmacy.id, collectionOrderId);
  } catch (error) {
    fail("Concurrent pharmacy order regression", error);
  } finally {
    if (pharmacyId) {
      try {
        await deactivatePharmacy(pharmacyId);
      } catch (error) {
        fail("Deactivate ephemeral pharmacy", error);
      }
    }
  }

  const total = passed + failed;
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`  Results: ${passed}/${total} passed`);
  if (failed > 0) {
    console.log(`  ❌ ${failed} test(s) FAILED`);
    console.log("═══════════════════════════════════════════════════════════════\n");
    process.exit(1);
  }
  console.log("  🎉 All concurrency tests passed!");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});