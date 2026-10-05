#!/usr/bin/env node
/**
 * A fake Monime for local development and tests ONLY. Never deployed.
 *
 * It behaves like the parts of Monime's API that MobiCare uses (API version
 * caph.2025-08-23), as far as Monime's specification and documentation
 * describe them:
 *
 *   GET    /                               who am I (environment, version)
 *   POST   /v1/checkout-sessions           create a payment link (Idempotency-Key required)
 *   GET    /v1/checkout-sessions/:id       read it
 *   DELETE /v1/checkout-sessions/:id       delete it (only before payment starts)
 *   GET    /v1/payments?orderNumber=...    payments for a link
 *   GET    /v1/payments/:id                one payment
 *   POST   /v1/financial-accounts          create an account (reference unique)
 *   GET    /v1/financial-accounts?reference=...  find by reference
 *   GET    /v1/financial-accounts/:id[?withBalance=true]
 *   POST   /v1/internal-transfers          move money between accounts (no fee)
 *   GET    /v1/internal-transfers/:id
 *   POST   /v1/payouts                     send to a mobile money wallet (1% fee on top)
 *   GET    /v1/payouts/:id
 *
 * Accounts hold real (fake) balances: a payment credits Holding with the
 * amount less Monime's 1% fee, transfers and payouts move it, and a movement
 * the source can't cover fails with fund_insufficient, as Monime's would.
 * Transfers and payouts start 'pending' and finish shortly after, with a
 * webhook (internal_transfer.completed / payout.completed / payout.failed).
 *
 * plus a hosted test payment page at /checkout/:id, where you "pay" with a
 * test Orange Money or AfriMoney wallet or cancel. Paying sends the webhooks
 * (checkout_session.completed, payment.completed) to FAKE_MONIME_WEBHOOK_URL.
 *
 * Test helpers (not part of Monime):
 *   POST /__admin/expire/:id        expire a link now
 *   POST /__admin/fail-next?count=N answer the next N API calls with 503
 *   GET  /__admin/state             everything it holds, as JSON
 *   POST /__admin/fail-payout?code=X  the next payout fails with code X
 *   POST /__admin/fail-transfer?code=X the next transfer fails with code X
 *   POST /__admin/credit?account=ID&value=CENTS  add money to an account (a top-up)
 *
 * Settings (environment):
 *   FAKE_MONIME_PORT            default 9100
 *   FAKE_MONIME_PUBLIC_URL      address the browser uses, default http://localhost:<port>
 *   FAKE_MONIME_WEBHOOK_URL     where to send webhooks (none if unset)
 *   FAKE_MONIME_WEBHOOK_TOKEN   sent in the x-mobicare-webhook-token header
 *   FAKE_MONIME_WEBHOOK_DELAY_MS  default 300
 *   FAKE_MONIME_SESSION_TTL_MIN   link lifetime, default 30
 *   FAKE_MONIME_SETTLE_DELAY_MS   how long transfers and payouts take, default 600
 *   FAKE_MONIME_STATE_FILE        keep everything in this JSON file across restarts
 */
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";

