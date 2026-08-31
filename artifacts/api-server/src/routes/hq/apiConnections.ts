import { db } from "@workspace/db";
import {
  apiConnectionsTable,
  savedApiRequestHistoryTable,
  savedApiRequestsTable,
} from "@workspace/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import { z } from "zod";
import { writeAudit, writeAuditStrict } from "../../lib/audit.js";
import {
  decryptCredential,
  encryptCredential,
} from "../../lib/credentialEncryption.js";
import { OrangeSmsError, sendOrangeSms } from "../../lib/orangeSms.js";
import { safeRouter } from "../../lib/safeRouter.js";
import type { AuthRequest } from "../../middlewares/auth.js";

const router = safeRouter();
const ORANGE_SMS_CONNECTION_ID = "orange_sms";
const TEST_WINDOW_MS = 5 * 60_000;
const MAX_TESTS_PER_WINDOW = 3;
const recentTestAttempts = new Map<string, number[]>();
const EXECUTION_WINDOW_MS = 60_000;
const MAX_EXECUTIONS_PER_WINDOW = 10;
const MAX_HISTORY_PER_REQUEST = 50;
const MAX_RESPONSE_BYTES = 256 * 1024;
export const SAVED_VALUE_MASK = "••••••••";
type SavedPair = { key: string; value: string };
const RESTRICTED_OUTBOUND_HEADERS = new Set([
  "connection",
  "content-length",
  "expect",
  "host",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function unsafeRequestFieldName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized.includes("authorization") ||
    normalized.includes("cookie") ||
    normalized.includes("apikey") ||
    normalized.includes("accesstoken") ||
    normalized.endsWith("token") ||
    normalized.includes("secret") ||
    normalized.includes("credential");
}

function restrictedOutboundHeader(name: string): boolean {
  return RESTRICTED_OUTBOUND_HEADERS.has(name.toLowerCase());
}

const requestMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
const authTypeSchema = z.enum(["none", "basic", "bearer", "api-key-header"]);
const pairSchema = z.object({
  key: z.string().trim().min(1).max(200),
  value: z.string().max(8_000),
});
export const savedRequestInput = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().trim().url().max(2_000),
  method: requestMethodSchema,
  authType: authTypeSchema.default("none"),
  auth: z.object({
    username: z.string().max(500).optional(),
    headerName: z.string().trim().min(1).max(200).optional(),
    secret: z.string().min(1).max(8_000).optional(),
  }).optional(),
  params: z.array(pairSchema).max(50).default([]),
  headers: z.array(pairSchema).max(50).default([]),
  body: z.string().max(64 * 1024).nullable().optional(),
}).superRefine((value, ctx) => {
  const headerBytes = value.headers.reduce((total, pair) => total + Buffer.byteLength(pair.key) + Buffer.byteLength(pair.value) + 4, 0);
  const paramBytes = value.params.reduce((total, pair) => total + Buffer.byteLength(pair.key) + Buffer.byteLength(pair.value) + 2, 0);
  if (headerBytes > 16 * 1024) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Headers exceed the 16 KB limit.", path: ["headers"] });
  if (paramBytes > 16 * 1024) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Parameters exceed the 16 KB limit.", path: ["params"] });
  for (const [index, header] of value.headers.entries()) {
    if (!HEADER_NAME_PATTERN.test(header.key) || /[\r\n]/.test(header.value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Header names and values must use valid HTTP header syntax.", path: ["headers", index] });
    } else if (restrictedOutboundHeader(header.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "This HTTP header cannot be set manually.", path: ["headers", index, "key"] });
    } else if (unsafeRequestFieldName(header.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Sensitive headers must use encrypted authentication settings.", path: ["headers", index, "key"] });
    }
  }
  for (const [index, param] of value.params.entries()) {
    if (unsafeRequestFieldName(param.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Sensitive query parameters are not stored in plaintext. Use encrypted authentication settings.", path: ["params", index, "key"] });
    }
  }
  try {
    const url = new URL(value.url);
    if (url.search || url.hash) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Put query values in Params rather than the URL.", path: ["url"] });
    }
  } catch {
    // The URL field's base schema reports malformed URLs.
  }
});

function consumeTestAllowance(actorId: string): boolean {
  const cutoff = Date.now() - TEST_WINDOW_MS;
  const current = (recentTestAttempts.get(actorId) ?? []).filter(
    (time) => time > cutoff,
  );
  if (current.length >= MAX_TESTS_PER_WINDOW) {
    recentTestAttempts.set(actorId, current);
    return false;
  }
  current.push(Date.now());
  recentTestAttempts.set(actorId, current);
  return true;
}

export function unsafeIp(address: string): boolean {
  const v4 = (value: string) => {
    const [a, b, c] = value.split(".").map(Number);
    return a === 0 || a === 10 || a === 100 && b >= 64 && b <= 127 || a === 127 ||
      a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 0 && (c === 0 || c === 2) ||
      a === 192 && b === 88 && c === 99 || a === 192 && b === 168 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
      a === 203 && b === 0 && c === 113 || a >= 224;
  };
  if (isIP(address) === 4) return v4(address);
  if (isIP(address) !== 6) return true;
  const value = address.toLowerCase();
  const mapped = value.match(/(?:^|:)ffff:([0-9.]+)$/);
  if (mapped) return v4(mapped[1]);
  // Permit only global unicast 2000::/3, excluding documentation.
  return !/^[23][0-9a-f]{0,3}:/.test(value) || value.startsWith("2001:db8:");
}

export function reconcileEncryptedPairs(
  submitted: SavedPair[],
  existingPublic: SavedPair[] = [],
  existingEncrypted: string | null = null,
): { publicPairs: SavedPair[]; encrypted: string } {
  const oldPairs = existingEncrypted
    ? decryptSavedPairs(existingPublic, existingEncrypted)
    : [];
  const queues = new Map<string, string[]>();
  oldPairs.forEach((pair) => {
    const queue = queues.get(pair.key) ?? [];
    queue.push(pair.value);
    queues.set(pair.key, queue);
  });
  const securedPairs = submitted.map((pair) => {
    const queue = queues.get(pair.key);
    const oldValue = queue?.shift();
    if (pair.value === SAVED_VALUE_MASK) {
      if (oldValue === undefined) throw new Error(`Enter a new value for changed key "${pair.key}".`);
      return { key: pair.key, value: oldValue };
    }
    return pair;
  });
  return {
    publicPairs: securedPairs.map((pair) => ({
      key: pair.key,
      value: pair.value === "" ? "" : SAVED_VALUE_MASK,
    })),
    encrypted: encryptCredential(JSON.stringify(securedPairs)),
  };
}

export function decryptSavedPairs(publicPairs: SavedPair[], encrypted: string | null): SavedPair[] {
  const saved = encrypted ? JSON.parse(decryptCredential(encrypted)) as unknown : [];
  if (!Array.isArray(saved) || saved.length !== publicPairs.length) {
    throw new Error("Saved request values must be re-entered.");
  }
  return publicPairs.map((pair, index) => {
    const encryptedPair = saved[index] as Partial<SavedPair> | undefined;
    if (encryptedPair?.key !== pair.key || typeof encryptedPair.value !== "string") {
      throw new Error("Saved request values must be re-entered.");
    }
    return { key: pair.key, value: encryptedPair.value };
  });
}

async function claimExecutionAllowance(actorId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - EXECUTION_WINDOW_MS);
  return db.transaction(async (tx) => {
    // The transaction-scoped lock serializes claims for this actor across replicas.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${actorId}))`);
    await tx.execute(sql`DELETE FROM saved_api_request_execution_claims WHERE actor_id = ${actorId}::uuid AND created_at <= ${cutoff}`);
    const result = await tx.execute(sql`SELECT count(*)::int AS count FROM saved_api_request_execution_claims WHERE actor_id = ${actorId}::uuid AND created_at > ${cutoff}`);
    const count = Number((result.rows[0] as { count?: number | string } | undefined)?.count ?? 0);
    if (count >= MAX_EXECUTIONS_PER_WINDOW) return false;
    await tx.execute(sql`INSERT INTO saved_api_request_execution_claims (actor_id) VALUES (${actorId}::uuid)`);
    return true;
  });
}

