import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";

const ORANGE_API_BASE_URL = "https://api.orange.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;

type Fetch = typeof fetch;
type SmsTransport = "orange" | "test";

export type SmsDelivery = {
  transport: SmsTransport;
  deliveryId: string;
  providerMessageId?: string;
};

export class SmsConfigurationError extends Error {
  readonly code = "SMS_CONFIGURATION_ERROR";
}

export class SmsDeliveryError extends Error {
  constructor(
    readonly code:
      | "SMS_TIMEOUT"
      | "SMS_AUTHENTICATION_FAILED"
      | "SMS_BUNDLE_EXHAUSTED"
      | "SMS_SENDER_REJECTED"
      | "SMS_PROVIDER_REJECTED"
      | "SMS_PROVIDER_UNAVAILABLE",
    readonly status?: number,
  ) {
    super(code);
    this.name = "SmsDeliveryError";
  }
}

export function normalizeSierraLeonePhone(value: string): string {
  const compact = value.trim().replace(/[^\d+]/g, "");
  let digits: string;
  if (compact.startsWith("+232")) digits = compact.slice(1);
  else if (compact.startsWith("00232")) digits = compact.slice(2);
  else if (compact.startsWith("232")) digits = compact;
  else if (compact.startsWith("0")) digits = `232${compact.slice(1)}`;
  else digits = `232${compact}`;

  // Sierra Leone NSNs contain eight digits.
  if (!/^232\d{8}$/.test(digits)) {
    throw new SmsDeliveryError("SMS_PROVIDER_REJECTED");
  }
  return `+${digits}`;
}

function transportFor(env: NodeJS.ProcessEnv): SmsTransport {
  if (env.NODE_ENV !== "production" && env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    throw new SmsConfigurationError("NODE_ENV must explicitly be production, development, or test");
  }
  const configured = env.SMS_TRANSPORT;
  let transport: SmsTransport;
  if (configured === "orange" || configured === "test") {
    transport = configured;
  } else if (configured) {
    throw new SmsConfigurationError("SMS_TRANSPORT must be orange or test");
  } else throw new SmsConfigurationError("SMS_TRANSPORT must be explicitly configured");
  if (env.NODE_ENV === "production" && transport !== "orange") {
    throw new SmsConfigurationError("Production requires SMS_TRANSPORT=orange");
  }
  if (env.NODE_ENV !== "production" && transport !== "test") {
    throw new SmsConfigurationError("Development and test environments require SMS_TRANSPORT=test");
  }
  return transport;
}

type OrangeConfig = {
  clientId: string;
  clientSecret: string;
  senderAddress: string;
  senderName: string;
  timeoutMs: number;
};

function orangeConfig(env: NodeJS.ProcessEnv): OrangeConfig {
  const missing = [
    "ORANGE_SMS_CLIENT_ID",
    "ORANGE_SMS_CLIENT_SECRET",
    "ORANGE_SMS_SENDER_ADDRESS",
    "ORANGE_SMS_SENDER_NAME",
  ].filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new SmsConfigurationError(`Missing Orange SMS configuration: ${missing.join(", ")}`);
  }
  const senderAddress = env.ORANGE_SMS_SENDER_ADDRESS!.trim();
  if (!/^232\d+$/.test(senderAddress)) {
    throw new SmsConfigurationError("ORANGE_SMS_SENDER_ADDRESS must start with 232 and contain digits only");
  }
  const senderName = env.ORANGE_SMS_SENDER_NAME!.trim();
  if (!/^[A-Za-z0-9 ]{1,11}$/.test(senderName)) {
    throw new SmsConfigurationError("ORANGE_SMS_SENDER_NAME must be an approved 1-11 character alphanumeric name");
  }
  const timeoutMs = Number(env.ORANGE_SMS_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new SmsConfigurationError("ORANGE_SMS_TIMEOUT_MS must be between 100 and 60000");
  }
  return {
    clientId: env.ORANGE_SMS_CLIENT_ID!,
    clientSecret: env.ORANGE_SMS_CLIENT_SECRET!,
    senderAddress,
    senderName,
    timeoutMs,
  };
}

export function assertSmsConfiguration(env = process.env): void {
  if (transportFor(env) === "orange") orangeConfig(env);
}