const PORT = Number(process.env.FAKE_MONIME_PORT ?? 9100);
const PUBLIC_URL = (process.env.FAKE_MONIME_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");
const WEBHOOK_URL = process.env.FAKE_MONIME_WEBHOOK_URL ?? "";
const WEBHOOK_TOKEN = process.env.FAKE_MONIME_WEBHOOK_TOKEN ?? "";
const WEBHOOK_DELAY_MS = Number(process.env.FAKE_MONIME_WEBHOOK_DELAY_MS ?? 300);
const SESSION_TTL_MS = Number(process.env.FAKE_MONIME_SESSION_TTL_MIN ?? 30) * 60_000;
const API_VERSION = "caph.2025-08-23";
const HOLDING_DEFAULT = "fac-main-test";
const SETTLE_DELAY_MS = Number(process.env.FAKE_MONIME_SETTLE_DELAY_MS ?? 600);

const sessions = new Map();
const payments = new Map();
const idempotency = new Map();
const webhooksSent = [];
let failNext = 0;
let failNextPayout = null;
let failNextTransfer = null;

// MobiCare's two accounts exist from the start (run.sh points the API at them).
const accounts = new Map();
for (const [id, name, reference] of [
  ["fac-holding-local", "MobiCare Holding", "mobicare-holding"],
  ["fac-revenue-local", "MobiCare Revenue", "mobicare-revenue"],
  [HOLDING_DEFAULT, "Main account", null],
]) {
  accounts.set(id, { id, uvan: `uvan-${id}`, name, currency: "SLE", reference, balance: 0, createTime: new Date().toISOString(), metadata: null });
}
const transfers = new Map();
const payouts = new Map();
// Optional persistence, so balances survive a restart of the local stack.
const STATE_FILE = process.env.FAKE_MONIME_STATE_FILE ?? "";
const stores = { sessions, payments, accounts, transfers, payouts, idempotency };
if (STATE_FILE && fs.existsSync(STATE_FILE)) {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  for (const [name, entries] of Object.entries(saved)) for (const [k, v] of entries) stores[name]?.set(k, v);
}
function saveState() {
  if (!STATE_FILE) return;
  const data = Object.fromEntries(Object.entries(stores).map(([name, map]) => [name, [...map.entries()]]));
  fs.writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(data));
  fs.renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
}
setInterval(saveState, 1000).unref();
process.on("SIGTERM", () => { saveState(); process.exit(0); });
process.on("SIGINT", () => { saveState(); process.exit(0); });

const accountView = (account, withBalance) => ({
  ...account,
  balance: withBalance ? { available: { currency: "SLE", value: account.balance } } : null,
});

const rid = (prefix) => `${prefix}-${crypto.randomBytes(12).toString("base64url").replace(/[-_]/g, "x")}`;
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");

function send(res, status, body, headers = {}) {
  const requestId = rid("req");
  res.writeHead(status, { "content-type": "application/json", "monime-request-id": requestId, ...headers });
  res.end(JSON.stringify(body));
}
const ok = (res, result, headers) => send(res, 200, { success: true, messages: [], result }, headers);
const fail = (res, status, reason, message, headers) =>
  send(res, status, { success: false, messages: [], error: { code: status, reason, message, details: [] } }, headers);

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function auth(req) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token.startsWith("mon_test_")) return "test";
  if (token.startsWith("mon_")) return "live";
  return null;
}

function refresh(session) {
  if (session.status === "pending" && Date.parse(session.expireTime) < Date.now()) session.status = "expired";
  return session;
}

const TOP_LEVEL = new Set(["name", "description", "cancelUrl", "successUrl", "callbackState", "reference", "financialAccountId", "lineItems", "paymentOptions", "brandingOptions", "metadata"]);
const LINE_KEYS = new Set(["type", "name", "price", "quantity", "reference", "description", "images"]);

function validateCreate(body) {
  if (!body || typeof body !== "object") return "Body must be an object";
  for (const key of Object.keys(body)) if (!TOP_LEVEL.has(key)) return `Unknown field '${key}'`;
  if (typeof body.name !== "string" || !body.name || body.name.length > 150) return "name is required (max 150)";
  if (!Array.isArray(body.lineItems) || body.lineItems.length < 1 || body.lineItems.length > 16) return "lineItems must have 1 to 16 items";
  for (const url of [body.successUrl, body.cancelUrl]) {
    if (url !== undefined && !/^https?:\/\//.test(url)) return "URLs must be absolute";
  }
  for (const line of body.lineItems) {
    for (const key of Object.keys(line)) if (!LINE_KEYS.has(key)) return `Unknown line item field '${key}'`;
    if (typeof line.name !== "string" || !line.name || line.name.length > 100) return "line item name is required (max 100)";
    if (!line.price || line.price.currency !== "SLE" || !Number.isInteger(line.price.value) || line.price.value < 0) return "line item price must be SLE cents";
    const quantity = line.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) return "quantity must be 1 to 100000";
  }
  const metadata = body.metadata ?? {};
  if (Object.keys(metadata).length > 64) return "metadata: at most 64 pairs";
  for (const [key, value] of Object.entries(metadata)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key) || /^(_|-|monime)/i.test(key)) return `metadata key '${key}' not allowed`;
    if (typeof value !== "string" || value.length > 100) return `metadata '${key}' must be a string up to 100`;
  }
  return null;
}