export async function validatePublicUrl(
  value: string,
  resolver: (host: string) => Promise<Array<{ address: string }>> = async (host) =>
    lookup(host, { all: true, verbatim: true }),
): Promise<URL> {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("A valid HTTPS URL is required."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") {
    throw new Error("Only public HTTPS URLs on port 443 are allowed.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal" ||
      host.endsWith(".metadata.google.internal") || host === "169.254.169.254") {
    throw new Error("This destination is not allowed.");
  }
  const addresses = isIP(host) ? [{ address: host }] : await resolver(host);
  if (!addresses.length || addresses.some(({ address }) => unsafeIp(address))) throw new Error("This destination is not public.");
  return url;
}

export function maskedRequest(row: typeof savedApiRequestsTable.$inferSelect) {
  const authConfigured = Boolean(row.authConfigEncrypted);
  let auth: Record<string, string> | null = null;
  if (row.authConfigEncrypted) {
    try {
      const saved = JSON.parse(decryptCredential(row.authConfigEncrypted)) as Record<string, string>;
      auth = {
        ...(saved.username ? { username: saved.username } : {}),
        ...(saved.headerName ? { headerName: saved.headerName } : {}),
        secret: "••••••••",
      };
    } catch {
      auth = { secret: "••••••••" };
    }
  }
  return {
    id: row.id, name: row.name, url: row.url, method: row.method, authType: row.authType,
    authConfigured, auth,
    params: row.params, headers: row.headers, body: row.body, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

async function executePublicRequest(url: URL, method: string, headers: Record<string, string>, body: string | null) {
  await validatePublicUrl(url.toString());
  return new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve, reject) => {
    let deadline: NodeJS.Timeout;
    const request = https.request(url, {
      method, headers, timeout: 10_000, maxHeaderSize: 16 * 1024,
      lookup: (hostname, options, callback) => {
        const done = callback as (...args: unknown[]) => void;
        void lookup(hostname, { all: true, verbatim: true })
          .then((addresses) => {
            if (!addresses.length || addresses.some((item) => unsafeIp(item.address))) {
              throw new Error("Unsafe DNS destination.");
            }
            const records = addresses.map((item) => ({
              address: item.address,
              family: isIP(item.address),
            }));
            if (options.all) done(null, records);
            else done(null, records[0]!.address, records[0]!.family);
          })
          .catch((error) => {
            if (options.all) done(error, []);
            else done(error, "", 4);
          });
      },
    }, (response) => {
      if ((response.statusCode ?? 500) >= 300 && (response.statusCode ?? 500) < 400) {
        response.resume(); reject(new Error("Redirect responses are not allowed.")); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) { request.destroy(new Error("Response exceeds the 256 KB limit.")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const allowed = new Set(["content-type", "content-length", "cache-control", "etag", "last-modified"]);
        const safeHeaders = Object.fromEntries(Object.entries(response.headers)
          .filter(([key]) => allowed.has(key.toLowerCase()))
          .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : String(value ?? "")]));
        clearTimeout(deadline);
        resolve({ status: response.statusCode ?? 0, headers: safeHeaders, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    deadline = setTimeout(() => request.destroy(new Error("Request exceeded the 10 second deadline.")), 10_000);
    request.on("timeout", () => request.destroy(new Error("Request timed out after 10 seconds.")));
    request.on("error", (error) => { clearTimeout(deadline); reject(error); });
    if (body) request.write(body);
    request.end();
  });
}

const senderAddressSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{4,19}$/, "Use an international number such as +232...");
const senderNameSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9 ]{1,11}$/,
    "Sender name must be 1–11 letters, numbers, or spaces",
  );

async function currentConfig() {
  const [config] = await db
    .select()
    .from(apiConnectionsTable)
    .where(eq(apiConnectionsTable.id, ORANGE_SMS_CONNECTION_ID))
    .limit(1);
  return config;
}

function publicConfig(config: Awaited<ReturnType<typeof currentConfig>>) {
  const credentialsConfigured = Boolean(config?.credentialsEncrypted);
  const senderAddress =
    typeof config?.publicConfig.senderAddress === "string"
      ? config.publicConfig.senderAddress
      : null;
  const senderName =
    typeof config?.publicConfig.senderName === "string"
      ? config.publicConfig.senderName
      : null;
  const senderConfigured = Boolean(senderAddress);
  return {
    provider: "orange_sl" as const,
    displayName: "Orange Sierra Leone",
    credentialsConfigured,
    senderConfigured,
    connectionStatus:
      config?.isEnabled && credentialsConfigured && senderConfigured
        ? ("ready" as const)
        : credentialsConfigured || senderConfigured
          ? ("incomplete" as const)
          : ("not_configured" as const),
    senderAddress,
    senderName,
    isEnabled: config?.isEnabled ?? false,
    lastTestedAt: config?.lastTestedAt?.toISOString() ?? null,
    lastTestStatus:
      config?.lastTestStatus === "success" ||
      config?.lastTestStatus === "failed"
        ? config.lastTestStatus
        : null,
    lastTestMessage: config?.lastTestMessage ?? null,
    updatedAt: config?.updatedAt?.toISOString() ?? null,
  };
}

export function requestAuth(input: z.infer<typeof savedRequestInput>, existing?: typeof savedApiRequestsTable.$inferSelect) {
  if (input.authType === "none") return null;
  const old = existing?.authType === input.authType && existing.authConfigEncrypted
    ? JSON.parse(decryptCredential(existing.authConfigEncrypted)) as Record<string, string>
    : {};
  const secret = input.auth?.secret ?? old.secret;
  if (!secret) throw new Error("A secret is required for the selected authentication mode.");
  if (input.authType === "basic") {
    const username = input.auth?.username ?? old.username;
    if (!username) throw new Error("A username is required for basic authentication.");
    return encryptCredential(JSON.stringify({ username, secret }));
  }
  if (input.authType === "api-key-header") {
    const headerName = input.auth?.headerName ?? old.headerName;
    if (!headerName || !HEADER_NAME_PATTERN.test(headerName) || restrictedOutboundHeader(headerName)) {
      throw new Error("A valid, non-restricted API key header name is required.");
    }
    return encryptCredential(JSON.stringify({ headerName, secret }));
  }
  return encryptCredential(JSON.stringify({ secret }));
}

function auditDestination(value: string): string {
  const url = new URL(value);
  return url.origin;
}

router.get("/requests", async (_req, res): Promise<void> => {
  const rows = await db.select().from(savedApiRequestsTable).orderBy(desc(savedApiRequestsTable.updatedAt));
  res.json(rows.map(maskedRequest));
});

router.post("/requests", async (req: AuthRequest, res): Promise<void> => {
  const parsed = savedRequestInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  try {
    await validatePublicUrl(parsed.data.url);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "This destination is not allowed." });
    return;
  }
  try {
    let authConfigEncrypted: string | null;
    try {
      authConfigEncrypted = requestAuth(parsed.data);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid authentication settings." });
      return;
    }
    const now = new Date();
    const params = reconcileEncryptedPairs(parsed.data.params);
    const headers = reconcileEncryptedPairs(parsed.data.headers);
    const row = await db.transaction(async (tx) => {
      const [created] = await tx.insert(savedApiRequestsTable).values({
        ...parsed.data, params: params.publicPairs, headers: headers.publicPairs,
        paramsEncrypted: params.encrypted, headersEncrypted: headers.encrypted,
        authConfigEncrypted, body: parsed.data.body ?? null,
        createdBy: req.pharmacy!.sub, updatedBy: req.pharmacy!.sub, updatedAt: now,
      }).returning();
      await writeAuditStrict({ actorType: "hq", actorId: req.pharmacy!.sub, actorName: req.pharmacy!.name, action: "api_request.create", entityType: "api_request", entityId: created.id, details: { method: created.method, destination: auditDestination(created.url) } }, tx);
      return created;
    });
    res.status(201).json(maskedRequest(row));
  } catch (error) {
    console.error("[api-connections] create failed", error);
    res.status(500).json({ error: "Could not save and audit request." });
  }
});

