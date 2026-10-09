import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import pinoHttp from "pino-http";
import router from "./routes";
import { recordSecurityEvent } from "./lib/securityEvents";
import { logger } from "./lib/logger";
import { mountStaticSites } from "./lib/staticSites";
import { mountMonimeWebhook } from "./routes/monimeWebhook";
import {
  AUTH_RATE_LIMITED_PATHS,
  authRateLimit,
  configureTrustProxy,
  globalRateLimit,
  securityHeaders,
} from "./lib/security";

const app: Express = express();

// Must precede the rate limiters: they key on req.ip, which is only the real
// client address once Express knows how many proxies sit in front.
configureTrustProxy(app);

const configuredOrigins = process.env.ALLOWED_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

if (process.env.NODE_ENV === "production" && !configuredOrigins?.length) {
  throw new Error("ALLOWED_ORIGINS is required in production");
}

app.use(securityHeaders());
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin: configuredOrigins?.length ? configuredOrigins : true,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
// Monime's webhook needs the raw body, so it is mounted before the JSON
// parser. Server-to-server: no CORS or browser session involved.
mountMonimeWebhook(app);

// Patient prescription and profile-photo uploads carry a base64 image — allow
// a larger body on those paths only (mounted before the default parser;
// already-parsed bodies are skipped by the second parser). A 5 MB image is
// about 6.7 MB once base64-encoded.
app.use("/api/patient/uploads", express.json({ limit: "8mb" }));
app.use("/api/patient/profile/photo", express.json({ limit: "8mb" }));
// Spreadsheet uploads: a 5 MB file is about 6.7 MB once base64-encoded.
app.use("/api/pharmacy/inventory/import", express.json({ limit: "8mb" }));
app.use("/api/hq/pharmacies/:pharmacyId/inventory/import", express.json({ limit: "8mb" }));
app.use("/api/hq/drugs/import", express.json({ limit: "8mb" }));
// Browsers send policy-violation reports with their own content types.
app.use(
  "/api/security/csp-report",
  express.json({ type: ["application/csp-report", "application/reports+json", "application/json"], limit: "16kb" }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// For uptime monitors: answers 200 only when the database answers too, so an
// outage that leaves the process running but unable to serve is still caught.
app.get("/api/health/ready", async (_req, res) => {
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5_000)),
    ]);
    res.json({ status: "ok", database: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable", database: "unreachable" });
  }
});

app.use("/api", globalRateLimit());
for (const path of AUTH_RATE_LIMITED_PATHS) {
  app.use(`/api${path}`, authRateLimit());
}

app.use("/api", router);

// Anything under /api that no route handled is a JSON 404. Without this it
// falls through to the root site below, whose SPA fallback would answer an
// unknown API path with 200 and an HTML page.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// After the API, so /api always wins over the root site's SPA fallback.
// No-op unless SERVE_STATIC_DIR is set.
export const mountedStaticSites: string[] = mountStaticSites(app);

const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  req.log?.error({ err: error }, "Unhandled API error");

  if (res.headersSent) {
    next(error);
    return;
  }

  // The body parser rejects oversized or malformed requests before any route
  // runs. Those are the client's to fix, so say what went wrong instead of
  // reporting a server fault.
  const type = (error as { type?: unknown })?.type;
  if (type === "entity.too.large") {
    res.status(413).json({ error: "The upload is too large." });
    return;
  }
  if (type === "entity.parse.failed") {
    res.status(400).json({ error: "The request body is not valid JSON." });
    return;
  }

  void recordSecurityEvent({
    kind: "server_error",
    ipAddress: req.ip,
    path: req.originalUrl.split("?")[0],
    details: { method: req.method },
  });
  res.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);

export default app;
