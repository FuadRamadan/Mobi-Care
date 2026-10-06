import assert from "node:assert/strict";
import { test } from "node:test";
import { loadMonimeConfig, tokenMode } from "./config.js";
import { checkoutKey, idempotencyKey } from "./keys.js";
import {
  buildCheckoutSessionBody,
  buildLineItems,
  CheckoutTotalMismatch,
  MAX_ITEMISED_MEDICINES,
  type CheckoutOrder,
} from "./checkout.js";
import { createMonimeClient, MonimeError } from "./client.js";
import { priceOrder } from "../financialAllocation.js";

const baseEnv = {
  PAYMENTS_PROVIDER: "monime",
  MONIME_MODE: "test",
  MONIME_ACCESS_TOKEN: "mon_test_abc123",
  MONIME_SPACE_ID: "spc-abc123",
  PUBLIC_APP_URL: "https://mobicaresl.com",
  MONIME_HOLDING_ACCOUNT_ID: "fac-holding",
};

// ── Settings ─────────────────────────────────────────────────────────────

test("Monime stays off unless PAYMENTS_PROVIDER=monime", () => {
  assert.equal(loadMonimeConfig({}), null);
  assert.equal(loadMonimeConfig({ ...baseEnv, PAYMENTS_PROVIDER: "direct" }), null);
});

test("the token must match the mode, both ways", () => {
  assert.equal(tokenMode("mon_test_x"), "test");
  assert.equal(tokenMode("mon_x"), "live");
  assert.equal(tokenMode("sk_x"), null);
  assert.throws(
    () => loadMonimeConfig({ ...baseEnv, MONIME_MODE: "live" }),
    /test token but MONIME_MODE is live/,
  );
  assert.throws(
    () => loadMonimeConfig({ ...baseEnv, MONIME_ACCESS_TOKEN: "mon_live1" }),
    /live token but MONIME_MODE is test/,
  );
});

test("production needs a webhook header token, https and the real Monime address", () => {
  const production = { ...baseEnv, NODE_ENV: "production" };
  assert.throws(() => loadMonimeConfig(production), /MONIME_WEBHOOK_HEADER_TOKEN is required/);
  assert.throws(
    () => loadMonimeConfig({ ...production, MONIME_WEBHOOK_HEADER_TOKEN: "x".repeat(40), MONIME_BASE_URL: "http://localhost:9100" }),
    /MONIME_BASE_URL can only be changed outside production/,
  );
  assert.throws(
    () => loadMonimeConfig({ ...production, MONIME_WEBHOOK_HEADER_TOKEN: "x".repeat(40), PUBLIC_APP_URL: "http://mobicaresl.com" }),
    /must use https in production/,
  );
  const ok = loadMonimeConfig({ ...production, MONIME_WEBHOOK_HEADER_TOKEN: "x".repeat(40) });
  assert.equal(ok?.baseUrl, "https://api.monime.io");
});

test("a fake Monime address is allowed outside production", () => {
  const config = loadMonimeConfig({ ...baseEnv, MONIME_BASE_URL: "http://127.0.0.1:9100/" });
  assert.equal(config?.baseUrl, "http://127.0.0.1:9100");
  assert.equal(config?.apiVersion, "caph.2025-08-23");
});

test("the Holding account is required", () => {
  assert.throws(
    () => loadMonimeConfig({ ...baseEnv, MONIME_HOLDING_ACCOUNT_ID: "" }),
    /MONIME_HOLDING_ACCOUNT_ID is missing/,
  );
});

// ── Idempotency keys ──────────────────────────────────────────────────────

test("keys are fixed per movement, 36 characters, and differ between movements", () => {
  const a = checkoutKey("11111111-1111-1111-1111-111111111111", 1);
  assert.equal(a, checkoutKey("11111111-1111-1111-1111-111111111111", 1));
  assert.notEqual(a, checkoutKey("11111111-1111-1111-1111-111111111111", 2));
  assert.equal(a.length, 36);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(idempotencyKey("refund:1"), idempotencyKey("cashout:1"));
});

// ── Pricing ───────────────────────────────────────────────────────────────

