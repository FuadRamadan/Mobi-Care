import assert from "node:assert/strict";
import { test } from "node:test";
import { pharmacyUniqueConstraint } from "./pharmacies";

test("recognizes username and phone conflicts through wrapped database errors", () => {
  const phoneError = {
    cause: {
      code: "23505",
      constraint: "pharmacies_phone_unique",
    },
  };
  const usernameError = {
    cause: {
      cause: {
        code: "23505",
        constraint: "pharmacies_username_unique",
      },
    },
  };

  assert.equal(
    pharmacyUniqueConstraint(phoneError),
    "pharmacies_phone_unique",
  );
  assert.equal(
    pharmacyUniqueConstraint(usernameError),
    "pharmacies_username_unique",
  );
  assert.equal(pharmacyUniqueConstraint(new Error("connection failed")), null);
});