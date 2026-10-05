#!/usr/bin/env node
/**
 * Finds or creates MobiCare's two accounts in its Monime space and prints the
 * lines to put in the server's environment:
 *
 *   MONIME_HOLDING_ACCOUNT_ID   patient payments land here and wait until the order is complete
 *   MONIME_REVENUE_ACCOUNT_ID   MobiCare's share of each completed order
 *
 * Run once per space (test, then live). Safe to run again: accounts are found
 * by their reference first, and creation uses fixed idempotency keys.
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
  { env: "MONIME_REVENUE_ACCOUNT_ID", name: "MobiCare Revenue", reference: "mobicare-revenue" },
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
  return data?.result;
}

const key = (name) => {
  const hex = crypto.createHash("sha256").update(`mobicare:${space}:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

console.log(`Monime ${mode} space ${space}\n`);
const lines = [];
for (const account of ACCOUNTS) {
  const found = (await call("GET", `/v1/financial-accounts?reference=${encodeURIComponent(account.reference)}&limit=5`)) ?? [];
  let existing = found.find((a) => a.reference === account.reference);
  if (existing) {
    console.log(`Found   ${account.name}: ${existing.id}`);
  } else {
    existing = await call(
      "POST",
      "/v1/financial-accounts",
      { name: account.name, currency: "SLE", reference: account.reference, metadata: { mc_kind: "system_account", mc_env: mode } },
      key(`system-account:${account.reference}`),
    );
    console.log(`Created ${account.name}: ${existing.id}`);
  }
  lines.push(`${account.env}=${existing.id}`);
}
console.log(`\nAdd these to the server's environment (${mode}):\n\n${lines.join("\n")}\n`);