test("pilot pricing: the patient pays the pharmacy's price, the pharmacy gives up 5%", () => {
  const p = priceOrder(100_000, "split_v1"); // Le 1,000
  assert.equal(p.serviceFeeBasisPoints, 0);
  assert.equal(p.patientServiceFeeMinor, 0);
  assert.equal(p.patientMedicineTotalMinor, 100_000);
  assert.equal(p.pharmacyCommissionMinor, 5_000);
  assert.equal(p.medicineCommissionMinor, 5_000);
  assert.equal(p.pharmacyPayoutMinor, 95_000);
  assert.equal(p.pharmacyPayoutMinor + p.medicineCommissionMinor, p.patientMedicineTotalMinor);
});

test("today's model is unchanged: 5% on the patient, nothing from the pharmacy", () => {
  const p = priceOrder(303, "patient_fee_v1");
  assert.equal(p.patientServiceFeeMinor, 15);
  assert.equal(p.pharmacyCommissionMinor, 0);
  assert.equal(p.patientMedicineTotalMinor, 318);
  assert.equal(p.serviceFeeBasisPoints, 500);
});

test("split rounding stays exact on awkward amounts", () => {
  for (const amount of [1, 25, 49, 50, 333, 12_345, 999_999]) {
    const p = priceOrder(amount, "split_v1");
    assert.equal(p.pharmacyPayoutMinor + p.patientServiceFeeMinor + p.pharmacyCommissionMinor, p.patientMedicineTotalMinor);
    assert.ok(Number.isInteger(p.patientServiceFeeMinor) && Number.isInteger(p.pharmacyCommissionMinor));
  }
});

// ── Payment link lines ────────────────────────────────────────────────────

const order = (count: number, feeBasisPoints = 200): CheckoutOrder => {
  const items = Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    drugName: `Medicine ${i}`,
    brand: i % 2 ? "Emzor" : null,
    unitPriceMinor: 1_000 + i,
    quantity: 2,
  }));
  const medicines = items.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0);
  // A fee is passed in so the fee line is still tested for after the pilot.
  const fee = Math.round((medicines * feeBasisPoints) / 10_000);
  return {
    id: "6f1c2a4e-0000-4000-8000-000000000001",
    pharmacyId: "ph-1",
    pharmacyName: "City Pharmacy, Lumley",
    totalMinor: medicines + fee + 3_500,
    patientServiceFeeMinor: fee,
    serviceFeeBasisPoints: feeBasisPoints,
    deliveryFeeMinor: 3_500,
    deliveryZoneName: "Central Freetown",
    items,
  };
};
const config = { mode: "test" as const, holdingAccountId: "fac-holding", publicAppUrl: "https://mobicaresl.com" };

test("up to 14 medicines are listed one by one, plus fee and delivery", () => {
  const lines = buildLineItems(order(MAX_ITEMISED_MEDICINES));
  assert.equal(lines.length, 16);
  assert.equal(lines[1]!.name, "Medicine 1 (Emzor)");
  assert.equal(lines[14]!.name, "MobiCare service fee (2%)");
  assert.equal(lines[15]!.name, "Delivery (Central Freetown)");
});

test("with no service fee (the pilot) there is no fee line", () => {
  const lines = buildLineItems(order(3, 0));
  assert.deepEqual(lines.map((l) => l.reference), ["item-0", "item-1", "item-2", "delivery"]);
});

test("15 or more medicines become one combined line (option b)", () => {
  const big = order(18);
  const lines = buildLineItems(big);
  assert.equal(lines.length, 3);
  assert.equal(lines[0]!.name, "Medicines from City Pharmacy, Lumley (18 items)");
  assert.equal(lines[0]!.quantity, 1);
  const total = lines.reduce((sum, l) => sum + l.price.value * l.quantity, 0);
  assert.equal(total, big.totalMinor);
});

test("the request carries our IDs only, the return addresses and the Holding account", () => {
  const body = buildCheckoutSessionBody(order(2), 3, config);
  assert.equal(body.reference, "6f1c2a4e-0000-4000-8000-000000000001");
  assert.equal(body.name, "MobiCare order 6F1C2A4E");
  assert.equal(body.financialAccountId, "fac-holding");
  assert.equal(body.successUrl, "https://mobicaresl.com/app/orders/6f1c2a4e-0000-4000-8000-000000000001?payment=return");
  assert.equal(body.cancelUrl, "https://mobicaresl.com/app/orders/6f1c2a4e-0000-4000-8000-000000000001?payment=cancelled");
  assert.deepEqual(body.metadata, {
    mc_order_id: "6f1c2a4e-0000-4000-8000-000000000001",
    mc_pharmacy_id: "ph-1",
    mc_attempt: "3",
    mc_env: "test",
  });
  for (const value of Object.values(body.metadata)) assert.ok(value.length <= 100);
});

