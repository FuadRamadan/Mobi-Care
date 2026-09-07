/**
 * Security headers and rate limiting, exercised through a real Express app and
 * real HTTP requests.
 *
 * The trust-proxy cases matter most. Rate limiting keys on the client address,
 * and getting that wrong fails in one of two ways that both look like working
 * software: trust too little and every request appears to come from the proxy,
 * so one attacker locks out every user; trust too much and the client can spoof
 * X-Forwarded-For, so nobody is ever limited.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express, { type Express } from "express";
import {
  authRateLimit,
  configureTrustProxy,
  globalRateLimit,
  securityHeaders,
} from "./security.js";

/** Build an app, run one request through it in-process, return the response. */
async function once(
  app: Express,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const server = app.listen(0);
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  } finally {
    server.close();
  }
}

/** Fire n requests against one long-lived server so limiter state accumulates. */
async function burst(
  app: Express,
  path: string,
  count: number,
  headers: Record<string, string> = {},
): Promise<number[]> {
  const server = app.listen(0);
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const statuses: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
      statuses.push(response.status);
    }
    return statuses;
  } finally {
    server.close();
  }
}

function appWithLimiter(limiter: express.RequestHandler, hops = 0): Express {
  const app = express();
  const previous = process.env["TRUST_PROXY_HOPS"];
  process.env["TRUST_PROXY_HOPS"] = String(hops);
  configureTrustProxy(app);
  if (previous === undefined) delete process.env["TRUST_PROXY_HOPS"];
  else process.env["TRUST_PROXY_HOPS"] = previous;

  app.use(limiter);
  app.get("/x", (_req, res) => {
    res.json({ ok: true });
  });
  app.post("/x", (_req, res) => {
    res.status(401).json({ error: "nope" });
  });
  return app;
}

test("security headers are set and the server is not advertised", async () => {
  const app = express();
  app.use(securityHeaders());
  app.get("/x", (_req, res) => {
    res.json({ ok: true });
  });

  const response = await once(app, "/x");

  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(
    response.headers.get("strict-transport-security") ?? "",
    /max-age=31536000/,
  );
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(response.headers.get("x-powered-by"), null);
  // Images must remain embeddable from the gateway and portal origins.
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "cross-origin",
  );
});

test("no Content-Security-Policy is sent — this process serves no HTML", () => {
  // Recorded as an intentional choice rather than an oversight.
  const app = express();
  app.use(securityHeaders());
  app.get("/x", (_req, res) => {
    res.json({ ok: true });
  });

  return once(app, "/x").then((response) => {
    assert.equal(response.headers.get("content-security-policy"), null);
  });
});

test("the global limiter caps a burst and reports the limit", async () => {
  const previous = process.env["RATE_LIMIT_GLOBAL_PER_MINUTE"];
  process.env["RATE_LIMIT_GLOBAL_PER_MINUTE"] = "3";
  try {
    const app = appWithLimiter(globalRateLimit());
    const statuses = await burst(app, "/x", 5);

    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);

    const blocked = await once(app, "/x");
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), {
      error: "Too many requests — please slow down and try again.",
    });
    assert.ok(
      blocked.headers.get("ratelimit") ?? blocked.headers.get("ratelimit-limit"),
      "should advertise the limit so clients can back off",
    );
  } finally {
    if (previous === undefined) delete process.env["RATE_LIMIT_GLOBAL_PER_MINUTE"];
    else process.env["RATE_LIMIT_GLOBAL_PER_MINUTE"] = previous;
  }
});

test("the auth limiter counts failures but not successes", async () => {
  const previous = process.env["RATE_LIMIT_AUTH_PER_15_MIN"];
  process.env["RATE_LIMIT_AUTH_PER_15_MIN"] = "3";
  try {
    // GET /x returns 200 here; successful requests must not consume budget, so
    // a legitimate user signing in repeatedly is never locked out.
    const successes = await burst(appWithLimiter(authRateLimit()), "/x", 6);
    assert.deepEqual(successes, [200, 200, 200, 200, 200, 200]);

    // POST /x returns 401 — failures do accumulate.
    const app = appWithLimiter(authRateLimit());
    const server = app.listen(0);
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const response = await fetch(`http://127.0.0.1:${port}/x`, { method: "POST" });
        statuses.push(response.status);
      }
      assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
    } finally {
      server.close();
    }
  } finally {
    if (previous === undefined) delete process.env["RATE_LIMIT_AUTH_PER_15_MIN"];
    else process.env["RATE_LIMIT_AUTH_PER_15_MIN"] = previous;
  }
});

test("a spoofed X-Forwarded-For cannot evade the limit when no proxy is trusted", async () => {
  const previous = process.env["RATE_LIMIT_GLOBAL_PER_MINUTE"];
  process.env["RATE_LIMIT_GLOBAL_PER_MINUTE"] = "2";
  try {
    const app = appWithLimiter(globalRateLimit(), 0);
    const server = app.listen(0);
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const statuses: number[] = [];
      // A fresh forged address each time. With zero trusted hops these are
      // ignored, so every request keys to the same real client.
      for (let i = 0; i < 4; i += 1) {
        const response = await fetch(`http://127.0.0.1:${port}/x`, {
          headers: { "x-forwarded-for": `203.0.113.${i}` },
        });
        statuses.push(response.status);
      }
      assert.deepEqual(statuses, [200, 200, 429, 429]);
    } finally {
      server.close();
    }
  } finally {
    if (previous === undefined) delete process.env["RATE_LIMIT_GLOBAL_PER_MINUTE"];
    else process.env["RATE_LIMIT_GLOBAL_PER_MINUTE"] = previous;
  }
});

test("distinct clients behind a trusted proxy get their own budgets", async () => {
  const previous = process.env["RATE_LIMIT_GLOBAL_PER_MINUTE"];
  process.env["RATE_LIMIT_GLOBAL_PER_MINUTE"] = "2";
  try {
    // One proxy hop trusted: the left-most forwarded address is the client.
    const app = appWithLimiter(globalRateLimit(), 1);
    const server = app.listen(0);
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const get = (ip: string) =>
        fetch(`http://127.0.0.1:${port}/x`, { headers: { "x-forwarded-for": ip } });

      assert.equal((await get("203.0.113.1")).status, 200);
      assert.equal((await get("203.0.113.1")).status, 200);
      assert.equal((await get("203.0.113.1")).status, 429);

      // A different client must be unaffected by the first one's exhaustion —
      // otherwise one abuser takes the whole service down.
      assert.equal((await get("198.51.100.7")).status, 200);
    } finally {
      server.close();
    }
  } finally {
    if (previous === undefined) delete process.env["RATE_LIMIT_GLOBAL_PER_MINUTE"];
    else process.env["RATE_LIMIT_GLOBAL_PER_MINUTE"] = previous;
  }
});

test("trust proxy rejects a nonsense hop count rather than guessing", () => {
  const previous = process.env["TRUST_PROXY_HOPS"];
  process.env["TRUST_PROXY_HOPS"] = "yes";
  try {
    assert.throws(
      () => configureTrustProxy(express()),
      /TRUST_PROXY_HOPS must be a non-negative integer/,
    );
  } finally {
    if (previous === undefined) delete process.env["TRUST_PROXY_HOPS"];
    else process.env["TRUST_PROXY_HOPS"] = previous;
  }
});
