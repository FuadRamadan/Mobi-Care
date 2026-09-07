/**
 * MobiCare connectivity probe.
 *
 * A throwaway app for GoDaddy Node.js Hosting that answers the one question
 * everything else depends on: can this platform reach PostgreSQL over a
 * WebSocket on port 443, given that only ports 80 and 443 are open outbound?
 *
 * It reports, in order of how much they settle:
 *
 *   1. Node version and platform          — is this the runtime we expect?
 *   2. Outbound HTTPS on 443              — baseline egress
 *   3. Outbound TCP on 5432               — expected to FAIL; confirms the
 *                                           restriction, and so confirms that
 *                                           the WebSocket path is necessary
 *   4. WebSocket handshake on 443         — the capability in question
 *   5. Neon query + interactive transaction — what MobiCare actually needs:
 *                                           payment claiming and stock
 *                                           deduction run inside a transaction
 *   6. Object storage round-trip          — writes, reads back, compares the
 *                                           bytes, checks the access policy
 *                                           survived, and exercises a
 *                                           presigned upload. Photos do not
 *                                           work unless this passes.
 *
 * Nothing here touches MobiCare's database or code. Delete the app once the
 * results are recorded.
 */

import { createServer } from "node:http";
import net from "node:net";
import { storageRoundTrip } from "./storageCheck.js";

const PORT = Number(process.env.PORT ?? 8080);
const TIMEOUT_MS = 10_000;

/** Public host used for the baseline and blocked-port checks. */
const PROBE_HTTPS_URL = process.env.PROBE_HTTPS_URL ?? "https://api.github.com/";

const started = new Date().toISOString();

const ok = (detail, extra = {}) => ({ status: "pass", detail, ...extra });
const bad = (detail, extra = {}) => ({ status: "fail", detail, ...extra });
const skip = (detail) => ({ status: "skipped", detail });

/** Time a promise, returning a failure result rather than throwing. */
async function timed(fn) {
  const start = Date.now();
  try {
    const result = await fn();
    return { ...result, ms: Date.now() - start };
  } catch (error) {
    return { ...bad(error?.message ?? String(error)), ms: Date.now() - start };
  }
}

// ── 1. Runtime ───────────────────────────────────────────────────────────────

function runtime() {
  const expected = process.version.startsWith("v22.");
  return {
    status: expected ? "pass" : "warn",
    detail: expected
      ? `Node ${process.version} — matches what the API expects.`
      : `Node ${process.version}. MobiCare's package.json requires >=22 <25; ` +
        `check this before deploying the API.`,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
  };
}

// ── 2. Outbound HTTPS on 443 ─────────────────────────────────────────────────

async function httpsEgress() {
  const response = await fetch(PROBE_HTTPS_URL, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": "mobicare-connectivity-probe" },
  });
  return ok(
    `HTTPS to ${new URL(PROBE_HTTPS_URL).host} returned ${response.status}. ` +
      `Outbound 443 works, so S3 storage and the Orange SMS API are reachable.`,
  );
}

// ── 3. Outbound TCP on 5432 ──────────────────────────────────────────────────

/** Open a raw TCP connection, resolving to whether it connected. */
function tcpConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (connected, reason) => {
      socket.destroy();
      resolve({ connected, reason });
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once("connect", () => done(true, "connected"));
    socket.once("timeout", () => done(false, "timed out"));
    socket.once("error", (error) => done(false, error.message));
  });
}

async function postgresPortBlocked(host) {
  if (!host) {
    return skip("No database host to test against — set NEON_DATABASE_URL.");
  }

  const { connected, reason } = await tcpConnect(host, 5432);
  if (connected) {
    // Not a failure — better news than expected. It means an ordinary
    // PostgreSQL connection would work and the WebSocket driver is optional.
    return {
      status: "warn",
      detail:
        `Port 5432 to ${host} is OPEN. The documented 80/443-only restriction ` +
        `does not apply here, so a standard postgres connection would work ` +
        `and the WebSocket driver is not required. Re-check before relying on it.`,
    };
  }
  return ok(
    `Port 5432 to ${host} is blocked (${reason}), as documented. This is why ` +
      `PostgreSQL has to be reached over WebSocket on 443.`,
  );
}