router.get("/requests/:id", async (req, res): Promise<void> => {
  const [row] = await db.select().from(savedApiRequestsTable).where(eq(savedApiRequestsTable.id, String(req.params.id))).limit(1);
  if (!row) { res.status(404).json({ error: "Saved request not found." }); return; }
  res.json(maskedRequest(row));
});

router.put("/requests/:id", async (req: AuthRequest, res): Promise<void> => {
  const parsed = savedRequestInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const [existing] = await db.select().from(savedApiRequestsTable).where(eq(savedApiRequestsTable.id, String(req.params.id))).limit(1);
  if (!existing) { res.status(404).json({ error: "Saved request not found." }); return; }
  try {
    await validatePublicUrl(parsed.data.url);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "This destination is not allowed." });
    return;
  }
  try {
    let authConfigEncrypted: string | null;
    try {
      authConfigEncrypted = requestAuth(parsed.data, existing);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Invalid authentication settings." });
      return;
    }
    const params = reconcileEncryptedPairs(parsed.data.params, existing.params, existing.paramsEncrypted);
    const headers = reconcileEncryptedPairs(parsed.data.headers, existing.headers, existing.headersEncrypted);
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(savedApiRequestsTable).set({
        ...parsed.data, params: params.publicPairs, headers: headers.publicPairs,
        paramsEncrypted: params.encrypted, headersEncrypted: headers.encrypted,
        body: parsed.data.body ?? null, authConfigEncrypted,
        updatedBy: req.pharmacy!.sub, updatedAt: new Date(),
      }).where(eq(savedApiRequestsTable.id, existing.id)).returning();
      await writeAuditStrict({ actorType: "hq", actorId: req.pharmacy!.sub, actorName: req.pharmacy!.name, action: "api_request.update", entityType: "api_request", entityId: updated.id, details: { method: updated.method, destination: auditDestination(updated.url) } }, tx);
      return updated;
    });
    res.json(maskedRequest(row));
  } catch (error) {
    console.error("[api-connections] update failed", error);
    res.status(500).json({ error: "Could not save and audit request." });
  }
});

