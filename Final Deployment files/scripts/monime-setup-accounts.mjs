#!/usr/bin/env node
/**
 * Finds or creates MobiCare's Holding account in its Monime space and prints
 * the line to put in the server's environment:
 *
 *   MONIME_HOLDING_ACCOUNT_ID   every patient payment lands here. The pharmacy's
 *                               share leaves when the order is complete; MobiCare's
 *                               share (commission, delivery) stays until an admin
 *                               decides what to do with it.
 *
 * Run once per space (test, then live). Safe to run again: the account is found
 * by its reference first, and creation uses a fixed idempotency key.
 *
 *   MONIME_ACCESS_TOKEN=mon_test_... MONIME_SPACE_ID=spc-... \
 *     node "Final Deployment files/scripts/monime-setup-accounts.mjs"
 *
 * The token is read from the environment only. Never put it in a file in git,
 * and never paste it in chat.
 */
import crypto from "node:crypto";

const token = (process.env.MONIME_ACCESS_TOKEN ?? "").trim();
const space = (process.env.MONIME_SPACE_ID ?? "").trim();
const base = (process.env.MONIME_BASE_URL ?? "https://api.monime.io").replace(/\/+$/, "");
const version = process.env.MONIME_API_VERSION ?? "caph.2025-08-23";

if (!token.startsWith("mon_") || !/^spc-/.test(space)) {
  console.error("Set MONIME_ACCESS_TOKEN (mon_test_... or mon_...) and MONIME_SPACE_ID (spc-...) first.");
  process.exit(1);
}
const mode = token.startsWith("mon_test_") ? "test" : "live";

const ACCOUNTS = [
  { env: "MONIME_HOLDING_ACCOUNT_ID", name: "MobiCare Holding", reference: "mobicare-holding" },
];

async function call(method, path, body, key) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Monime-Space-Id": space,
      "Monime-Version": version,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data?.error?.message ?? ""}`.trim());
  return data;
}

// Monime ignores ?reference= on this list (seen live, 9 Oct 2026), so page
// through every account and match the reference here.
async function findByReference(reference) {
  let after = null;
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({ reference, limit: "50", ...(after ? { after } : {}) });
    const data = await call("GET", `/v1/financial-accounts?${query}`);
    const match = (data?.result ?? []).find((a) => a.reference === reference);
    if (match || !data?.pagination?.next) return match ?? null;
    after = data.pagination.next;
  }
  throw new Error("More than 5,000 financial accounts: cannot search them all");
}

const key = (name) => {
  const hex = crypto.createHash("sha256").update(`mobicare:${space}:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

console.log(`Monime ${mode} space ${space}\n`);
const lines = [];
for (const account of ACCOUNTS) {
  let existing = await findByReference(account.reference);
  if (existing) {
    console.log(`Found   ${account.name}: ${existing.id}`);
  } else {
    existing = (
      await call(
        "POST",
        "/v1/financial-accounts",
        { name: account.name, currency: "SLE", reference: account.reference, metadata: { mc_kind: "system_account", mc_env: mode } },
        key(`system-account:${account.reference}`),
      )
    )?.result;
    console.log(`Created ${account.name}: ${existing.id}`);
  }
  lines.push(`${account.env}=${existing.id}`);
}
console.log(`\nAdd these to the server's environment (${mode}):\n\n${lines.join("\n")}\n`);
