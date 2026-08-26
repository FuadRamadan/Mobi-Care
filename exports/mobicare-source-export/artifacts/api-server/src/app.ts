import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

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
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
      : true, // allow all origins in development; set ALLOWED_ORIGINS in production
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

app.use("/api", router);

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