test("a link whose lines don't add up to the order total is never built", () => {
  const wrong = { ...order(2), totalMinor: order(2).totalMinor + 1 };
  assert.throws(() => buildCheckoutSessionBody(wrong, 1, config), CheckoutTotalMismatch);
});

test("long medicine names are cut to Monime's 100 characters", () => {
  const long = order(1);
  long.items[0]!.drugName = "X".repeat(150);
  assert.equal(buildLineItems(long)[0]!.name.length, 100);
});

// ── HTTP client ───────────────────────────────────────────────────────────

const clientConfig = {
  mode: "test" as const,
  accessToken: "mon_test_secret",
  spaceId: "spc-1",
  apiVersion: "caph.2025-08-23",
  baseUrl: "http://monime.test",
  holdingAccountId: "fac-holding",
  webhookHeaderToken: null,
  publicAppUrl: "https://mobicaresl.com",
};

function fakeFetch(answers: Array<() => Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    return next();
  }) as typeof fetch;
  return { impl, calls };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

test("headers: token, Space, pinned version and the idempotency key", async () => {
  const { impl, calls } = fakeFetch([json(200, { success: true, result: { id: "cs-1", status: "pending" } }, { "monime-request-id": "req-1" })]);
  const client = createMonimeClient(clientConfig, { fetch: impl, sleep: async () => {} });
  const { result, requestId } = await client.createCheckoutSession({} as never, "key-123");
  assert.equal(result.id, "cs-1");
  assert.equal(requestId, "req-1");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer mon_test_secret");
  assert.equal(headers["Monime-Space-Id"], "spc-1");
  assert.equal(headers["Monime-Version"], "caph.2025-08-23");
  assert.equal(headers["Idempotency-Key"], "key-123");
});

test("5xx and 429 are retried with the identical body; Retry-After is respected", async () => {
  const waits: number[] = [];
  const { impl, calls } = fakeFetch([
    json(503, { success: false, error: { code: 503, reason: "unavailable" } }),
    json(429, { success: false, error: { code: 429, reason: "too_many_requests" } }, { "retry-after": "2" }),
    json(200, { success: true, result: { id: "cs-2", status: "pending" } }),
  ]);
  const client = createMonimeClient(clientConfig, { fetch: impl, sleep: async (ms) => { waits.push(ms); } });
  await client.createCheckoutSession({ name: "x" } as never, "key-1");
  assert.equal(calls.length, 3);
  assert.equal(calls[0]!.init.body, calls[2]!.init.body);
  assert.ok(waits[1]! >= 2000, "waited at least Retry-After");
});

test("a 4xx is final and never retried; the token is not in the error", async () => {
  const { impl, calls } = fakeFetch([
    json(409, { success: false, error: { code: 409, reason: "idempotency_key_in_use", message: "Conflict" } }),
  ]);
  const client = createMonimeClient(clientConfig, { fetch: impl, sleep: async () => {} });
  await assert.rejects(client.createCheckoutSession({} as never, "key-1"), (err: unknown) => {
    assert.ok(err instanceof MonimeError);
    assert.equal(err.reason, "idempotency_key_in_use");
    assert.ok(err.isFinal);
    assert.ok(!String(err.message).includes("mon_test_secret"));
    return true;
  });
  assert.equal(calls.length, 1);
});

test("a POST without an idempotency key is never retried", async () => {
  const { impl, calls } = fakeFetch([json(500, {}), json(200, { result: {} })]);
  const client = createMonimeClient(clientConfig, { fetch: impl, sleep: async () => {} });
  // createCheckoutSession always sends a key; simulate a keyless call through the same path.
  await assert.rejects(client.createCheckoutSession({} as never, ""));
  assert.equal(calls.length, 1);
});
