import assert from "node:assert/strict";
import { test } from "node:test";
import { contentSecurityPolicy, pageSecurityHeaders } from "./contentSecurityPolicy.js";

const directive = (policy: string, name: string) =>
  policy.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

test("scripts only from MobiCare and Google sign-in; no inline or eval", () => {
  const { value } = contentSecurityPolicy({ NODE_ENV: "production" });
  assert.equal(directive(value, "script-src"), "script-src 'self' https://accounts.google.com/gsi/client");
  assert.doesNotMatch(value, /unsafe-eval/);
  assert.doesNotMatch(directive(value, "script-src"), /unsafe-inline/);
});

test("pages cannot be framed, plugins are off, and production upgrades http", () => {
  const { value } = contentSecurityPolicy({ NODE_ENV: "production" });
  assert.match(value, /frame-ancestors 'none'/);
  assert.match(value, /object-src 'none'/);
  assert.match(value, /upgrade-insecure-requests/);
  assert.doesNotMatch(contentSecurityPolicy({}).value, /upgrade-insecure-requests/);
});

test("file storage is allowed for uploads and pictures, path-style and virtual-hosted", () => {
  const path = contentSecurityPolicy({ S3_ENDPOINT: "https://s3.eu-west-1.amazonaws.com/" }).value;
  assert.match(directive(path, "connect-src"), /https:\/\/s3\.eu-west-1\.amazonaws\.com/);
  assert.match(directive(path, "img-src"), /https:\/\/s3\.eu-west-1\.amazonaws\.com/);
  const hosted = contentSecurityPolicy({
    S3_ENDPOINT: "https://s3.eu-west-1.amazonaws.com",
    S3_BUCKET: "mobicare-media",
    S3_FORCE_PATH_STYLE: "false",
  }).value;
  assert.match(directive(hosted, "connect-src"), /https:\/\/mobicare-media\.s3\.eu-west-1\.amazonaws\.com/);
});

test("map tiles follow VITE_MAP_TILE_URL, including {s} subdomains", () => {
  assert.match(contentSecurityPolicy({}).value, /img-src [^;]*https:\/\/tile\.openstreetmap\.org/);
  const custom = contentSecurityPolicy({ VITE_MAP_TILE_URL: "https://{s}.tiles.example.com/{z}/{x}/{y}.png" }).value;
  assert.match(directive(custom, "img-src"), /https:\/\/\*\.tiles\.example\.com/);
});

test("extra sources are accepted only as plain https origins", () => {
  const { value } = contentSecurityPolicy({ CSP_EXTRA_IMG_SRC: "https://cdn.example.com 'unsafe-inline' javascript:" });
  assert.match(directive(value, "img-src"), /https:\/\/cdn\.example\.com/);
  assert.doesNotMatch(directive(value, "img-src"), /unsafe-inline|javascript/);
});

test("report-only mode and the reporting endpoint", () => {
  assert.equal(contentSecurityPolicy({ CSP_MODE: "report-only" }).name, "Content-Security-Policy-Report-Only");
  const headers = pageSecurityHeaders({});
  assert.ok(headers["Content-Security-Policy"]?.includes("report-uri /api/security/csp-report"));
  assert.doesNotMatch(headers["Content-Security-Policy"] ?? "", /report-to/);
});
