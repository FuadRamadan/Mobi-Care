/**
 * Create the first HQ administrator — HQ has NO self-registration path.
 *
 *   DATABASE_URL='postgresql://...' pnpm run bootstrap-hq
 *
 * Asks for the username, name and password at the terminal. The password is
 * typed at a hidden prompt and confirmed, rather than passed on the command
 * line: a command line lands in shell history and is readable from
 * /proc/<pid>/environ, and this is the account that can see every order,
 * every prescription and every settlement on the platform.
 *
 * HQ_ADMIN_USERNAME, HQ_ADMIN_PASSWORD and HQ_ADMIN_NAME are still read when
 * set, for automation with no terminal attached. They are NOT read by the API
 * and do not belong in a deployed app's environment.
 *
 * Idempotent: creates the account when missing, or resets and reactivates the
 * existing one — which is also the way back from a lost HQ password.
 */
import { createInterface } from "node:readline";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { hqStaffTable, auditLogTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import {
  getOrCreatePasswordPolicy,
  validatePasswordAgainstPolicy,
} from "../src/lib/passwordPolicy.js";

const interactive = process.stdin.isTTY === true;

/**
 * One readline interface for the whole session.
 *
 * Not one per question: closing an interface releases stdin, and the next one
 * opened over the same stream reads nothing — the script simply stops at the
 * second prompt with no error at all.
 */
const rl = createInterface({ input: process.stdin, output: process.stdout });

let hidden = false;
let currentPrompt = "";

// readline echoes each keystroke through this. While a hidden question is in
// flight, let the prompt itself through and swallow everything else, so a
// password is not left on screen for whoever walks past next.
(rl as unknown as { _writeToOutput: (chunk: string) => void })._writeToOutput =
  function (chunk: string) {
    if (!hidden) {
      process.stdout.write(chunk);
      return;
    }
    if (chunk === currentPrompt) process.stdout.write(chunk);
  };

function ask(question: string, secret = false): Promise<string> {
  return new Promise((resolve) => {
    hidden = secret;
    currentPrompt = question;
    rl.question(question, (answer) => {
      hidden = false;
      if (secret) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

/** From the environment when set, otherwise from the terminal. */
async function value(
  envName: string,
  prompt: string,
  { hidden = false, fallback = "" } = {},
): Promise<string> {
  const fromEnv = process.env[envName];
  if (fromEnv !== undefined && fromEnv.trim() !== "") return fromEnv;
  if (!interactive) return fallback;
  const answer = (await ask(prompt, hidden)).trim();
  return answer === "" ? fallback : answer;
}

async function main() {
  if (interactive) {
    console.log("\nCreate or reset the HQ administrator.\n");
  }

  const username = (await value("HQ_ADMIN_USERNAME", "HQ username: ")).trim();
  const name = (
    await value("HQ_ADMIN_NAME", "Full name [HQ Administrator]: ", {
      fallback: "HQ Administrator",
    })
  ).trim();

  let password = process.env.HQ_ADMIN_PASSWORD ?? "";
  if (password === "" && interactive) {
    password = await ask("Password (not shown): ", true);
    const again = await ask("Confirm password: ", true);
    if (password !== again) {
      rl.close();
      console.error("\nThose passwords do not match. Nothing was changed.");
      process.exit(1);
    }
  }

  if (!username || !password) {
    rl.close();
    console.error(
      interactive
        ? "A username and password are both required. Nothing was changed."
        : "HQ_ADMIN_USERNAME and HQ_ADMIN_PASSWORD are required when there is no terminal to ask.",
    );
    process.exit(1);
  }

  // Held to the same rules the platform enforces on everyone else. This is the
  // most privileged account there is; it should not be the weakest.
  rl.close();

  const policy = await getOrCreatePasswordPolicy();
  const check = validatePasswordAgainstPolicy(password, policy);
  if (!check.valid) {
    console.error("\nThat password does not meet the platform's policy:");
    for (const message of check.messages) console.error(`  - ${message}`);
    console.error("\nNothing was changed.");
    process.exit(1);
  }

  const [existing] = await db
    .select({ id: hqStaffTable.id })
    .from(hqStaffTable)
    .where(eq(hqStaffTable.username, username))
    .limit(1);

  const passwordHash = await bcrypt.hash(password, 12);
  if (existing) {
    await db
      .update(hqStaffTable)
      .set({
        name,
        passwordHash,
        isActive: true,
        canManageIntegrations: true,
        canManageSettlements: true,
        canViewDataInsights: true,
        updatedAt: new Date(),
      })
      .where(eq(hqStaffTable.id, existing.id));

    await db.insert(auditLogTable).values({
      actorType: "system",
      actorName: "bootstrap-hq script",
      action: "hq_staff.bootstrap_sync",
      entityType: "hq_staff",
      entityId: existing.id,
      details: {
        reactivated: true,
        passwordResetFromSecret: true,
        permissionsSynchronized: true,
      },
    });

    console.log(`\nHQ administrator "${username}" reset and activated.\n`);
    process.exit(0);
  }

  const [created] = await db
    .insert(hqStaffTable)
    .values({
      username,
      name,
      passwordHash,
      isActive: true,
      canManageIntegrations: true,
      canManageSettlements: true,
      canViewDataInsights: true,
    })
    .returning({ id: hqStaffTable.id });

  await db.insert(auditLogTable).values({
    actorType: "system",
    actorName: "bootstrap-hq script",
    action: "hq_staff.bootstrap",
    entityType: "hq_staff",
    entityId: created!.id,
    details: { username, name },
  });

  console.log(`\nHQ administrator "${username}" created. Sign in at /hq.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