// ── 4. WebSocket handshake on 443 ────────────────────────────────────────────

async function websocketEgress(host) {
  if (!host) {
    return skip("No WebSocket host to test against — set NEON_DATABASE_URL.");
  }

  const WebSocketImpl = await resolveWebSocket();
  if (!WebSocketImpl) {
    return bad("No WebSocket implementation available in this runtime.");
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    // Neon's endpoint speaks the Postgres protocol over the socket. We are only
    // proving the platform lets a wss:// connection on 443 be established — the
    // real query test below proves the protocol works.
    const socket = new WebSocketImpl(`wss://${host}/v2`);
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      finish(bad(`No WebSocket response from ${host} within ${TIMEOUT_MS}ms.`));
    }, TIMEOUT_MS);

    socket.onopen = () => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      finish(
        ok(
          `WebSocket connection to wss://${host} on 443 was established. ` +
            `This is the capability the whole database plan depends on.`,
        ),
      );
    };

    socket.onerror = (event) => {
      clearTimeout(timer);
      finish(
        bad(
          `WebSocket to wss://${host} failed: ${event?.message ?? "connection refused or blocked"}. ` +
            `If this fails, PostgreSQL cannot be reached from this host and the ` +
            `options narrow to a VPS or another host for the API.`,
        ),
      );
    };
  });
}

/** Prefer the ws package; fall back to the runtime's own WebSocket. */
async function resolveWebSocket() {
  try {
    const ws = await import("ws");
    return ws.default ?? ws.WebSocket;
  } catch {
    return typeof WebSocket === "function" ? WebSocket : null;
  }
}

// ── 5. Neon query and interactive transaction ────────────────────────────────

async function neonQuery(connectionString) {
  if (!connectionString) {
    return skip(
      "NEON_DATABASE_URL is not set. Create a free Neon project and set it to " +
        "run the test that actually matters.",
    );
  }

  const { neonConfig, Pool } = await import("@neondatabase/serverless");
  const WebSocketImpl = await resolveWebSocket();
  if (WebSocketImpl) neonConfig.webSocketConstructor = WebSocketImpl;

  const pool = new Pool({ connectionString });
  try {
    const { rows } = await pool.query("SELECT 1 AS one, version() AS version");
    if (rows[0]?.one !== 1) {
      return bad("Query returned an unexpected result.");
    }

    // MobiCare claims payment and deducts stock inside db.transaction(), so a
    // driver that cannot hold an interactive transaction is not usable here.
    const client = await pool.connect();
    let transactionOk = false;
    try {
      await client.query("BEGIN");
      await client.query("SELECT 1");
      await client.query("COMMIT");
      transactionOk = true;
    } finally {
      client.release();
    }

    const version = String(rows[0].version).split(" ").slice(0, 2).join(" ");
    return ok(
      `Connected and queried ${version} over WebSocket. ` +
        `Interactive transaction ${transactionOk ? "succeeded" : "FAILED"} — ` +
        `MobiCare needs this for payment and stock updates.`,
      { transactions: transactionOk },
    );
  } finally {
    await pool.end().catch(() => {});
  }
}

// ── 6. Object storage round-trip ─────────────────────────────────────────────

async function storage() {
  return storageRoundTrip();
}

// ── Runner ───────────────────────────────────────────────────────────────────

/** Pull the hostname out of a Postgres URL without logging the credentials. */
function databaseHost(connectionString) {
  if (!connectionString) return null;
  try {
    return new URL(connectionString).hostname;
  } catch {
    return null;
  }
}

