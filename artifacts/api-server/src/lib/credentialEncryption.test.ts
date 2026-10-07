import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptCredential, encryptCredential, reencryptIfPrevious } from "./credentialEncryption.js";

const OLD = "a".repeat(64);
const NEW = "b".repeat(64);

function withSecrets(current: string, previous: string | undefined, run: () => void): void {
  const saved = { current: process.env.SESSION_SECRET, previous: process.env.SESSION_SECRET_PREVIOUS };
  process.env.SESSION_SECRET = current;
  if (previous) process.env.SESSION_SECRET_PREVIOUS = previous;
  else delete process.env.SESSION_SECRET_PREVIOUS;
  try {
    run();
  } finally {
    if (saved.current === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved.current;
    if (saved.previous === undefined) delete process.env.SESSION_SECRET_PREVIOUS;
    else process.env.SESSION_SECRET_PREVIOUS = saved.previous;
  }
}

test("a value stored under the old key cannot be read after rotation without the previous key", () => {
  let stored = "";
  withSecrets(OLD, undefined, () => { stored = encryptCredential("sms-password"); });
  withSecrets(NEW, undefined, () => assert.throws(() => decryptCredential(stored)));
});

test("with SESSION_SECRET_PREVIOUS set, old values are still readable and are moved to the new key", () => {
  let stored = "";
  withSecrets(OLD, undefined, () => { stored = encryptCredential("sms-password"); });
  let moved: string | null = null;
  withSecrets(NEW, OLD, () => {
    assert.equal(decryptCredential(stored), "sms-password");
    moved = reencryptIfPrevious(stored);
    assert.ok(moved);
  });
  // After the restart without the previous key, the moved value still opens.
  withSecrets(NEW, undefined, () => assert.equal(decryptCredential(moved!), "sms-password"));
});

test("values already on the current key are left alone", () => {
  withSecrets(NEW, OLD, () => {
    const current = encryptCredential("api-key");
    assert.equal(reencryptIfPrevious(current), null);
  });
});

test("nothing is re-encrypted when no previous key is set", () => {
  withSecrets(NEW, undefined, () => assert.equal(reencryptIfPrevious(encryptCredential("x")), null));
});