router.delete("/requests/:id", async (req: AuthRequest, res): Promise<void> => {
  try {
    const row = await db.transaction(async (tx) => {
      const [deleted] = await tx.delete(savedApiRequestsTable).where(eq(savedApiRequestsTable.id, String(req.params.id))).returning();
      if (!deleted) return null;
      await writeAuditStrict({ actorType: "hq", actorId: req.pharmacy!.sub, actorName: req.pharmacy!.name, action: "api_request.delete", entityType: "api_request", entityId: deleted.id, details: { method: deleted.method, destination: auditDestination(deleted.url) } }, tx);
      return deleted;
    });
    if (!row) { res.status(404).json({ error: "Saved request not found." }); return; }
    res.status(204).end();
  } catch { res.status(500).json({ error: "Could not delete and audit request." }); }
});

router.post("/requests/:id/duplicate", async (req: AuthRequest, res): Promise<void> => {
  const [existing] = await db.select().from(savedApiRequestsTable).where(eq(savedApiRequestsTable.id, String(req.params.id))).limit(1);
  if (!existing) { res.status(404).json({ error: "Saved request not found." }); return; }
  try {
    const row = await db.transaction(async (tx) => {
      const [duplicated] = await tx.insert(savedApiRequestsTable).values({ ...existing, id: undefined, name: `${existing.name} (copy)`.slice(0, 200), createdBy: req.pharmacy!.sub, updatedBy: req.pharmacy!.sub, createdAt: new Date(), updatedAt: new Date() }).returning();
      await writeAuditStrict({ actorType: "hq", actorId: req.pharmacy!.sub, actorName: req.pharmacy!.name, action: "api_request.duplicate", entityType: "api_request", entityId: duplicated.id, details: { sourceId: existing.id } }, tx);
      return duplicated;
    });
    res.status(201).json(maskedRequest(row));
  } catch { res.status(500).json({ error: "Could not duplicate and audit request." }); }
});