async function runChecks() {
  const connectionString = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  const host = databaseHost(connectionString);

  const checks = {
    runtime: runtime(),
    httpsEgress: await timed(httpsEgress),
    postgresPortBlocked: await timed(() => postgresPortBlocked(host)),
    websocketEgress: await timed(() => websocketEgress(host)),
    neonQuery: await timed(() => neonQuery(connectionString)),
    objectStorage: await timed(storage),
  };

  const failed = Object.values(checks).filter((c) => c.status === "fail").length;
  const database = checks.neonQuery.status;
  const storageStatus = checks.objectStorage.status;

  // Two things gate the deployment: the database must be reachable, and photo
  // storage must actually round-trip. Either one failing is a stop.
  let verdict;
  if (database === "fail") {
    verdict = "NO-GO — PostgreSQL could not be reached. See neonQuery below before committing to this host.";
  } else if (storageStatus === "fail") {
    // Do not claim the database is fine unless it was actually tested.
    verdict =
      database === "pass"
        ? "NO-GO — the database works but photo storage does not. See objectStorage below."
        : "NO-GO — photo storage does not work. See objectStorage below. The database was not tested.";
  } else if (database === "skipped" || storageStatus === "skipped") {
    const missing = [
      database === "skipped" ? "NEON_DATABASE_URL" : null,
      storageStatus === "skipped" ? "the S3_* variables" : null,
    ].filter(Boolean).join(" and ");
    verdict = `INCOMPLETE — set ${missing}, then reload to run the checks that decide this.`;
  } else {
    verdict = "GO — PostgreSQL and photo storage both work from this host. The planned architecture is viable.";
  }

  return {
    startedAt: started,
    checkedAt: new Date().toISOString(),
    verdict,
    failed,
    checks,
  };
}

// ── Presentation ─────────────────────────────────────────────────────────────

const BADGE = { pass: "PASS", fail: "FAIL", warn: "WARN", skipped: "SKIP" };
const COLOR = {
  pass: "#1A8F6E",
  fail: "#C0392B",
  warn: "#D85A30",
  skipped: "#6b7280",
};

function renderHtml(report) {
  const rows = Object.entries(report.checks)
    .map(
      ([name, check]) => `
      <tr>
        <td><code>${name}</code></td>
        <td><span style="color:${COLOR[check.status]};font-weight:700">${BADGE[check.status]}</span></td>
        <td>${escapeHtml(check.detail)}</td>
        <td style="text-align:right;color:#6b7280">${check.ms ?? 0} ms</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MobiCare connectivity probe</title>
<style>
  body{font:15px/1.55 system-ui,sans-serif;margin:0;padding:2rem;background:#fbfaf8;color:#111}
  main{max-width:60rem;margin:0 auto}
  h1{font-size:1.4rem;margin:0 0 .25rem}
  .verdict{padding:.9rem 1.1rem;border-radius:.5rem;font-weight:600;margin:1.25rem 0;
           background:${report.verdict.startsWith("GO") ? "#e7f5f0" : report.verdict.startsWith("NO-GO") ? "#fdecea" : "#fdf3e7"};
           border:1px solid ${report.verdict.startsWith("GO") ? "#1A8F6E" : report.verdict.startsWith("NO-GO") ? "#C0392B" : "#D85A30"}}
  table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e5e2dd;border-radius:.5rem;overflow:hidden}
  th,td{padding:.6rem .75rem;border-bottom:1px solid #f0ede8;text-align:left;vertical-align:top}
  th{background:#f6f4f1;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:#555}
  tr:last-child td{border-bottom:0}
  code{background:#f2efeb;padding:.1rem .3rem;border-radius:.2rem;font-size:.9em}
  p.meta{color:#6b7280;font-size:.85rem}
</style>
<main>
  <h1>MobiCare connectivity probe</h1>
  <p class="meta">Checked ${report.checkedAt} · <a href="/json">JSON</a></p>
  <div class="verdict">${escapeHtml(report.verdict)}</div>
  <table>
    <tr><th>Check</th><th>Result</th><th>Detail</th><th style="text-align:right">Time</th></tr>
    ${rows}
  </table>
  <p class="meta">Delete this app once the results are recorded. It is a diagnostic, not part of MobiCare.</p>
</main>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  let report;
  try {
    report = await runChecks();
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error?.message ?? String(error) }));
    return;
  }

  if (req.url === "/json") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(report, null, 2));
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(renderHtml(report));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`connectivity probe listening on 0.0.0.0:${PORT}`);
});

// Allow running once from a terminal instead of serving, for local checks.
if (process.argv.includes("--once")) {
  runChecks().then((report) => {
    console.log(JSON.stringify(report, null, 2));
    server.close();
    process.exit(report.verdict.startsWith("GO") ? 0 : 1);
  });
}
