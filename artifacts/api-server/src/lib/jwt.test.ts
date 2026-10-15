import { test } from "node:test";
import assert from "node:assert/strict";
import { pharmacySessionExpiresAt, refreshTokenExpiresAt } from "./jwt.js";

const DAY = 24 * 60 * 60 * 1000;

test("pharmacies stay signed in for 90 days; patients and HQ keep 7", () => {
  const now = Date.now();
  assert.ok(Math.abs(pharmacySessionExpiresAt().getTime() - (now + 90 * DAY)) < 5000);
  assert.ok(Math.abs(refreshTokenExpiresAt().getTime() - (now + 7 * DAY)) < 5000);
});
