/**
 * Transport-level protections: security response headers, client trust, and
 * request rate limits.
 *
 * On the previous host these were provided by the platform edge. Running the
 * API directly behind an ordinary reverse proxy makes them the application's
 * responsibility.
 */

import type { Express, RequestHandler } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import helmet from "helmet";

/**
 * Response headers.
 *
 * Content-Security-Policy is switched off: this process serves JSON and image
 * bytes, never HTML, so a policy here would protect nothing while making the
 * headers harder to reason about. The gateway and portal are static sites and
 * carry their own policy at the web server.
 *
 * HSTS is set here as well as (not instead of) at the proxy, so the guarantee
 * survives a proxy misconfiguration.
 */
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: false,
    // Images are served to <img> tags on the gateway and portal origins, which
    // the default "same-origin" would block.
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
      maxAge: 31_536_000, // one year
      includeSubDomains: true,
      preload: false,
    },
    referrerPolicy: { policy: "no-referrer" },
  });
}

/**
 * Tell Express how many proxies sit in front of the process, so `req.ip` is the
 * real client address.
 *
 * This is load-bearing for rate limiting, and wrong in both directions:
 *
 *   Too low  — every request appears to come from the proxy, so all clients
 *              share one bucket and a single attacker locks out every user.
 *   Too high — X-Forwarded-For can be spoofed by the client, so an attacker
 *              rotates fake addresses and is never limited at all.
 *
 * Hence an exact hop count rather than `true`. Default 1, the usual single
 * reverse proxy; set TRUST_PROXY_HOPS if the real topology differs. In
 * development there is normally no proxy at all.
 */
export function configureTrustProxy(app: Express): void {
  const configured = process.env["TRUST_PROXY_HOPS"];
  const hops = configured !== undefined
    ? Number(configured)
    : process.env["NODE_ENV"] === "production"
      ? 1
      : 0;

  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error(
      `TRUST_PROXY_HOPS must be a non-negative integer, received "${configured}".`,
    );
  }

  app.set("trust proxy", hops);
}

/**
 * Key requests by client address.
 *
 * Uses express-rate-limit's own IP helper, which normalises IPv6 to a /64
 * subnet — a single client is routinely handed many addresses in a /64, and
 * keying on the full address would let one host trivially sidestep the limit.
 */
const byIp = (req: { ip?: string | undefined }): string => ipKeyGenerator(req.ip ?? "");

const jsonError = (message: string): RequestHandler =>
  ((_req, res) => {
    res.status(429).json({ error: message });
  }) as RequestHandler;

/**
 * Broad ceiling for ordinary traffic.
 *
 * Set well above what the patient app, portal and HQ dashboard generate in
 * normal use — this exists to blunt scraping and accidental request storms, not
 * to shape legitimate behaviour.
 */
export function globalRateLimit(): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: Number(process.env["RATE_LIMIT_GLOBAL_PER_MINUTE"] ?? 300),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: byIp,
    handler: jsonError("Too many requests — please slow down and try again."),
  });
}

/**
 * Tight limit for credential endpoints.
 *
 * Login, registration and password reset are the endpoints worth guessing
 * against, and none of them is called repeatedly in normal use. Successful
 * requests are not counted, so someone signing in and out legitimately is never
 * locked out — only repeated failures accumulate.
 */
export function authRateLimit(): RequestHandler {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: Number(process.env["RATE_LIMIT_AUTH_PER_15_MIN"] ?? 10),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: byIp,
    handler: jsonError(
      "Too many attempts. Please wait a few minutes before trying again.",
    ),
  });
}

/**
 * Credential paths the strict limit applies to, relative to the /api mount.
 *
 * /auth/refresh and /auth/logout are deliberately excluded: both are called on
 * a schedule by every signed-in client, and neither is a guessing target — a
 * refresh token is a 48-byte random value, not something to brute force.
 */
export const AUTH_RATE_LIMITED_PATHS = [
  "/auth/login",
  "/auth/register",
  "/auth/change-password",
  "/auth/patient-password-reset/request",
  "/auth/patient-password-reset/confirm",
];
