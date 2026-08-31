import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertSmsConfiguration,
  createSmsSender,
  normalizeSierraLeonePhone,
  SmsConfigurationError,
  SmsDeliveryError,
} from "./sms.js";

const env = {
  NODE_ENV: "production",
  SMS_TRANSPORT: "orange",
  ORANGE_SMS_CLIENT_ID: "client",
  ORANGE_SMS_CLIENT_SECRET: "secret",
  ORANGE_SMS_SENDER_ADDRESS: "2320000",
  ORANGE_SMS_SENDER_NAME: "MobiCare",
  ORANGE_SMS_TIMEOUT_MS: "100",
} as NodeJS.ProcessEnv;

test("normalizes supported Sierra Leone phone formats", () => {
  for (const value of ["+23276123456", "0023276123456", "23276123456", "076123456", "76123456"]) {
    assert.equal(normalizeSierraLeonePhone(value), "+23276123456");
  }
  assert.throws(() => normalizeSierraLeonePhone("+23376123456"), SmsDeliveryError);
});

test("production cannot use test transport or omit Orange configuration", () => {
  assert.throws(() => assertSmsConfiguration({ NODE_ENV: "production", SMS_TRANSPORT: "test" }), SmsConfigurationError);
  assert.throws(() => assertSmsConfiguration({ NODE_ENV: "production" }), SmsConfigurationError);
  assert.throws(() => assertSmsConfiguration({ SMS_TRANSPORT: "test" }), SmsConfigurationError);
  assert.throws(() => assertSmsConfiguration({ NODE_ENV: "development" }), SmsConfigurationError);
  assert.throws(
    () => assertSmsConfiguration({ ...env, NODE_ENV: "development" }),
    SmsConfigurationError,
  );
  assert.throws(
    () => assertSmsConfiguration({ ...env, NODE_ENV: "test" }),
    SmsConfigurationError,
  );
});

test("sends through Orange and reuses a fresh token", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/oauth/v3/token")) {
      return Response.json({ access_token: "token", expires_in: 3600 });
    }
    return Response.json(
      { outboundSMSMessageRequest: { resourceURL: "https://api.orange.com/requests/message-1" } },
      { status: 201 },
    );
  };
  const send = createSmsSender({ env, fetch: fakeFetch as typeof fetch });
  const first = await send("076123456", "secret body");
  await send("+23276123456", "another secret");
  assert.equal(first.providerMessageId, "message-1");
  assert.equal(requests.filter(({ url }) => url.endsWith("/oauth/v3/token")).length, 1);
  assert.equal(
    requests[0]!.init!.headers && (requests[0]!.init!.headers as Record<string, string>).Authorization,
    `Basic ${Buffer.from("client:secret").toString("base64")}`,
  );
  assert.equal(requests[0]!.init!.body, "grant_type=client_credentials");
  assert.ok(requests[1]!.url.endsWith("/outbound/tel%3A%2B2320000/requests"));
  const sent = JSON.parse(String(requests[1]!.init!.body));
  assert.equal(sent.outboundSMSMessageRequest.address, "tel:+23276123456");
  assert.equal(sent.outboundSMSMessageRequest.senderAddress, "tel:+2320000");
  assert.equal(sent.outboundSMSMessageRequest.senderName, "MobiCare");
  assert.match(sent.outboundSMSMessageRequest.clientCorrelator, /^[a-f0-9]{32}$/);
});

test("refreshes a token inside the one-minute expiry skew", async () => {
  let currentTime = 1_000_000;
  let tokens = 0;
  const fakeFetch = async (input: string | URL | Request) => {
    if (String(input).endsWith("/oauth/v3/token")) {
      tokens += 1;
      return Response.json({ access_token: `token-${tokens}`, expires_in: 120 });
    }
    return Response.json({}, { status: 201 });
  };
  const send = createSmsSender({ env, fetch: fakeFetch as typeof fetch, now: () => currentTime });
  await send("+23276123456", "first");
  currentTime += 61_000;
  await send("+23276123456", "second");
  assert.equal(tokens, 2);
});

test("refreshes and retries once after an expired token", async () => {
  let tokens = 0;
  let sends = 0;
  const fakeFetch = async (input: string | URL | Request) => {
    if (String(input).endsWith("/oauth/v3/token")) {
      tokens += 1;
      return Response.json({ access_token: `token-${tokens}`, expires_in: 3600 });
    }
    sends += 1;
    return sends === 1
      ? Response.json({ message: "Expired credentials" }, { status: 401 })
      : Response.json({}, { status: 201 });
  };
  await createSmsSender({ env, fetch: fakeFetch as typeof fetch })("+23276123456", "body");
  assert.equal(tokens, 2);
  assert.equal(sends, 2);
});

test("deduplicates concurrent refreshes after provider 401 responses", async () => {
  let tokens = 0;
  let oldTokenSends = 0;
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/oauth/v3/token")) {
      tokens += 1;
      if (tokens === 2) await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({ access_token: `token-${tokens}`, expires_in: 3600 });
    }
    const authorization = (init?.headers as Record<string, string>).Authorization;
    if (authorization === "Bearer token-1") {
      oldTokenSends += 1;
      return Response.json({ message: "Expired credentials" }, { status: 401 });
    }
    return Response.json({}, { status: 201 });
  };
  const send = createSmsSender({ env, fetch: fakeFetch as typeof fetch });
  await Promise.all([
    send("+23276123456", "first"),
    send("+23276123457", "second"),
    send("+23276123458", "third"),
  ]);
  assert.equal(oldTokenSends, 3);
  assert.equal(tokens, 2);
});

test("maps provider rejection without retaining sensitive provider text", async () => {
  const fakeFetch = async (input: string | URL | Request) =>
    String(input).endsWith("/oauth/v3/token")
      ? Response.json({ access_token: "token", expires_in: 3600 })
      : Response.json({ message: "SMS bundle balance exhausted: private detail" }, { status: 403 });
  await assert.rejects(
    createSmsSender({ env, fetch: fakeFetch as typeof fetch })("+23276123456", "verification code 123456"),
    (error: unknown) =>
      error instanceof SmsDeliveryError &&
      error.code === "SMS_BUNDLE_EXHAUSTED" &&
      !error.message.includes("123456") &&
      !error.message.includes("private"),
  );
});

test("turns request aborts into a safe timeout error", async () => {
  const fakeFetch = (_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  await assert.rejects(
    createSmsSender({ env, fetch: fakeFetch as typeof fetch })("+23276123456", "body"),
    (error: unknown) => error instanceof SmsDeliveryError && error.code === "SMS_TIMEOUT",
  );
});

test("explicit development test transport does not call the network", async () => {
  const send = createSmsSender({
    env: { NODE_ENV: "development", SMS_TRANSPORT: "test" },
    fetch: (() => { throw new Error("network called"); }) as typeof fetch,
  });
  assert.equal((await send("not-a-real-number", "not delivered")).transport, "test");
});