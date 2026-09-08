import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import pg from "pg";
import * as schema from "./schema";
import { selectDriver } from "./driver";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const choice = selectDriver({
  configured: process.env["DATABASE_DRIVER"],
  connectionString,
});

/**
 * The pool, and the Drizzle instance over it.
 *
 * Both drivers expose the same surface the application uses — `query`,
 * `connect`, `end`, and interactive transactions — so nothing downstream knows
 * or cares which one is open. See driver.ts for why there are two.
 */
function open() {
  if (choice.driver === "neon") {
    // Node has no global WebSocket the driver can use, so it is given one.
    // Without this the connection fails with "all attempts to open a WebSocket
    // failed", which does not point at the cause.
    neonConfig.webSocketConstructor = ws;

    // Development only: point the driver at a local WebSocket-to-TCP proxy
    // (deploy/local/ws-proxy.mjs) so the whole application can be run on the
    // production driver against an ordinary local PostgreSQL. Neon documents
    // wsProxy for exactly this.
    //
    // Ignored in production, deliberately: it also turns off the transport
    // hardening that only makes sense against Neon's own endpoint, and that is
    // not something an environment variable should be able to do to a live
    // deployment.
    const devProxy = process.env["NEON_WS_PROXY"];
    if (devProxy && process.env["NODE_ENV"] !== "production") {
      neonConfig.wsProxy = (host, port) => `${devProxy}/v1?address=${host}:${port}`;
      neonConfig.useSecureWebSocket = false;
      neonConfig.pipelineTLS = false;
      neonConfig.pipelineConnect = false;
    }

    const pool = new NeonPool({ connectionString });
    return { pool, db: drizzleNeon(pool, { schema }) };
  }

  const pool = new pg.Pool({ connectionString });
  return { pool, db: drizzleNodePostgres(pool, { schema }) };
}

const opened = open();

/**
 * An idle connection can die without anyone asking it to — a network blip, or
 * the database going to sleep, which is normal on a serverless PostgreSQL that
 * suspends its compute between bursts of traffic.
 *
 * Both pools emit that as an `error` event, and an EventEmitter with no `error`
 * listener throws: the whole API would exit because one pooled connection it
 * was not using went away. The pool then opens a fresh connection on the next
 * query by itself, so there is nothing to do here but record it and stay up.
 */
opened.pool.on("error", (error: Error) => {
  console.error("[db] idle connection error (the pool will reconnect):", error.message);
});

export const pool = opened.pool;
export const db = opened.db;

/** Which driver is in use, so startup can say so out loud. */
export const databaseDriver = choice;

export * from "./schema";