router.get("/requests/:id/history", async (req, res): Promise<void> => {
  const rows = await db.select().from(savedApiRequestHistoryTable).where(eq(savedApiRequestHistoryTable.requestId, String(req.params.id))).orderBy(desc(savedApiRequestHistoryTable.createdAt)).limit(MAX_HISTORY_PER_REQUEST);
  res.json(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })));
});

router.post("/requests/:id/execute", async (req: AuthRequest, res): Promise<void> => {
  const [row] = await db.select().from(savedApiRequestsTable).where(eq(savedApiRequestsTable.id, String(req.params.id))).limit(1);
  if (!row) { res.status(404).json({ error: "Saved request not found." }); return; }
  if (!await claimExecutionAllowance(req.pharmacy!.sub)) { res.status(429).json({ error: "Too many executions. Please wait one minute." }); return; }
  let historyId: string;
  try {
    historyId = await db.transaction(async (tx) => {
      const [intent] = await tx.insert(savedApiRequestHistoryTable).values({
        requestId: row.id, actorId: req.pharmacy!.sub, method: row.method,
        url: auditDestination(row.url), status: null, durationMs: 0,
        responseHeaders: {}, responseBody: null, error: null,
      }).returning({ id: savedApiRequestHistoryTable.id });
      await writeAuditStrict({
        actorType: "hq", actorId: req.pharmacy!.sub, actorName: req.pharmacy!.name,
        action: "api_request.execute_started", entityType: "api_request",
        entityId: row.id, details: { method: row.method, destination: auditDestination(row.url), historyId: intent.id },
      }, tx);
      return intent.id;
    });
  } catch {
    res.status(500).json({ error: "Execution was not dispatched because its required audit record could not be saved." });
    return;
  }
  const started = Date.now(); let status: number | null = null; let responseHeaders: Record<string, string> = {}; let responseBody: string | null = null; let failure: string | null = null;
  try {
    const url = await validatePublicUrl(row.url);
    for (const pair of decryptSavedPairs(row.params, row.paramsEncrypted)) {
      if (unsafeRequestFieldName(pair.key)) throw new Error("Sensitive query parameters must use encrypted authentication settings.");
      url.searchParams.append(pair.key, pair.value);
    }
    const headers = Object.fromEntries(decryptSavedPairs(row.headers, row.headersEncrypted).map((pair) => [pair.key, pair.value]));
    if (Object.keys(headers).some((key) => restrictedOutboundHeader(key) || unsafeRequestFieldName(key))) {
      throw new Error("This request contains a restricted or sensitive header.");
    }
    if (row.authConfigEncrypted) {
      const auth = JSON.parse(decryptCredential(row.authConfigEncrypted)) as Record<string, string>;
      if (row.authType === "basic") headers.authorization = `Basic ${Buffer.from(`${auth.username}:${auth.secret}`).toString("base64")}`;
      else if (row.authType === "bearer") headers.authorization = `Bearer ${auth.secret}`;
      else if (row.authType === "api-key-header") headers[auth.headerName] = auth.secret;
    }
    const result = await executePublicRequest(url, row.method, headers, row.body);
    status = result.status; responseHeaders = result.headers; responseBody = result.body;
  } catch (error) { failure = error instanceof Error ? error.message.slice(0, 500) : "Execution failed."; }
  const durationMs = Date.now() - started;
  try {
    await db.transaction(async (tx) => {
      await tx.update(savedApiRequestHistoryTable).set({ status, durationMs, responseHeaders, responseBody, error: failure }).where(eq(savedApiRequestHistoryTable.id, historyId));
      await writeAuditStrict({
        actorType: "hq", actorId: req.pharmacy!.sub, actorName: req.pharmacy!.name,
        action: "api_request.execute_completed", entityType: "api_request",
        entityId: row.id, details: { method: row.method, destination: auditDestination(row.url), status, success: !failure, durationMs, historyId },
      }, tx);
    });
  } catch {
    res.status(500).json({ error: "Execution completed but its result and required audit record could not be saved." });
    return;
  }
  if (failure) { res.status(502).json({ error: failure }); return; }
  res.json({ status, durationMs, headers: responseHeaders, body: responseBody });
});

