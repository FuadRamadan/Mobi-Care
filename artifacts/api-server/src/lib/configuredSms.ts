import { db } from "@workspace/db";
import { apiConnectionsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { decryptCredential } from "./credentialEncryption.js";
import {
  createSmsSender,
  sendSms as sendDevelopmentSms,
  SmsConfigurationError,
  type SmsDelivery,
} from "./sms.js";

const ORANGE_SMS_CONNECTION_ID = "orange_sms";

type StoredCredentials = {
  clientId?: string;
  clientSecret?: string;
};

/**
 * Sends with the HQ-managed connection in production. Development and tests
 * retain the explicit non-delivery transport from sms.ts.
 */
export async function sendSms(
  to: string,
  body: string,
): Promise<SmsDelivery> {
  if (process.env.NODE_ENV !== "production") {
    return sendDevelopmentSms(to, body);
  }

  const [connection] = await db
    .select()
    .from(apiConnectionsTable)
    .where(eq(apiConnectionsTable.id, ORANGE_SMS_CONNECTION_ID))
    .limit(1);

  if (!connection?.isEnabled || !connection.credentialsEncrypted) {
    throw new SmsConfigurationError(
      "Orange SMS is not enabled in HQ API Connections",
    );
  }

  const credentials = JSON.parse(
    decryptCredential(connection.credentialsEncrypted),
  ) as StoredCredentials;
  const senderAddress =
    typeof connection.publicConfig.senderAddress === "string"
      ? connection.publicConfig.senderAddress.replace(/^\+/, "")
      : "";
  const senderName =
    typeof connection.publicConfig.senderName === "string"
      ? connection.publicConfig.senderName
      : "";

  const configuredSender = createSmsSender({
    env: {
      NODE_ENV: "production",
      SMS_TRANSPORT: "orange",
      ORANGE_SMS_CLIENT_ID: credentials.clientId,
      ORANGE_SMS_CLIENT_SECRET: credentials.clientSecret,
      ORANGE_SMS_SENDER_ADDRESS: senderAddress,
      ORANGE_SMS_SENDER_NAME: senderName,
      ORANGE_SMS_TIMEOUT_MS: process.env.ORANGE_SMS_TIMEOUT_MS,
    },
  });

  return configuredSender(to, body);
}