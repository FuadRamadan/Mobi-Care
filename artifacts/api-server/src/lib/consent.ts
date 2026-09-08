/**
 * What a patient has agreed to, and whether it still counts.
 *
 * Two separate decisions, because bundling them would make the second one
 * meaningless:
 *
 *   terms_and_privacy    Required. Without it the platform cannot lawfully hold
 *                        a prescription or run an order, so a patient who
 *                        declines cannot use the service.
 *
 *   research_analytics   Optional, and genuinely optional — declining it costs
 *                        the patient nothing. It covers the aggregated data the
 *                        public site describes being used for funding, research
 *                        and data partnerships. A patient who says no has their
 *                        searches left unrecorded rather than recorded and
 *                        excluded later.
 *
 * "Optional" is only true if refusing is free. That is the whole difference
 * between consent and a checkbox someone has to tick to continue.
 *
 * The decision logic is kept pure so it can be tested without a database:
 * getting "has this person consented" wrong is not a bug you want to discover
 * from a regulator.
 */

export const CONSENT_TYPES = ["terms_and_privacy", "research_analytics"] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

/**
 * The version of the privacy policy and terms currently in force.
 *
 * Bump this **only** when the text changes materially — what is collected, why,
 * who it reaches, or how long it is kept. Every patient is then asked again,
 * because consent to the old text is not consent to the new one. Bumping it for
 * a typo fix costs every patient an interruption for nothing.
 */
export const CURRENT_POLICY_VERSION = "2026-09-08";

/** One row of the append-only consent record. */
export interface ConsentRecord {
  consentType: string;
  policyVersion: string;
  granted: boolean;
  recordedAt: Date;
}

export interface ConsentDecision {
  granted: boolean;
  /** The policy version the decision was made against, if one was ever made. */
  policyVersion: string | null;
  recordedAt: Date | null;
  /** True when a decision exists but was made against older policy text. */
  outdated: boolean;
}

export interface ConsentState {
  policyVersion: string;
  termsAndPrivacy: ConsentDecision;
  researchAnalytics: ConsentDecision;
  /**
   * The patient must be asked before they can create anything further: either
   * they never agreed, they withdrew, or the policy has moved on since.
   */
  needsConsent: boolean;
  /** Whether their behavioural data may be recorded at all. */
  mayRecordAnalytics: boolean;
}

const NEVER_DECIDED: ConsentDecision = {
  granted: false,
  policyVersion: null,
  recordedAt: null,
  outdated: false,
};

/**
 * The latest decision of each type wins. Rows are append-only, so "latest" is
 * the whole of the current position and everything before it is history.
 *
 * Ties on recordedAt fall to the later row in the input, which is the order the
 * query returns them in — two decisions recorded in the same transaction are
 * ordered by insertion, not left to chance.
 */
function latest(records: ConsentRecord[], type: ConsentType): ConsentDecision {
  let found: ConsentRecord | undefined;
  for (const record of records) {
    if (record.consentType !== type) continue;
    if (!found || record.recordedAt >= found.recordedAt) found = record;
  }
  if (!found) return NEVER_DECIDED;
  return {
    granted: found.granted,
    policyVersion: found.policyVersion,
    recordedAt: found.recordedAt,
    // A withdrawal does not become "outdated" when the policy moves on; it is
    // simply a no, and asking again is what the next policy version does.
    outdated: found.granted && found.policyVersion !== CURRENT_POLICY_VERSION,
  };
}

export function consentState(records: ConsentRecord[]): ConsentState {
  const termsAndPrivacy = latest(records, "terms_and_privacy");
  const researchAnalytics = latest(records, "research_analytics");

  return {
    policyVersion: CURRENT_POLICY_VERSION,
    termsAndPrivacy,
    researchAnalytics,
    needsConsent: !termsAndPrivacy.granted || termsAndPrivacy.outdated,
    // Analytics consent given against older text is not carried forward. The
    // policy version exists precisely because what the data is used for may
    // have changed.
    mayRecordAnalytics:
      researchAnalytics.granted &&
      researchAnalytics.policyVersion === CURRENT_POLICY_VERSION,
  };
}

/**
 * What each consent covers, in the words the patient is shown. Served with the
 * consent state so the app and the record cannot drift apart: the text someone
 * agreed to is the text the API describes.
 */
export const CONSENT_DESCRIPTIONS: Record<ConsentType, { title: string; body: string; required: boolean }> = {
  terms_and_privacy: {
    title: "Terms of use and privacy",
    body:
      "How MobiCare holds your details, your prescriptions and your orders, " +
      "and who can see them. Pharmacies you order from see what they need to " +
      "dispense your medicine. Required to use MobiCare.",
    required: true,
  },
  research_analytics: {
    title: "Help improve medicine access",
    body:
      "Let MobiCare include your searches in the anonymous, combined figures " +
      "used to show where medicines are hard to find. Never your name, phone " +
      "number, prescriptions or orders — and never shared as individual " +
      "records. You can say no now or change your mind later, and it will not " +
      "affect your orders in any way.",
    required: false,
  },
};