router.get("/orange", async (_req, res): Promise<void> => {
  res.json(publicConfig(await currentConfig()));
});

router.put("/orange", async (req: AuthRequest, res): Promise<void> => {
  const body = z
    .object({
      clientId: z.string().trim().min(1).max(500).optional(),
      clientSecret: z.string().trim().min(1).max(1000).optional(),
      senderAddress: senderAddressSchema.nullable().optional(),
      senderName: senderNameSchema.nullable().optional(),
      isEnabled: z.boolean(),
    })
    .safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message });
    return;
  }

  const existing = await currentConfig();
  let existingCredentials: { clientId?: string; clientSecret?: string } = {};
  if (existing?.credentialsEncrypted) {
    existingCredentials = JSON.parse(
      decryptCredential(existing.credentialsEncrypted),
    ) as typeof existingCredentials;
  }
  const clientId = body.data.clientId ?? existingCredentials.clientId;
  const clientSecret =
    body.data.clientSecret ?? existingCredentials.clientSecret;
  const credentialsEncrypted =
    clientId && clientSecret
      ? encryptCredential(JSON.stringify({ clientId, clientSecret }))
      : null;
  const existingSenderAddress =
    typeof existing?.publicConfig.senderAddress === "string"
      ? existing.publicConfig.senderAddress
      : null;
  const existingSenderName =
    typeof existing?.publicConfig.senderName === "string"
      ? existing.publicConfig.senderName
      : null;
  const senderAddress =
    body.data.senderAddress === undefined
      ? existingSenderAddress
      : body.data.senderAddress;
  const senderName =
    body.data.senderName === undefined
      ? existingSenderName
      : body.data.senderName;

  if (
    body.data.isEnabled &&
    (!credentialsEncrypted || !senderAddress || !senderName)
  ) {
    res.status(400).json({
      error:
        "Client ID, client secret, sender address, and approved sender name are required before enabling.",
    });
    return;
  }

  const now = new Date();
  const [saved] = await db
    .insert(apiConnectionsTable)
    .values({
      id: ORANGE_SMS_CONNECTION_ID,
      provider: "orange_sl",
      displayName: "Orange Sierra Leone",
      category: "sms",
      credentialsEncrypted,
      publicConfig: { senderAddress, senderName },
      isEnabled: body.data.isEnabled,
      updatedBy: req.pharmacy!.sub,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: apiConnectionsTable.id,
      set: {
        credentialsEncrypted,
        publicConfig: { senderAddress, senderName },
        isEnabled: body.data.isEnabled,
        updatedBy: req.pharmacy!.sub,
        updatedAt: now,
      },
    })
    .returning();

  await writeAudit({
    actorType: "hq",
    actorId: req.pharmacy!.sub,
    actorName: req.pharmacy!.name,
    action: "api_connection.orange.update",
    entityType: "api_connection",
    details: {
      provider: "orange_sl",
      credentialsReplaced: Boolean(body.data.clientId || body.data.clientSecret),
      senderAddressChanged: body.data.senderAddress !== undefined,
      senderNameChanged: body.data.senderName !== undefined,
      isEnabled: body.data.isEnabled,
    },
  });
  res.json(publicConfig(saved));
});

