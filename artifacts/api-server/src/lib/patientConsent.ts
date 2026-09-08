/**
 * Reading and recording a patient's consent, and the gate that enforces it.
 *
 * The pure decision logic is in consent.ts; this is the part that touches the
 * database.
 */

import { db, patientConsentsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../middlewares/auth.js";
import {
  CONSENT_TYPES,
  CURRENT_POLICY_VERSION,
  consentState,
  type ConsentState,
  type ConsentType,
} from "./consent.js";

export async function readConsentState(patientId: string): Promise<ConsentState> {
  const rows = await db
    .select({
      consentType: patientConsentsTable.consentType,
      policyVersion: patientConsentsTable.policyVersion,
      granted: patientConsentsTable.granted,
      recordedAt: patientConsentsTable.recordedAt,
    })
    .from(patientConsentsTable)
    .where(
      and(
        eq(patientConsentsTable.patientId, patientId),
        inArray(patientConsentsTable.consentType, [...CONSENT_TYPES]),
      ),
    )
    .orderBy(patientConsentsTable.recordedAt);
  return consentState(rows);
}

/**
 * Append a decision. Never updates: withdrawing adds a row saying so, which is
 * what makes the record evidence rather than a setting.
 *
 * Takes an optional transaction so consent recorded during registration commits
 * with the account — an account that exists without the consent that created it
 * is the one state this must never produce.
 */
export async function recordConsent(
  decisions: Array<{ patientId: string; consentType: ConsentType; granted: boolean }>,
  source: "registration" | "profile",
  client: Pick<typeof db, "insert"> = db,
): Promise<void> {
  if (decisions.length === 0) return;
  await client.insert(patientConsentsTable).values(
    decisions.map((decision) => ({
      patientId: decision.patientId,
      consentType: decision.consentType,
      granted: decision.granted,
      policyVersion: CURRENT_POLICY_VERSION,
      source,
    })),
  );
}

/**
 * Refuse to create anything new for a patient who has not accepted the current
 * terms.
 *
 * Reads are deliberately let through. Someone who has withdrawn consent, or who
 * is looking at a policy they have not yet accepted, must still be able to see
 * their own orders and export or delete their data — locking them out of their
 * own record would be the opposite of what this is for.
 *
 * The response carries a code the app switches on, so the prompt appears
 * instead of a bare error.
 */
export function requireCurrentConsent() {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    try {
      const state = await readConsentState(req.pharmacy!.sub);
      if (state.needsConsent) {
        res.status(403).json({
          error:
            "Please review and accept the updated terms and privacy notice before continuing.",
          code: "CONSENT_REQUIRED",
          policyVersion: state.policyVersion,
        });
        return;
      }
      next();
    } catch {
      res.status(500).json({ error: "Consent check failed" });
    }
  };
}