function mapProviderError(status: number, providerText: string): SmsDeliveryError {
  const text = providerText.toLowerCase();
  if (status === 401) return new SmsDeliveryError("SMS_AUTHENTICATION_FAILED", status);
  if (text.includes("bundle") || text.includes("balance") || text.includes("credit")) {
    return new SmsDeliveryError("SMS_BUNDLE_EXHAUSTED", status);
  }
  if (text.includes("sender") || text.includes("whitelist")) {
    return new SmsDeliveryError("SMS_SENDER_REJECTED", status);
  }
  if (status >= 500) return new SmsDeliveryError("SMS_PROVIDER_UNAVAILABLE", status);
  return new SmsDeliveryError("SMS_PROVIDER_REJECTED", status);
}

export function createSmsSender(options: {
  env?: NodeJS.ProcessEnv;
  fetch?: Fetch;
  now?: () => number;
} = {}) {
  const env = options.env ?? process.env;
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cachedToken: { value: string; expiresAt: number } | undefined;
  let tokenRequest: Promise<string> | undefined;

  async function request(method: string, url: string, init: RequestInit, timeoutMs: number) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchFn(url, { ...init, method, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new SmsDeliveryError("SMS_TIMEOUT");
      }
      throw new SmsDeliveryError("SMS_PROVIDER_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function accessToken(config: OrangeConfig): Promise<string> {
    if (cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_SKEW_MS > now()) {
      return cachedToken.value;
    }
    if (tokenRequest) return tokenRequest;
    tokenRequest = (async () => {
      const response = await request(
        "POST",
        `${ORANGE_API_BASE_URL}/oauth/v3/token`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: "grant_type=client_credentials",
        },
        config.timeoutMs,
      );
      if (!response.ok) throw mapProviderError(response.status, await response.text());
      const value = await response.json() as { access_token?: string; expires_in?: string | number };
      if (!value.access_token) throw new SmsDeliveryError("SMS_AUTHENTICATION_FAILED", response.status);
      const ttlSeconds = Math.max(1, Number(value.expires_in ?? 3600));
      cachedToken = { value: value.access_token, expiresAt: now() + ttlSeconds * 1000 };
      return value.access_token;
    })();
    try {
      return await tokenRequest;
    } finally {
      tokenRequest = undefined;
    }
  }

  return async function sendSms(to: string, body: string): Promise<SmsDelivery> {
    const transport = transportFor(env);
    const deliveryId = randomUUID();
    if (transport === "test") {
      logger.info({ event: "sms.delivery.skipped", transport, deliveryId }, "SMS non-delivery test transport");
      return { transport, deliveryId };
    }

    const config = orangeConfig(env);
    const address = `tel:${normalizeSierraLeonePhone(to)}`;
    const senderAddress = `tel:+${config.senderAddress}`;
    const payload = JSON.stringify({
      outboundSMSMessageRequest: {
        address,
        senderAddress,
        senderName: config.senderName,
        clientCorrelator: deliveryId.replaceAll("-", "").slice(0, 32),
        outboundSMSTextMessage: { message: body },
      },
    });
    const send = async (token: string) => request(
      "POST",
      `${ORANGE_API_BASE_URL}/smsmessaging/v1/outbound/${encodeURIComponent(senderAddress)}/requests`,
      {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: payload,
      },
      config.timeoutMs,
    );

    const token = await accessToken(config);
    let response = await send(token);
    if (response.status === 401) {
      // Only invalidate the token that was rejected. A concurrent request may
      // already have replaced it with a fresh token.
      if (cachedToken?.value === token) cachedToken = undefined;
      response = await send(await accessToken(config));
    }
    if (!response.ok) throw mapProviderError(response.status, await response.text());
    const result = await response.json().catch(() => ({})) as {
      outboundSMSMessageRequest?: { resourceURL?: string };
    };
    const resource = result.outboundSMSMessageRequest?.resourceURL;
    const providerMessageId = resource?.split("/").filter(Boolean).at(-1);
    logger.info(
      { event: "sms.delivery.accepted", transport, deliveryId, providerMessageId },
      "SMS accepted by provider",
    );
    return { transport, deliveryId, providerMessageId };
  };
}

export const sendSms = createSmsSender();