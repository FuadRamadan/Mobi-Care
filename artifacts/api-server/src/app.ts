import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { mountStaticSites } from "./lib/staticSites";
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
// Patient prescription uploads carry a base64 image — allow a larger body
// on that path only (mounted before the default parser; already-parsed
// bodies are skipped by the second parser).
app.use("/api/patient/uploads", express.json({ limit: "8mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
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

  res.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);

export default app;
