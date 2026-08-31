import { db } from "@workspace/db";
import { apiConnectionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "../../lib/audit.js";
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
    (!credentialsEncrypted || !senderAddress)
  ) {
    res.status(400).json({
      error:
        "Client ID, client secret, and Orange sender address are required before enabling.",
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