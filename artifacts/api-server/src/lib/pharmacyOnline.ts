/**
 * A pharmacy is online while it is signed in to the portal on at least one
 * device: it has a sign-in (refresh token) that is neither signed out nor
 * expired. Signing out on every device takes it offline: patients no longer
 * see its medicines or can order from it until it signs in again. Closing the
 * browser without signing out keeps it online (sign-ins last 90 days).
 *
 * Prescription requests are stricter: they go only to pharmacies with the
 * portal open right now (pharmacies.last_seen_at, lib/prescriptionRequests.ts).
 */
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, refreshTokensTable } from "@workspace/db";

/**
 * SQL condition: the pharmacies row in the query is signed in somewhere.
 * Written out in full: as a selected column, drizzle leaves column names
 * unqualified, and inside the sub-query "id" would then be the sign-in's own.
 */
export const pharmacySignedIn = sql<boolean>`exists (
  select 1 from refresh_tokens rt
  where rt.pharmacy_id = "pharmacies"."id"
    and rt.revoked_at is null
    and rt.expires_at > now()
)`.mapWith(Boolean);

export async function isPharmacySignedIn(pharmacyId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: refreshTokensTable.id })
    .from(refreshTokensTable)
    .where(and(eq(refreshTokensTable.pharmacyId, pharmacyId), isNull(refreshTokensTable.revokedAt), gt(refreshTokensTable.expiresAt, new Date())))
    .limit(1);
  return Boolean(row);
}
