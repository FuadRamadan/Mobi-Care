import assert from "node:assert/strict";
import { test } from "node:test";
import { ALERT_RULES, maskIdentifier, rulesFor } from "./securityEvents.js";

test("phone numbers are masked; usernames are kept", () => {
  assert.equal(maskIdentifier("+23276000001"), "+232•••••001");
  assert.equal(maskIdentifier("citypharmacy"), "citypharmacy");
  assert.equal(maskIdentifier("someone@example.com"), "s•••@example.com");
  assert.equal(maskIdentifier(""), null);
});

test("wrong passwords alert per account only when the account is known", () => {
  assert.deepEqual(rulesFor("failed_sign_in", true).map((r) => r.key), ["account_guessing", "many_failed_sign_ins"]);
  assert.deepEqual(rulesFor("failed_sign_in", false).map((r) => r.key), ["many_failed_sign_ins"]);
});

test("every kind of event has an alert rule with a sensible threshold", () => {
  for (const kind of ["failed_sign_in", "sign_in_blocked", "csp_violation", "server_error"] as const) {
    assert.ok(rulesFor(kind, true).length > 0, kind);
  }
  for (const rule of ALERT_RULES) {
    assert.ok(rule.threshold >= 3 && rule.windowMinutes >= 15, rule.key);
    assert.ok(rule.body(rule.threshold, "+232•••••001").length > 20, rule.key);
  }
});
