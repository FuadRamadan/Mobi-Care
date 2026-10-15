import { test } from "node:test";
import assert from "node:assert/strict";
import { isPushEndpoint, webPushConfig } from "./webPush.js";
import { orderNumber } from "./orderNumber.js";

test("push endpoints: the browsers' push services only", () => {
  for (const ok of [
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://web.push.apple.com/QGuQyavXutnMH",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
  ]) assert.ok(isPushEndpoint(ok), ok);
  for (const bad of [
    "http://fcm.googleapis.com/fcm/send/abc", // not https
    "https://fcm.googleapis.com:8443/fcm/send/abc", // odd port
    "https://fcm.googleapis.com.evil.example/x", // look-alike host
    "https://169.254.169.254/latest/meta-data", // cloud metadata
    "https://localhost/push",
    "https://internal.mobicare.sl/admin",
    "not a url",
    `https://fcm.googleapis.com/${"x".repeat(1000)}`,
  ]) assert.ok(!isPushEndpoint(bad), bad);
});

test("push config: off without both keys; subject defaults to the site", () => {
  assert.equal(webPushConfig({}), null);
  assert.equal(webPushConfig({ VAPID_PUBLIC_KEY: "pub" }), null);
  const c = webPushConfig({ VAPID_PUBLIC_KEY: " pub ", VAPID_PRIVATE_KEY: "priv", ALLOWED_ORIGINS: "http://localhost:1, https://mobicare.sl" });
  assert.deepEqual(c, { publicKey: "pub", privateKey: "priv", subject: "https://mobicare.sl" });
  assert.equal(webPushConfig({ VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "q", VAPID_SUBJECT: "mailto:ops@example.com" })?.subject, "mailto:ops@example.com");
});

test("order number: first 8 characters of the id, in capitals", () => {
  assert.equal(orderNumber("100d4484-edd1-4949-98a8-d755a68c1428"), "100D4484");
});
