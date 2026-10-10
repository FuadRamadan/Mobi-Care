import type { MonimeConfig } from "./config.js";

/**
 * A small client for the parts of Monime's API that MobiCare uses.
 *
 * - Every call sends the Space ID and a pinned API version.
 * - A request body is serialised once and re-sent byte for byte on retry,
 *   because Monime only honours an idempotency key for identical requests.
 * - Retries happen only where they are safe: reads, and writes that carry an
 *   idempotency key. They follow 5xx answers, timeouts, network errors and
 *   429 (waiting at least Retry-After). Monime does not cache errors, so the
 *   same key is reused.
 * - The access token is never logged or put in an error message.
 */

export interface MonimeAmount {
  currency: string;
  value: number;
}

export interface MonimeLineItem {
  type: "custom";
  name: string;
  price: MonimeAmount;
  quantity: number;
  reference?: string;
  description?: string;
}

export interface CreateCheckoutSessionBody {
  name: string;
  description?: string;
  reference: string;
  successUrl: string;
  cancelUrl: string;
  financialAccountId?: string;
  lineItems: MonimeLineItem[];
  brandingOptions?: { primaryColor: string };
  metadata: Record<string, string>;
}

export interface MonimeCheckoutSession {
  id: string;
  status: "pending" | "completed" | "cancelled" | "expired" | string;
  orderNumber?: string | null;
  reference?: string | null;
  redirectUrl?: string | null;
  financialAccountId?: string | null;
  expireTime?: string | null;
  metadata?: Record<string, string> | null;
  lineItems?: { data?: MonimeLineItem[] | null } | null;
}

export interface MonimePayment {
  id: string;
  status: "pending" | "processing" | "completed" | string;
  amount: MonimeAmount;
  channel?: { type?: string; provider?: string; scheme?: string } | null;
  reference?: string | null;
  orderNumber?: string | null;
  financialAccountId?: string | null;
  fees?: { code?: string; amount?: MonimeAmount }[] | null;
  metadata?: Record<string, string> | null;
}

export interface MonimeFinancialAccount {
  id: string;
  name?: string;
  currency?: string;
  reference?: string | null;
  balance?: { available?: MonimeAmount | null } | null;
  metadata?: Record<string, string> | null;
}

export interface CreateFinancialAccountBody {
  name: string;
  currency: "SLE";
  reference: string;
  metadata: Record<string, string>;
}

export interface MonimeFailure {
  code?: string | null;
  message?: string | null;
}

export interface MonimeInternalTransfer {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | string;
  amount: MonimeAmount;
  sourceFinancialAccount?: { id?: string } | null;
  destinationFinancialAccount?: { id?: string } | null;
  failureDetail?: MonimeFailure | null;
  metadata?: Record<string, string> | null;
}

export interface CreateInternalTransferBody {
  amount: MonimeAmount;
  sourceFinancialAccount: { id: string };
  destinationFinancialAccount: { id: string };
  metadata: Record<string, string>;
}

export interface MonimePayout {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | string;
  amount: MonimeAmount;
  source?: { financialAccountId?: string } | null;
  destination?: { type?: string; providerId?: string; phoneNumber?: string } | null;
  fees?: { code?: string; amount?: MonimeAmount }[] | null;
  failureDetail?: MonimeFailure | null;
  metadata?: Record<string, string> | null;
}

export interface CreatePayoutBody {
  amount: MonimeAmount;
  source: { financialAccountId: string };
  destination: { type: "momo"; providerId: "m17" | "m18"; phoneNumber: string };
  metadata: Record<string, string>;
}

export interface MonimeRoot {
  status?: { environment?: string | null; isAuthenticated?: boolean };
  apiVersion?: { id?: string; deprecated?: boolean } | null;
}

export interface MonimeResult<T> {
  result: T;
  requestId: string | null;
  /** True when Monime replayed an earlier identical request (header Monime-Cache: irc). */
  replayed: boolean;
  /** For a list: the cursor of the next page (pass as `after`), null on the last page. */
  next?: string | null;
}

/** Pages of 50 (Monime's most): 100 pages is 5,000 accounts. */
const ACCOUNT_PAGE_SIZE = 50;
const MAX_ACCOUNT_PAGES = 100;

export class MonimeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | null,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "MonimeError";
  }

  /** The request reached Monime and was refused for good: don't retry it. */
  get isFinal(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  query?: Record<string, string | undefined>;
}