async function sendWebhook(name, object) {
  if (!WEBHOOK_URL) return;
  const envelope = {
    apiVersion: API_VERSION,
    event: { id: rid("wke"), name, timestamp: String(Math.floor(Date.now() / 1000)) },
    object: { id: object.id, type: name.split(".")[0] },
    data: object,
  };
  await new Promise((r) => setTimeout(r, WEBHOOK_DELAY_MS));
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...(WEBHOOK_TOKEN ? { "x-mobicare-webhook-token": WEBHOOK_TOKEN } : {}) },
      body: JSON.stringify(envelope),
    });
    webhooksSent.push({ name, eventId: envelope.event.id, status: res.status });
  } catch (err) {
    webhooksSent.push({ name, eventId: envelope.event.id, status: `error: ${err.message}` });
  }
}

const money = (cents) => `Le ${(cents / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function checkoutPage(session) {
  const total = session.lineItems.data.reduce((sum, l) => sum + l.price.value * (l.quantity ?? 1), 0);
  const rows = session.lineItems.data
    .map((l) => `<tr><td>${esc(l.name)}${(l.quantity ?? 1) > 1 ? ` × ${l.quantity}` : ""}</td><td class="r">${money(l.price.value * (l.quantity ?? 1))}</td></tr>`)
    .join("");
  const closed = session.status !== "pending";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Monime test checkout</title>
<style>body{font:16px system-ui,sans-serif;background:#f1f5f4;margin:0;padding:24px;color:#10241d}
.card{max-width:420px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.badge{display:inline-block;background:#fff4d6;color:#7a5200;border:1px solid #f0d58a;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600}
h1{font-size:20px;margin:12px 0 4px}table{width:100%;border-collapse:collapse;margin:16px 0;font-size:14px}td{padding:6px 0;border-bottom:1px solid #eef2f0}
.r{text-align:right}.total{font-weight:700;font-size:18px}button{width:100%;padding:14px;border-radius:999px;border:0;font-size:16px;font-weight:600;margin-top:10px;cursor:pointer}
.orange{background:#ff7900;color:#fff}.afri{background:#7b2d8e;color:#fff}.cancel{background:#fff;border:1px solid #c9d3cf;color:#10241d}.muted{color:#5d6f68;font-size:13px}</style></head>
<body><div class="card"><span class="badge">TEST · fake Monime, local only · no real money</span>
<h1>${esc(session.name)}</h1><div class="muted">Monime order ${esc(session.orderNumber)}</div>
<table>${rows}<tr><td class="total">Total</td><td class="r total">${money(total)}</td></tr></table>
${closed ? `<p><strong>This payment link is ${esc(session.status)}.</strong></p>` : `
<form method="post" action="/checkout/${esc(session.id)}/pay"><input type="hidden" name="provider" value="m17"><input type="hidden" name="phone" value="+23276000001">
<button class="orange" id="pay-orange">Pay with Orange Money (test)</button></form>
<form method="post" action="/checkout/${esc(session.id)}/pay"><input type="hidden" name="provider" value="m18"><input type="hidden" name="phone" value="+23230000001">
<button class="afri" id="pay-afri">Pay with AfriMoney (test)</button></form>
<form method="post" action="/checkout/${esc(session.id)}/cancel"><button class="cancel" id="cancel">Cancel and go back</button></form>`}
<p class="muted">Link expires ${esc(new Date(session.expireTime).toLocaleString())}</p></div></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);
  const path = url.pathname;
  try {
    // ── Test helpers ────────────────────────────────────────────────────
    if (path === "/__admin/state") {
      return ok(res, {
        sessions: [...sessions.values()],
        payments: [...payments.values()],
        accounts: [...accounts.values()],
        transfers: [...transfers.values()],
        payouts: [...payouts.values()],
        webhooksSent,
      });
    }
    if (req.method === "POST" && path === "/__admin/fail-payout") {
      failNextPayout = url.searchParams.get("code") ?? "provider_account_missing";
      return ok(res, { failNextPayout });
    }
    if (req.method === "POST" && path === "/__admin/credit") {
      const account = accounts.get(url.searchParams.get("account") ?? "");
      const value = Number(url.searchParams.get("value"));
      if (!account || !Number.isInteger(value)) return fail(res, 400, "validation_failed", "account and integer value required");
      account.balance += value;
      return ok(res, accountView(account, true));
    }
    if (req.method === "POST" && path === "/__admin/fail-transfer") {
      failNextTransfer = url.searchParams.get("code") ?? "fund_insufficient";
      return ok(res, { failNextTransfer });
    }
    if (req.method === "POST" && path === "/__admin/fail-next") {
      failNext = Number(url.searchParams.get("count") ?? 1);
      return ok(res, { failNext });
    }
    if (req.method === "POST" && path.startsWith("/__admin/expire/")) {
      const session = sessions.get(path.split("/").pop());
      if (!session) return fail(res, 404, "not_found", "No such session");
      session.status = "expired";
      session.expireTime = new Date().toISOString();
      void sendWebhook("checkout_session.expired", session);
      return ok(res, session);
    }

    // ── Hosted payment page ─────────────────────────────────────────────
    const page = path.match(/^\/checkout\/([^/]+)(\/pay|\/cancel)?$/);
    if (page) {
      const session = sessions.get(page[1]);
      if (!session || session.deleted) {
        res.writeHead(404, { "content-type": "text/html" });
        return res.end("<p>Payment link not found.</p>");
      }
      refresh(session);
      if (req.method === "GET" && !page[2]) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(checkoutPage(session));
      }
      const form = new URLSearchParams(await readBody(req));
      if (session.status !== "pending") {
        res.writeHead(409, { "content-type": "text/html" });
        return res.end(`<p>This payment link is ${esc(session.status)}.</p>`);
      }
      if (page[2] === "/cancel") {
        session.status = "cancelled";
        void sendWebhook("checkout_session.cancelled", session);
        res.writeHead(303, { location: session.cancelUrl ?? PUBLIC_URL });
        return res.end();
      }
      // Pay: the session is "initiated" from here on, so it can't be deleted.
      session.initiated = true;
      const total = session.lineItems.data.reduce((sum, l) => sum + l.price.value * (l.quantity ?? 1), 0);
      const phone = form.get("phone") ?? "+23276000001";
      const payment = {
        id: rid("pay"),
        status: "completed",
        amount: { currency: "SLE", value: total },
        channel: {
          type: "momo",
          provider: form.get("provider") ?? "m17",
          reference: `MP${Date.now()}`,
          phoneNumber: `${phone.slice(0, 7)}****${phone.slice(-1)}`,
          fingerprint: sha(phone).slice(0, 24),
        },
        name: session.name,
        reference: session.reference ?? null,
        orderNumber: session.orderNumber,
        financialAccountId: session.financialAccountId ?? HOLDING_DEFAULT,
        financialTransactionReference: rid("ftx"),
        fees: [{ code: "processing", amount: { currency: "SLE", value: Math.round(total / 100) } }],
        createTime: new Date().toISOString(),
        updateTime: new Date().toISOString(),
        metadata: null,
      };
      payments.set(payment.id, payment);
      const landing = accounts.get(payment.financialAccountId);
      if (landing) landing.balance += total - payment.fees[0].amount.value;
      session.status = "completed";
      void sendWebhook("checkout_session.completed", session).then(() => sendWebhook("payment.completed", payment));
      res.writeHead(303, { location: session.successUrl ?? PUBLIC_URL });
      return res.end();
    }

    // ── API ─────────────────────────────────────────────────────────────
    const environment = auth(req);
    if (path === "/" && req.method === "GET") {
      return send(res, 200, {
        platform: "Monime - fake (local tests)",
        status: { environment, isAuthenticated: Boolean(environment) },
        apiVersion: environment ? { id: API_VERSION, release: { name: "caph", date: "2025-06-20" }, deprecated: false } : null,
      });
    }
    if (!environment) return fail(res, 401, "unauthorized", "Missing or invalid access token");
    if (!/^spc-/.test(req.headers["monime-space-id"] ?? "")) return fail(res, 400, "invalid_space", "Monime-Space-Id is required");
    if (failNext > 0) {
      failNext -= 1;
      return fail(res, 503, "unavailable", "Temporarily unavailable (fake)");
    }

    if (path === "/v1/checkout-sessions" && req.method === "POST") {
      const raw = await readBody(req);
      const key = req.headers["idempotency-key"];
      if (!key) return fail(res, 400, "idempotency_key_required", "Idempotency-Key is required");
      if (key.length > 64) return fail(res, 400, "invalid_idempotency_key", "Idempotency-Key too long");
      const fingerprint = sha(`POST ${path} ${raw}`);
      const seen = idempotency.get(key);
      if (seen) {
        if (seen.fingerprint !== fingerprint) return fail(res, 409, "idempotency_key_in_use", "Conflict: Idempotency key reused with a non-identical request.");
        return ok(res, refresh(sessions.get(seen.id)), { "monime-cache": "irc" });
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return fail(res, 400, "invalid_json", "Body is not JSON");
      }
      const problem = validateCreate(body);
      if (problem) return fail(res, 400, "validation_failed", problem);
      const id = rid("cos");
      const session = {
        id,
        status: "pending",
        name: body.name,
        orderNumber: String(Math.floor(1e11 + Math.random() * 9e11)),
        reference: body.reference ?? null,
        description: body.description ?? null,
        redirectUrl: `${PUBLIC_URL}/checkout/${id}`,
        cancelUrl: body.cancelUrl ?? null,
        successUrl: body.successUrl ?? null,
        lineItems: { data: body.lineItems.map((l) => ({ ...l, type: "custom", quantity: l.quantity ?? 1, id: rid("li") })) },
        financialAccountId: body.financialAccountId ?? HOLDING_DEFAULT,
        brandingOptions: body.brandingOptions ?? null,
        expireTime: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        createTime: new Date().toISOString(),
        metadata: body.metadata ?? null,
        initiated: false,
      };
      sessions.set(id, session);
      idempotency.set(key, { fingerprint, id });
      return ok(res, session);
    }

    const one = path.match(/^\/v1\/checkout-sessions\/([^/]+)$/);
    if (one) {
      const session = sessions.get(one[1]);
      if (!session || session.deleted) return fail(res, 404, "not_found", "Checkout session not found");
      if (req.method === "GET") return ok(res, refresh(session));
      if (req.method === "DELETE") {
        refresh(session);
        if (session.initiated || session.status !== "pending") {
          return fail(res, 400, "session_initiated", "The checkout session has been initiated and can't be deleted");
        }
        session.deleted = true;
        return ok(res, null);
      }
    }

    // ── Accounts, transfers, payouts (phase 2) ─────────────────────────────
    if (req.method === "POST" && ["/v1/financial-accounts", "/v1/internal-transfers", "/v1/payouts"].includes(path)) {
      const raw = await readBody(req);
      const key = req.headers["idempotency-key"];
      if (!key) return fail(res, 400, "idempotency_key_required", "Idempotency-Key is required");
      const fingerprint = sha(`POST ${path} ${raw}`);
      const seen = idempotency.get(key);
      const store = path === "/v1/financial-accounts" ? accounts : path === "/v1/internal-transfers" ? transfers : payouts;
      if (seen) {
        if (seen.fingerprint !== fingerprint) return fail(res, 409, "idempotency_key_in_use", "Conflict: Idempotency key reused with a non-identical request.");
        const found = store.get(seen.id);
        return ok(res, path === "/v1/financial-accounts" ? accountView(found, false) : found, { "monime-cache": "irc" });
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return fail(res, 400, "invalid_json", "Body is not JSON");
      }
      const amountOk = (amount) => amount && amount.currency === "SLE" && Number.isInteger(amount.value) && amount.value > 0;

      if (path === "/v1/financial-accounts") {
        for (const k of Object.keys(body)) if (!["name", "currency", "reference", "metadata"].includes(k)) return fail(res, 400, "validation_failed", `Unknown field '${k}'`);
        if (!body.name || body.currency !== "SLE") return fail(res, 400, "validation_failed", "name and currency SLE are required");
        if (body.reference && [...accounts.values()].some((a) => a.reference === body.reference)) {
          return fail(res, 409, "reference_in_use", "An account with this reference already exists");
        }
        const account = { id: rid("fac"), uvan: rid("uvan"), name: body.name, currency: "SLE", reference: body.reference ?? null, balance: 0, createTime: new Date().toISOString(), metadata: body.metadata ?? null };
        accounts.set(account.id, account);
        idempotency.set(key, { fingerprint, id: account.id });
        return ok(res, accountView(account, false));
      }

      if (path === "/v1/internal-transfers") {
        for (const k of Object.keys(body)) if (!["amount", "sourceFinancialAccount", "destinationFinancialAccount", "metadata"].includes(k)) return fail(res, 400, "validation_failed", `Unknown field '${k}'`);
        const source = accounts.get(body.sourceFinancialAccount?.id);
        const destination = accounts.get(body.destinationFinancialAccount?.id);
        if (!amountOk(body.amount)) return fail(res, 400, "validation_failed", "amount must be positive SLE cents");
        if (!source || !destination) return fail(res, 404, "not_found", "Financial account not found");
        const transfer = {
          id: rid("trn"), status: "pending", amount: body.amount,
          sourceFinancialAccount: { id: source.id }, destinationFinancialAccount: { id: destination.id },
          financialTransactionReference: null, failureDetail: null,
          createTime: new Date().toISOString(), updateTime: null, metadata: body.metadata ?? null,
        };
        transfers.set(transfer.id, transfer);
        idempotency.set(key, { fingerprint, id: transfer.id });
        setTimeout(() => {
          const forced = failNextTransfer;
          failNextTransfer = null;
          if (forced || source.balance < transfer.amount.value) {
            transfer.status = "failed";
            transfer.failureDetail = { code: forced ?? "fund_insufficient", message: forced ? "Failed (fake, forced)" : "Source account has insufficient funds" };
          } else {
            source.balance -= transfer.amount.value;
            destination.balance += transfer.amount.value;
            transfer.status = "completed";
            transfer.financialTransactionReference = rid("ftx");
          }
          transfer.updateTime = new Date().toISOString();
          void sendWebhook(`internal_transfer.${transfer.status}`, transfer);
        }, SETTLE_DELAY_MS);
        return ok(res, transfer);
      }

      // Payouts
      for (const k of Object.keys(body)) if (!["amount", "source", "destination", "metadata"].includes(k)) return fail(res, 400, "validation_failed", `Unknown field '${k}'`);
      const source = accounts.get(body.source?.financialAccountId ?? HOLDING_DEFAULT);
      const dest = body.destination ?? {};
      if (!amountOk(body.amount)) return fail(res, 400, "validation_failed", "amount must be positive SLE cents");
      if (!source) return fail(res, 404, "not_found", "Financial account not found");
      if (dest.type !== "momo" || !["m17", "m18"].includes(dest.providerId) || !/^\+232\d{8}$/.test(dest.phoneNumber ?? "")) {
        return fail(res, 400, "validation_failed", "destination must be momo m17/m18 with a +232 phone number");
      }
      const payout = {
        id: rid("pwt"), status: "pending", amount: body.amount,
        source: { financialAccountId: source.id, transactionReference: null },
        destination: { type: "momo", providerId: dest.providerId, phoneNumber: dest.phoneNumber, transactionReference: null },
        fees: [], failureDetail: null,
        createTime: new Date().toISOString(), updateTime: new Date().toISOString(), metadata: body.metadata ?? null,
      };
      payouts.set(payout.id, payout);
      idempotency.set(key, { fingerprint, id: payout.id });
      setTimeout(() => {
        payout.status = "processing";
        setTimeout(() => {
          const fee = Math.ceil(payout.amount.value / 100);
          const forced = failNextPayout;
          failNextPayout = null;
          if (forced || source.balance < payout.amount.value + fee) {
            payout.status = "failed";
            payout.failureDetail = { code: forced ?? "fund_insufficient", message: forced ? "Failed (fake, forced)" : "Source account has insufficient funds" };
          } else {
            source.balance -= payout.amount.value + fee;
            payout.status = "completed";
            payout.fees = [{ code: "payout", amount: { currency: "SLE", value: fee }, metadata: null }];
            payout.destination.transactionReference = `MP${Date.now()}`;
          }
          payout.updateTime = new Date().toISOString();
          void sendWebhook(`payout.${payout.status}`, payout);
        }, SETTLE_DELAY_MS);
      }, SETTLE_DELAY_MS);
      return ok(res, payout);
    }

    if (path === "/v1/financial-accounts" && req.method === "GET") {
      const reference = url.searchParams.get("reference");
      const list = [...accounts.values()].filter((a) => !reference || a.reference === reference).map((a) => accountView(a, url.searchParams.get("withBalance") === "true"));
      return send(res, 200, { success: true, messages: [], result: list, pagination: { count: list.length, next: null } });
    }
    const account = path.match(/^\/v1\/financial-accounts\/([^/]+)$/);
    if (account && req.method === "GET") {
      const found = accounts.get(account[1]);
      return found ? ok(res, accountView(found, url.searchParams.get("withBalance") === "true")) : fail(res, 404, "not_found", "Financial account not found");
    }
    const transfer = path.match(/^\/v1\/internal-transfers\/([^/]+)$/);
    if (transfer && req.method === "GET") {
      const found = transfers.get(transfer[1]);
      return found ? ok(res, found) : fail(res, 404, "not_found", "Internal transfer not found");
    }
    const payoutMatch = path.match(/^\/v1\/payouts\/([^/]+)$/);
    if (payoutMatch && req.method === "GET") {
      const found = payouts.get(payoutMatch[1]);
      return found ? ok(res, found) : fail(res, 404, "not_found", "Payout not found");
    }

    if (path === "/v1/payments" && req.method === "GET") {
      const orderNumber = url.searchParams.get("orderNumber");
      const list = [...payments.values()].filter((p) => !orderNumber || p.orderNumber === orderNumber);
      return send(res, 200, { success: true, messages: [], result: list, pagination: { count: list.length, next: null } });
    }
    const payment = path.match(/^\/v1\/payments\/([^/]+)$/);
    if (payment && req.method === "GET") {
      const found = payments.get(payment[1]);
      return found ? ok(res, found) : fail(res, 404, "not_found", "Payment not found");
    }

    return fail(res, 404, "not_found", `No route for ${req.method} ${path}`);
  } catch (err) {
    return fail(res, 500, "internal", err.message);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Fake Monime (local tests only) on ${PUBLIC_URL}; webhooks to ${WEBHOOK_URL || "(none)"}`);
});
