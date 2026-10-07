/**
 * Finishing a SESSION_SECRET rotation.
 *
 * Provider credentials (SMS, API connections) are stored encrypted under a key
 * derived from SESSION_SECRET. To rotate it without losing them, the operator
 * sets the new value as SESSION_SECRET and the old one as
 * SESSION_SECRET_PREVIOUS for one restart. This moves every stored value onto
 * the new key; after that the previous value can be removed.
 */

import { db } from "@workspace/db";
import { apiConnectionsTable, savedApiRequestsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { reencryptIfPrevious } from "./credentialEncryption.js";
import { logger } from "./logger.js";

export async function reencryptStoredCredentials(): Promise<void> {
  if (!process.env["SESSION_SECRET_PREVIOUS"]) return;
  let moved = 0;
  let unreadable = 0;
  const next = (value: string | null): string | null | undefined => {
    if (!value) return undefined;
    try {
      const result = reencryptIfPrevious(value);
      if (result) moved++;
      return result ?? undefined;
    } catch {
      // Neither key opens it: leave it untouched rather than destroy it.
      unreadable++;
      return undefined;
    }
  };

  for (const row of await db.select().from(apiConnectionsTable)) {
    const credentialsEncrypted = next(row.credentialsEncrypted);
    if (credentialsEncrypted) {
      await db.update(apiConnectionsTable).set({ credentialsEncrypted }).where(eq(apiConnectionsTable.id, row.id));
    }
  }
  for (const row of await db.select().from(savedApiRequestsTable)) {
    const changes = {
      authConfigEncrypted: next(row.authConfigEncrypted),
      paramsEncrypted: next(row.paramsEncrypted),
      headersEncrypted: next(row.headersEncrypted),
    };
    if (Object.values(changes).some(Boolean)) {
      await db.update(savedApiRequestsTable).set(changes).where(eq(savedApiRequestsTable.id, row.id));
    }
  }

  logger.warn(
    { moved, unreadable },
    unreadable
      ? `SESSION_SECRET rotation: ${moved} stored credentials moved to the new key; ${unreadable} could not be read with either key and must be re-entered in HQ.`
      : `SESSION_SECRET rotation: ${moved} stored credentials moved to the new key. Remove SESSION_SECRET_PREVIOUS now.`,
  );
}