router.post("/orange/test", async (req: AuthRequest, res): Promise<void> => {
  const body = z.object({ phone: senderAddressSchema }).safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message });
    return;
  }
  const config = await currentConfig();
  if (
    !config?.credentialsEncrypted ||
    typeof config.publicConfig.senderAddress !== "string"
  ) {
    res.status(409).json({
      error: "Save the Orange credentials and sender address before testing.",
    });
    return;
  }
  if (!config.isEnabled) {
    res.status(409).json({
      error: "Enable the Orange connection before sending a test SMS.",
    });
    return;
  }
  if (!consumeTestAllowance(req.pharmacy!.sub)) {
    res.status(429).json({
      error: "Too many test messages. Please wait five minutes and try again.",
    });
    return;
  }

  const testedAt = new Date();
  try {
    const credentials = JSON.parse(
      decryptCredential(config.credentialsEncrypted),
    ) as { clientId: string; clientSecret: string };
    const result = await sendOrangeSms(
      {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        senderAddress: config.publicConfig.senderAddress,
        senderName:
          typeof config.publicConfig.senderName === "string"
            ? config.publicConfig.senderName
            : null,
      },
      body.data.phone,
      "MobiCare Orange SMS connection test. Your API connection is working.",
    );
    await db
      .update(apiConnectionsTable)
      .set({
        lastTestedAt: testedAt,
        lastTestStatus: "success",
        lastTestMessage: "Test SMS accepted by Orange.",
        updatedAt: testedAt,
      })
      .where(eq(apiConnectionsTable.id, ORANGE_SMS_CONNECTION_ID));
    await writeAudit({
      actorType: "hq",
      actorId: req.pharmacy!.sub,
      actorName: req.pharmacy!.name,
      action: "api_connection.orange.test",
      entityType: "api_connection",
      details: { provider: "orange_sl", success: true },
    });
    res.json({
      success: true,
      message: "Orange accepted the test SMS.",
      providerMessageId: result.providerMessageId,
      testedAt: testedAt.toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof OrangeSmsError
        ? error.message
        : "The Orange connection test failed.";
    await db
      .update(apiConnectionsTable)
      .set({
        lastTestedAt: testedAt,
        lastTestStatus: "failed",
        lastTestMessage: message,
        updatedAt: testedAt,
      })
      .where(eq(apiConnectionsTable.id, ORANGE_SMS_CONNECTION_ID));
    await writeAudit({
      actorType: "hq",
      actorId: req.pharmacy!.sub,
      actorName: req.pharmacy!.name,
      action: "api_connection.orange.test",
      entityType: "api_connection",
      details: { provider: "orange_sl", success: false },
    });
    req.log.warn(
      {
        provider: "orange_sl",
        providerStatus:
          error instanceof OrangeSmsError ? error.providerStatus : undefined,
      },
      "Orange SMS connection test failed",
    );
    res.status(502).json({ error: message });
  }
});

export default router;