export interface MonimeClientDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Attempts in total for a retryable failure. */
  maxAttempts?: number;
  timeoutMs?: number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createMonimeClient(config: MonimeConfig, deps: MonimeClientDeps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? realSleep;
  const maxAttempts = deps.maxAttempts ?? 3;
  const timeoutMs = deps.timeoutMs ?? 20_000;

  async function request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    options: RequestOptions = {},
  ): Promise<MonimeResult<T>> {
    const url = new URL(path, `${config.baseUrl}/`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.accessToken}`,
      "Monime-Space-Id": config.spaceId,
      "Monime-Version": config.apiVersion,
      Accept: "application/json",
    };
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
    // A POST without a key is never retried: it could create something twice.
    const retryable = method !== "POST" || Boolean(options.idempotencyKey);

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await doFetch(url, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastError = new MonimeError(
          `Could not reach Monime (${(err as Error)?.name ?? "network error"})`,
          0,
          "network_error",
          null,
        );
        if (!retryable || attempt === maxAttempts) throw lastError;
        await sleep(backoffMs(attempt));
        continue;
      }

      const requestId = response.headers.get("monime-request-id");
      const text = await response.text();
      let parsed: any = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }

      if (response.ok) {
        return {
          result: (parsed && "result" in parsed ? parsed.result : parsed) as T,
          requestId,
          replayed: response.headers.get("monime-cache") === "irc",
          next: parsed?.pagination?.next ?? null,
        };
      }

      const reason: string | null = parsed?.error?.reason ?? null;
      const message: string =
        parsed?.error?.message ?? `Monime answered ${response.status}`;
      lastError = new MonimeError(message, response.status, reason, requestId);
      const temporary = response.status === 429 || response.status >= 500;
      if (!temporary || !retryable || attempt === maxAttempts) throw lastError;
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs =
        response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 30) * 1000 + jitterMs()
          : backoffMs(attempt);
      await sleep(waitMs);
    }
    throw lastError;
  }

  return {
    /** Who Monime thinks we are: environment, API version. */
    root: () => request<MonimeRoot>("GET", "/"),
    createCheckoutSession: (body: CreateCheckoutSessionBody, key: string) =>
      request<MonimeCheckoutSession>("POST", "/v1/checkout-sessions", {
        body,
        idempotencyKey: key,
      }),
    getCheckoutSession: (id: string) =>
      request<MonimeCheckoutSession>("GET", `/v1/checkout-sessions/${encodeURIComponent(id)}`),
    deleteCheckoutSession: (id: string) =>
      request<unknown>("DELETE", `/v1/checkout-sessions/${encodeURIComponent(id)}`),
    listPaymentsByOrderNumber: (orderNumber: string) =>
      request<MonimePayment[]>("GET", "/v1/payments", { query: { orderNumber, limit: "10" } }),
    getPayment: (id: string) =>
      request<MonimePayment>("GET", `/v1/payments/${encodeURIComponent(id)}`),

    // Phase 2: pharmacy accounts, releasing money, cash-outs.
    createFinancialAccount: (body: CreateFinancialAccountBody, key: string) =>
      request<MonimeFinancialAccount>("POST", "/v1/financial-accounts", { body, idempotencyKey: key }),
    /**
     * Accounts whose reference is exactly `reference`. Monime ignores the
     * `reference` filter on this list (seen live, 9 Oct 2026: an existing
     * reference came back as an empty list), so this pages through the
     * accounts and matches here. The filter is still sent, in case Monime
     * starts honouring it. Refuses rather than answer "none" if there are
     * more accounts than it will read: a wrong "none" would create a second
     * account.
     */
    findFinancialAccountsByReference: async (reference: string): Promise<MonimeResult<MonimeFinancialAccount[]>> => {
      const matches: MonimeFinancialAccount[] = [];
      let after: string | undefined;
      for (let page = 0; page < MAX_ACCOUNT_PAGES; page += 1) {
        const listed = await request<MonimeFinancialAccount[]>("GET", "/v1/financial-accounts", {
          query: { reference, limit: String(ACCOUNT_PAGE_SIZE), after },
        });
        matches.push(...(listed.result ?? []).filter((account) => account.reference === reference));
        if (matches.length > 0 || !listed.next) {
          return { result: matches, requestId: listed.requestId, replayed: false, next: null };
        }
        after = listed.next;
      }
      throw new MonimeError(
        `More than ${MAX_ACCOUNT_PAGES * ACCOUNT_PAGE_SIZE} financial accounts: cannot search them all by reference`,
        0,
        "too_many_accounts",
        null,
      );
    },
    getFinancialAccount: (id: string, withBalance = false) =>
      request<MonimeFinancialAccount>("GET", `/v1/financial-accounts/${encodeURIComponent(id)}`, {
        query: withBalance ? { withBalance: "true" } : {},
      }),
    createInternalTransfer: (body: CreateInternalTransferBody, key: string) =>
      request<MonimeInternalTransfer>("POST", "/v1/internal-transfers", { body, idempotencyKey: key }),
    getInternalTransfer: (id: string) =>
      request<MonimeInternalTransfer>("GET", `/v1/internal-transfers/${encodeURIComponent(id)}`),
    createPayout: (body: CreatePayoutBody, key: string) =>
      request<MonimePayout>("POST", "/v1/payouts", { body, idempotencyKey: key }),
    getPayout: (id: string) =>
      request<MonimePayout>("GET", `/v1/payouts/${encodeURIComponent(id)}`),
  };
}

export type MonimeClient = ReturnType<typeof createMonimeClient>;

function jitterMs(): number {
  return Math.floor(Math.random() * 400);
}

function backoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 500, 8_000) + jitterMs();
}
