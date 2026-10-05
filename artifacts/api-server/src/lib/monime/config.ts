/**
 * Monime settings, read once from the environment.
 *
 * Payments go through Monime only when PAYMENTS_PROVIDER=monime. Anything
 * else (or nothing) keeps today's flow, where the patient pays the pharmacy
 * directly, so this code can ship switched off.
 *
 * Test or live is decided by the access token alone (Monime has one API
 * address for both). MONIME_MODE says which one this server is meant to use,
 * and the token must match it, so a test token can never run the live site
 * and a live token can never run a test machine.
 */

export type MonimeMode = "test" | "live";

export interface MonimeConfig {
  mode: MonimeMode;
  accessToken: string;
  spaceId: string;
  apiVersion: string;
  baseUrl: string;
  /** Where patient payments land. Monime's main account when null (test only). */
  holdingAccountId: string | null;
  /** Secret Monime sends in a custom header on every webhook. */
  webhookHeaderToken: string | null;
  /** The site's public address, for the links Monime sends patients back to. */
  publicAppUrl: string;
}

export const DEFAULT_MONIME_BASE_URL = "https://api.monime.io";
export const DEFAULT_MONIME_API_VERSION = "caph.2025-08-23";
export const MONIME_WEBHOOK_HEADER = "x-mobicare-webhook-token";

type Env = Record<string, string | undefined>;

export function monimeEnabled(env: Env = process.env): boolean {
  return (env.PAYMENTS_PROVIDER ?? "").trim().toLowerCase() === "monime";
}

/** Token prefix rule: live tokens start `mon_`, test tokens `mon_test_`. */
export function tokenMode(token: string): MonimeMode | null {
  if (token.startsWith("mon_test_")) return "test";
  if (token.startsWith("mon_")) return "live";
  return null;
}

/**
 * The validated settings, or null when Monime is switched off. Throws with a
 * plain message when it is switched on but misconfigured: better the server
 * refuses to start than takes payments the wrong way.
 */
export function loadMonimeConfig(env: Env = process.env): MonimeConfig | null {
  if (!monimeEnabled(env)) return null;
  const problems: string[] = [];
  const production = env.NODE_ENV === "production";

  const mode = (env.MONIME_MODE ?? "").trim().toLowerCase();
  if (mode !== "test" && mode !== "live") {
    problems.push("MONIME_MODE must be 'test' or 'live'");
  }

  const accessToken = (env.MONIME_ACCESS_TOKEN ?? "").trim();
  const actualMode = tokenMode(accessToken);
  if (!accessToken) problems.push("MONIME_ACCESS_TOKEN is missing");
  else if (!actualMode) problems.push("MONIME_ACCESS_TOKEN is not a Monime token");
  else if ((mode === "test" || mode === "live") && actualMode !== mode) {
    problems.push(
      `MONIME_ACCESS_TOKEN is a ${actualMode} token but MONIME_MODE is ${mode}`,
    );
  }

  const spaceId = (env.MONIME_SPACE_ID ?? "").trim();
  if (!/^spc-[A-Za-z0-9]+$/.test(spaceId)) {
    problems.push("MONIME_SPACE_ID must look like spc-...");
  }

  // Pointing at another address is for the local fake Monime only.
  let baseUrl = DEFAULT_MONIME_BASE_URL;
  const override = (env.MONIME_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (override && override !== DEFAULT_MONIME_BASE_URL) {
    if (production) {
      problems.push("MONIME_BASE_URL can only be changed outside production");
    } else {
      baseUrl = override;
    }
  }

  const holdingAccountId = (env.MONIME_HOLDING_ACCOUNT_ID ?? "").trim() || null;
  if (mode === "live" && !holdingAccountId) {
    problems.push("MONIME_HOLDING_ACCOUNT_ID is required in live mode");
  }

  const webhookHeaderToken = (env.MONIME_WEBHOOK_HEADER_TOKEN ?? "").trim() || null;
  if (webhookHeaderToken && webhookHeaderToken.length < 32) {
    problems.push("MONIME_WEBHOOK_HEADER_TOKEN must be at least 32 characters");
  }
  if (production && !webhookHeaderToken) {
    problems.push("MONIME_WEBHOOK_HEADER_TOKEN is required in production");
  }

  const publicAppUrl = (env.PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+/.test(publicAppUrl)) {
    problems.push("PUBLIC_APP_URL must be the site's address, e.g. https://mobicaresl.com");
  } else if (production && !publicAppUrl.startsWith("https://")) {
    problems.push("PUBLIC_APP_URL must use https in production");
  }

  if (problems.length > 0) {
    throw new Error(`Monime payments are misconfigured: ${problems.join("; ")}.`);
  }

  return {
    mode: mode as MonimeMode,
    accessToken,
    spaceId,
    apiVersion: (env.MONIME_API_VERSION ?? "").trim() || DEFAULT_MONIME_API_VERSION,
    baseUrl,
    holdingAccountId,
    webhookHeaderToken,
    publicAppUrl,
  };
}

let cached: MonimeConfig | null | undefined;

/** The settings for this process (read on first use). */
export function monimeConfig(): MonimeConfig | null {
  if (cached === undefined) cached = loadMonimeConfig();
  return cached;
}

/** Tests only. */
export function resetMonimeConfigCache(): void {
  cached = undefined;
}
