import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "../../..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function releaseLog(message) {
  console.log(`[medicine-order-release] ${message}`);
}

async function runCommand(label, command, args, options = {}) {
  releaseLog(label);
  const child = spawn(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
  });
  const [exitCode, signal] = await once(child, "exit");
  if (exitCode !== 0) {
    throw new Error(
      `${label} failed${signal ? ` with signal ${signal}` : ` with exit code ${exitCode}`}`,
    );
  }
}

async function commandSucceeds(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? workspaceRoot,
    env: options.env ?? process.env,
    stdio: "ignore",
  });
  const [exitCode] = await once(child, "exit");
  return exitCode === 0;
}

async function reservePorts(count) {
  const servers = [];
  try {
    for (let index = 0; index < count; index++) {
      const server = net.createServer();
      server.unref();
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      servers.push(server);
    }
    return servers.map((server) => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not reserve a local TCP port");
      }
      return address.port;
    });
  } finally {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
    );
  }
}

async function waitForPostgres(port, postgresProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (postgresProcess.exitCode !== null) {
      throw new Error(
        `Temporary PostgreSQL exited before becoming ready (exit ${postgresProcess.exitCode})`,
      );
    }
    if (
      await commandSucceeds("pg_isready", [
        "--host=127.0.0.1",
        `--port=${port}`,
        "--username=postgres",
        "--dbname=postgres",
      ])
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Temporary PostgreSQL did not become ready within 30 seconds");
}

async function waitForApi(baseUrl, apiProcess) {
  const deadline = Date.now() + 30_000;
  let lastError = "no response";
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) {
      throw new Error(
        `Test API exited before becoming healthy (exit ${apiProcess.exitCode})`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/healthz`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    `Test API did not become healthy within 30 seconds (${lastError})`,
  );
}

function processIsRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

async function waitForProcessExit(child, timeoutMs) {
  if (!processIsRunning(child)) return true;
  return Promise.race([
    once(child, "exit").then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

async function stopProcess(child, label) {
  if (!child || !processIsRunning(child)) return;
  releaseLog(`Stopping ${label}`);
  child.kill("SIGTERM");
  if (!(await waitForProcessExit(child, 5_000))) {
    child.kill("SIGKILL");
    await waitForProcessExit(child, 5_000);
  }
}

async function main() {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.SMS_TRANSPORT !== "test"
  ) {
    throw new Error(
      "Release check requires NODE_ENV=test and SMS_TRANSPORT=test",
    );
  }

  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "mobicare-medicine-order-"),
  );
  const databaseDirectory = path.join(temporaryRoot, "postgres");
  const [databasePort, apiPort] = await reservePorts(2);
  const databaseUrl = `postgresql://postgres@127.0.0.1:${databasePort}/postgres`;
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const ephemeralSecret = crypto.randomBytes(48).toString("hex");
  const testEnvironment = {
    ...process.env,
    CI: "true",
    MEDICINE_ORDER_FLOW_ISOLATED: "true",
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    SMS_TRANSPORT: "test",
    JWT_SECRET: ephemeralSecret,
    SESSION_SECRET: ephemeralSecret,
    PRIVATE_OBJECT_DIR: "",
    PUBLIC_OBJECT_SEARCH_PATHS: "",
    DEFAULT_OBJECT_STORAGE_BUCKET_ID: "",
  };

  let postgresProcess;
  let apiProcess;
  let exitCode = 0;

  const handleSignal = (signal) => {
    exitCode = signal === "SIGINT" ? 130 : 143;
    postgresProcess?.kill(signal);
    apiProcess?.kill(signal);
  };
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  try {
    await runCommand(
      "Initializing isolated PostgreSQL",
      "initdb",
      [
        `--pgdata=${databaseDirectory}`,
        "--username=postgres",
        "--auth=trust",
        "--no-locale",
        "--encoding=UTF8",
        "--no-sync",
      ],
      { env: testEnvironment, stdio: ["ignore", "ignore", "inherit"] },
    );

    postgresProcess = spawn(
      "postgres",
      [
        "-D",
        databaseDirectory,
        "-h",
        "127.0.0.1",
        "-p",
        String(databasePort),
        "-k",
        temporaryRoot,
        "-F",
      ],
      {
        cwd: temporaryRoot,
        env: testEnvironment,
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    await waitForPostgres(databasePort, postgresProcess);

    await runCommand(
      "Creating isolated database schema",
      pnpmCommand,
      ["--filter", "@workspace/db", "run", "push-force"],
      { env: testEnvironment },
    );
    await runCommand(
      "Seeding required test settings",
      "psql",
      [
        databaseUrl,
        "--set=ON_ERROR_STOP=1",
        "--command",
        `INSERT INTO platform_settings (key, value) VALUES
          ('medicine_markup_basis_points', 500),
          ('delivery_fee_minor', 2500000),
          ('courier_payout_minor', 2000000)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      ],
      { env: testEnvironment, stdio: ["ignore", "ignore", "inherit"] },
    );
    await runCommand(
      "Building API for release validation",
      pnpmCommand,
      ["--filter", "@workspace/api-server", "run", "build"],
      { env: testEnvironment },
    );

    apiProcess = spawn(
      process.execPath,
      [
        "--enable-source-maps",
        path.join(workspaceRoot, "artifacts/api-server/dist/index.mjs"),
      ],
      {
        cwd: temporaryRoot,
        env: { ...testEnvironment, PORT: String(apiPort), LOG_LEVEL: "warn" },
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    await waitForApi(apiBaseUrl, apiProcess);

    await runCommand(
      "Running patient-to-pharmacy-to-HQ medicine order flow",
      pnpmCommand,
      ["--filter", "@workspace/api-server", "run", "test-patient-flow"],
      {
        env: {
          ...testEnvironment,
          TEST_API_BASE_URL: apiBaseUrl,
        },
      },
    );
    releaseLog("Release gate passed");
  } catch (error) {
    exitCode = 1;
    console.error(
      `[medicine-order-release] FAILED — ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    process.removeListener("SIGINT", handleSignal);
    process.removeListener("SIGTERM", handleSignal);
    await stopProcess(apiProcess, "test API");
    await stopProcess(postgresProcess, "temporary PostgreSQL");
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  process.exitCode = exitCode;
}

await main();