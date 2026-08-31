import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  apiConnectionsTable,
  auditLogTable,
  hqStaffTable,
} from "@workspace/db/schema";

const BASE_URL = process.env.TEST_API_BASE_URL ?? "http://localhost:80";
const suffix = randomBytes(5).toString("hex");
const username = `orange_admin_${suffix}`;
const password = `Orange_${randomBytes(10).toString("hex")}!`;
const clientId = `client_${randomBytes(12).toString("hex")}`;
const clientSecret = `secret_${randomBytes(18).toString("hex")}`;
let hqId: string | null = null;
let limitedHqId: string | null = null;

async function request(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
) {
  const response = await fetch(`${BASE_URL}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL ${message}`);
  console.log(`PASS ${message}`);
}

async function main() {
try {
  const passwordHash = await bcrypt.hash(password, 12);
  const [created] = await db
    .insert(hqStaffTable)
    .values({
      username,
      passwordHash,
      name: "Orange API Test Admin",
      isActive: true,
      canManageIntegrations: true,
    })
    .returning({ id: hqStaffTable.id });
  hqId = created.id;

  const [limited] = await db
    .insert(hqStaffTable)
    .values({
      username: `limited_${suffix}`,
      passwordHash,
      name: "Limited HQ Test User",
      isActive: true,
      canManageIntegrations: false,
    })
    .returning({ id: hqStaffTable.id });
  limitedHqId = limited.id;

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier: username, password }),
  });
  assert(login.status === 200, "HQ administrator can authenticate");
  const token = login.body.accessToken as string;

  const limitedLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier: `limited_${suffix}`, password }),
  });
  const limitedToken = limitedLogin.body.accessToken as string;
  const forbidden = await request(
    "/hq/api-connections/orange",
    {},
    limitedToken,
  );
  assert(
    forbidden.status === 403,
    "HQ staff without integration permission are denied",
  );

  const unauthorized = await request("/hq/api-connections/orange");
  assert(unauthorized.status === 401, "connection settings reject anonymous access");

  const saved = await request(
    "/hq/api-connections/orange",
    {
      method: "PUT",
      body: JSON.stringify({
        clientId,
        clientSecret,
        senderAddress: "+23276123456",
        senderName: "MobiCare",
        isEnabled: false,
      }),
    },
    token,
  );
  assert(saved.status === 200, "HQ can save Orange connection settings");
  assert(
    saved.body.credentialsConfigured === true &&
      !("clientId" in saved.body) &&
      !("clientSecret" in saved.body),
    "saved response exposes status but never credentials",
  );

  const [stored] = await db
    .select()
    .from(apiConnectionsTable)
    .where(eq(apiConnectionsTable.id, "orange_sms"))
    .limit(1);
  assert(
    Boolean(stored?.credentialsEncrypted) &&
      !stored.credentialsEncrypted?.includes(clientId) &&
      !stored.credentialsEncrypted?.includes(clientSecret),
    "credentials are encrypted at rest",
  );

  const masked = await request(
    "/hq/api-connections/orange",
    {},
    token,
  );
  assert(
    masked.status === 200 &&
      masked.body.connectionStatus === "incomplete" &&
      !JSON.stringify(masked.body).includes(clientSecret),
    "subsequent reads remain masked",
  );

  const blockedTest = await request(
    "/hq/api-connections/orange/test",
    {
      method: "POST",
      body: JSON.stringify({ phone: "+23276123456" }),
    },
    token,
  );
  assert(
    blockedTest.status === 409,
    "disabled connections cannot send a test SMS through the API",
  );

  const [audit] = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.actorId, hqId),
        eq(auditLogTable.action, "api_connection.orange.update"),
      ),
    )
    .limit(1);
  assert(Boolean(audit), "credential changes are recorded in the audit trail");

  console.log("\n9/9 Orange API connection checks passed");
} finally {
  if (limitedHqId) {
    await db.delete(hqStaffTable).where(eq(hqStaffTable.id, limitedHqId));
  }
  if (hqId) {
    await db.delete(hqStaffTable).where(eq(hqStaffTable.id, hqId));
  }
  await db
    .delete(apiConnectionsTable)
    .where(eq(apiConnectionsTable.id, "orange_sms"));
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});