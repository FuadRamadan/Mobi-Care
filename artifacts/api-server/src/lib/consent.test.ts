/**
 * Whether a patient has consented, and whether it still counts.
 *
 * Worth testing directly: the failure is silent in both directions. Too strict
 * and patients are locked out of a service they agreed to; too loose and the
 * platform holds medical data on a promise nobody actually made — which is the
 * failure that matters, and the one nothing else in the system would catch.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  CURRENT_POLICY_VERSION,
  consentState,
  type ConsentRecord,
} from "./consent.js";

const at = (iso: string) => new Date(iso);

const record = (
  consentType: string,
  granted: boolean,
  policyVersion = CURRENT_POLICY_VERSION,
  recordedAt = at("2026-09-08T10:00:00Z"),
): ConsentRecord => ({ consentType, policyVersion, granted, recordedAt });

test("a patient who has never been asked has not consented", () => {
  const state = consentState([]);
  assert.equal(state.needsConsent, true);
  assert.equal(state.termsAndPrivacy.granted, false);
  assert.equal(state.termsAndPrivacy.recordedAt, null);
  assert.equal(state.mayRecordAnalytics, false);
});

test("accepting the current terms is enough to proceed", () => {
  const state = consentState([record("terms_and_privacy", true)]);
  assert.equal(state.needsConsent, false);
  // Declining the optional consent must not block anything.
  assert.equal(state.mayRecordAnalytics, false);
});

test("the optional consent is genuinely optional", () => {
  const state = consentState([
    record("terms_and_privacy", true),
    record("research_analytics", false),
  ]);
  assert.equal(state.needsConsent, false);
  assert.equal(state.mayRecordAnalytics, false);
});

test("granting the optional consent allows analytics and nothing more", () => {
  const state = consentState([
    record("terms_and_privacy", true),
    record("research_analytics", true),
  ]);
  assert.equal(state.needsConsent, false);
  assert.equal(state.mayRecordAnalytics, true);
});

test("the latest decision wins, so consent can be withdrawn", () => {
  const state = consentState([
    record("research_analytics", true, CURRENT_POLICY_VERSION, at("2026-09-01T10:00:00Z")),
    record("research_analytics", false, CURRENT_POLICY_VERSION, at("2026-09-05T10:00:00Z")),
  ]);
  assert.equal(state.mayRecordAnalytics, false);
  assert.equal(state.researchAnalytics.granted, false);
});

test("withdrawal can itself be reversed", () => {
  const state = consentState([
    record("research_analytics", true, CURRENT_POLICY_VERSION, at("2026-09-01T10:00:00Z")),
    record("research_analytics", false, CURRENT_POLICY_VERSION, at("2026-09-05T10:00:00Z")),
    record("research_analytics", true, CURRENT_POLICY_VERSION, at("2026-09-07T10:00:00Z")),
  ]);
  assert.equal(state.mayRecordAnalytics, true);
});

test("rows out of chronological order still resolve to the latest decision", () => {
  // The query orders them, but the answer must not depend on that.
  const state = consentState([
    record("terms_and_privacy", false, CURRENT_POLICY_VERSION, at("2026-09-09T10:00:00Z")),
    record("terms_and_privacy", true, CURRENT_POLICY_VERSION, at("2026-09-01T10:00:00Z")),
  ]);
  assert.equal(state.termsAndPrivacy.granted, false);
  assert.equal(state.needsConsent, true);
});

test("consent to superseded policy text does not carry forward", () => {
  // The version exists so that a material change re-asks. If old consent still
  // counted, changing the policy would silently expand what people agreed to.
  const state = consentState([record("terms_and_privacy", true, "2020-01-01")]);
  assert.equal(state.termsAndPrivacy.granted, true);
  assert.equal(state.termsAndPrivacy.outdated, true);
  assert.equal(state.needsConsent, true);
});

test("analytics consent given against older text stops applying", () => {
  const state = consentState([
    record("terms_and_privacy", true),
    record("research_analytics", true, "2020-01-01"),
  ]);
  assert.equal(state.mayRecordAnalytics, false);
});

test("a refusal is not 'outdated' when the policy moves on — it is a no", () => {
  const state = consentState([record("research_analytics", false, "2020-01-01")]);
  assert.equal(state.researchAnalytics.outdated, false);
  assert.equal(state.mayRecordAnalytics, false);
});

test("an unrecognised consent type is ignored rather than trusted", () => {
  const state = consentState([record("marketing_emails", true)]);
  assert.equal(state.needsConsent, true);
  assert.equal(state.mayRecordAnalytics, false);
});

test("the state reports the version a patient is being asked about", () => {
  assert.equal(consentState([]).policyVersion, CURRENT_POLICY_VERSION);
});
