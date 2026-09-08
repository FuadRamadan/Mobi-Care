/**
 * Which driver opens the database connection.
 *
 * This decides whether the deployed app can reach its database at all. On a
 * host that allows outbound traffic on ports 80 and 443 only — GoDaddy Node.js
 * Hosting — the ordinary driver's connection on 5432 never leaves the machine,
 * and the failure is a slow timeout that says nothing about the cause. Worth
 * testing the decision rather than discovering it in production.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { selectDriver } from "@workspace/db/driver";

const NEON = "postgresql://u:p@ep-cool-name-123456.eu-central-1.aws.neon.tech/mobicare?sslmode=require";
const LOCAL = "postgresql://postgres@127.0.0.1:5432/mobicare";

test("an explicit DATABASE_DRIVER always wins", () => {
  assert.equal(
    selectDriver({ configured: "neon", connectionString: LOCAL }).driver,
    "neon",
  );
  // Including the awkward direction: someone reaching a Neon database through
  // a tunnel or proxy must be able to say so.
  assert.equal(
    selectDriver({ configured: "postgres", connectionString: NEON }).driver,
    "postgres",
  );
});

test("case and surrounding whitespace do not matter", () => {
  assert.equal(
    selectDriver({ configured: "  NEON  ", connectionString: LOCAL }).driver,
    "neon",
  );
});

test("a Neon connection string selects the Neon driver on its own", () => {
  // Nothing else can reach a Neon endpoint from a host that blocks 5432, and
  // forgetting one environment variable should not be what breaks a deploy.
  const choice = selectDriver({ configured: undefined, connectionString: NEON });
  assert.equal(choice.driver, "neon");
  assert.match(choice.reason, /neon\.tech/);
});

test("a lookalike hostname is not treated as Neon", () => {
  // notneon.tech.example.com must not match, or an unrelated host silently
  // gets a driver that cannot talk to it.
  for (const host of [
    "postgresql://u:p@neon.tech.example.com/db",
    "postgresql://u:p@notneon.tech/db",
    "postgresql://u:p@myneon.tech.attacker.net/db",
  ]) {
    assert.equal(selectDriver({ configured: undefined, connectionString: host }).driver, "postgres", host);
  }
});

test("anything else defaults to node-postgres", () => {
  const choice = selectDriver({ configured: undefined, connectionString: LOCAL });
  assert.equal(choice.driver, "postgres");
  assert.equal(choice.reason, "default");
});

test("an empty DATABASE_DRIVER is treated as unset, not as an error", () => {
  // A blank environment variable is how a hosting dashboard renders "not set".
  assert.equal(
    selectDriver({ configured: "", connectionString: LOCAL }).driver,
    "postgres",
  );
  assert.equal(
    selectDriver({ configured: "   ", connectionString: NEON }).driver,
    "neon",
  );
});

test("an unknown driver name is refused, naming the valid ones", () => {
  assert.throws(
    () => selectDriver({ configured: "postgress", connectionString: LOCAL }),
    /DATABASE_DRIVER must be one of postgres, neon/,
  );
});

test("an unparseable connection string does not throw here", () => {
  // The connection attempt reports that far better than this function can.
  assert.equal(
    selectDriver({ configured: undefined, connectionString: "not a url" }).driver,
    "postgres",
  );
});
