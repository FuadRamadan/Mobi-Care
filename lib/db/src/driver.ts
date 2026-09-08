/**
 * Which PostgreSQL driver to open the connection with.
 *
 * Two are supported, and the difference is a hosting constraint rather than a
 * preference:
 *
 *   postgres  node-postgres, the ordinary wire protocol on port 5432. What
 *             development, the test suite and the migration runner use.
 *
 *   neon      @neondatabase/serverless, which speaks the same protocol inside a
 *             WebSocket on port 443. Required on hosts that allow outbound
 *             traffic on ports 80 and 443 only — GoDaddy Node.js Hosting among
 *             them, where an ordinary connection cannot leave the machine.
 *
 * Both give a `Pool` with session and interactive transaction support, which
 * MobiCare needs: payment claiming, stock deduction and the pilot-data reset
 * all run inside `db.transaction()`.
 *
 * Kept apart from index.ts so the choice can be tested without opening a
 * connection — getting it wrong in production produces a connection timeout,
 * which is a slow and confusing way to learn about a configuration mistake.
 */

export type DatabaseDriver = "postgres" | "neon";

export interface DriverChoice {
  driver: DatabaseDriver;
  /** Why, for the startup log — a wrong driver is otherwise invisible. */
  reason: string;
}

const VALID: DatabaseDriver[] = ["postgres", "neon"];

/** Neon's own endpoints, which always want the serverless driver. */
function isNeonHost(connectionString: string): boolean {
  try {
    const { hostname } = new URL(connectionString);
    return hostname === "neon.tech" || hostname.endsWith(".neon.tech");
  } catch {
    // An unparseable string is the connection's problem to report, not this
    // function's. Fall through to the default driver.
    return false;
  }
}

/**
 * An explicit DATABASE_DRIVER always wins. Otherwise a Neon connection string
 * selects the Neon driver, because nothing else can reach one from a host that
 * blocks 5432 — and someone who has gone as far as creating a Neon database has
 * not asked for the driver that cannot talk to it.
 */
export function selectDriver(options: {
  configured?: string | undefined;
  connectionString: string;
}): DriverChoice {
  const configured = options.configured?.trim().toLowerCase();

  if (configured) {
    if (!VALID.includes(configured as DatabaseDriver)) {
      throw new Error(
        `DATABASE_DRIVER must be one of ${VALID.join(", ")}, received "${options.configured}".`,
      );
    }
    return {
      driver: configured as DatabaseDriver,
      reason: "set by DATABASE_DRIVER",
    };
  }

  if (isNeonHost(options.connectionString)) {
    return { driver: "neon", reason: "inferred from a neon.tech host" };
  }

  return { driver: "postgres", reason: "default" };
}
