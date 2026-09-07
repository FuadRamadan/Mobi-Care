/**
 * Static hosting: routing precedence, SPA fallback, and cache headers.
 *
 * The precedence cases are the point. Serving the API and two single-page apps
 * from one origin means a fallback that is slightly too eager answers requests
 * it should not — an unknown /api path returning an HTML page with status 200,
 * or a missing script returning HTML that the browser then fails to parse. Both
 * were real bugs found by deploying the packaged build and probing it; these
 * pin the fixes.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type Express } from "express";
import { mountStaticSites } from "./staticSites.js";

/** Build a directory laid out like a packaged release. */
function makeSites(): string {
  const root = mkdtempSync(path.join(tmpdir(), "mobicare-static-"));

  for (const [site, title] of [
    ["gateway", "Gateway"],
    ["pharmacy-portal", "Portal"],
  ] as const) {
    mkdirSync(path.join(root, site, "assets"), { recursive: true });
    writeFileSync(
      path.join(root, site, "index.html"),
      `<!doctype html><title>${title}</title>`,
    );
    writeFileSync(path.join(root, site, "assets", "index-DPfUf00k.js"), "console.log(1)");
    writeFileSync(path.join(root, site, "favicon.ico"), "icon");
  }

  return root;
}

/** An app shaped like the real one: API first, then the static sites. */
function makeApp(root: string): Express {
  const previous = process.env["SERVE_STATIC_DIR"];
  process.env["SERVE_STATIC_DIR"] = root;

  const app = express();
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  mountStaticSites(app);

  if (previous === undefined) delete process.env["SERVE_STATIC_DIR"];
  else process.env["SERVE_STATIC_DIR"] = previous;

  return app;
}

async function get(
  app: Express,
  target: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  const server = app.listen(0);
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return await fetch(`http://127.0.0.1:${port}${target}`, { headers });
  } finally {
    server.close();
  }
}

test("nothing is served unless SERVE_STATIC_DIR is set", () => {
  const previous = process.env["SERVE_STATIC_DIR"];
  delete process.env["SERVE_STATIC_DIR"];
  try {
    assert.deepEqual(mountStaticSites(express()), []);
  } finally {
    if (previous !== undefined) process.env["SERVE_STATIC_DIR"] = previous;
  }
});

test("each site is served from its own mount", async () => {
  const app = makeApp(makeSites());

  const gateway = await get(app, "/");
  assert.equal(gateway.status, 200);
  assert.match(await gateway.text(), /<title>Gateway<\/title>/);

  const portal = await get(app, "/pharmacy-portal/");
  assert.equal(portal.status, 200);
  assert.match(await portal.text(), /<title>Portal<\/title>/);
});

test("client-side routes fall back to that site's index", async () => {
  const app = makeApp(makeSites());

  // A deep link the browser navigates to directly, with no file behind it.
  const patient = await get(app, "/patient");
  assert.equal(patient.status, 200);
  assert.match(await patient.text(), /Gateway/);

  // The portal's own deep link must get the portal, not the gateway.
  const login = await get(app, "/pharmacy-portal/login");
  assert.equal(login.status, 200);
  assert.match(await login.text(), /Portal/);
});

test("an unknown /api path is a JSON 404, never the SPA shell", async () => {
  const app = makeApp(makeSites());
  const response = await get(app, "/api/does-not-exist");

  assert.equal(response.status, 404, "must not be 200");
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await response.json(), { error: "Not found" });
});

test("the API still answers its own routes", async () => {
  const app = makeApp(makeSites());
  const response = await get(app, "/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("a missing asset is a 404, not an HTML page", async () => {
  const app = makeApp(makeSites());

  // Returning index.html here would surface as a syntax error in the console
  // rather than an obvious missing file.
  for (const missing of ["/assets/gone.js", "/pharmacy-portal/assets/gone.css"]) {
    const response = await get(app, missing);
    assert.equal(response.status, 404, `${missing} should 404`);
  }
});

test("non-GET requests are not answered with the SPA", async () => {
  const root = makeSites();
  const app = makeApp(root);
  const server = app.listen(0);
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/whatever`, { method: "POST" });
    assert.notEqual(response.status, 200);
  } finally {
    server.close();
  }
});

test("a client that does not want HTML does not get it", async () => {
  const app = makeApp(makeSites());
  const response = await get(app, "/whatever", { accept: "application/json" });
  assert.notEqual(response.status, 200);
});

test("hashed assets cache for a year, entry points not at all", async () => {
  const app = makeApp(makeSites());

  const asset = await get(app, "/assets/index-DPfUf00k.js");
  assert.equal(asset.status, 200);
  assert.match(
    asset.headers.get("cache-control") ?? "",
    /max-age=31536000/,
    "Vite writes name-hash.js, so matching on the assets directory rather than the filename",
  );
  assert.match(asset.headers.get("cache-control") ?? "", /immutable/);

  // Caching the entry point would keep serving asset URLs a release has removed.
  const index = await get(app, "/");
  assert.equal(index.headers.get("cache-control"), "no-store");

  // Unhashed files at the site root get a short cache, not a year.
  const favicon = await get(app, "/favicon.ico");
  assert.equal(favicon.headers.get("cache-control"), "public, max-age=300");
});

test("serves from a directory whose name starts with a dot", async () => {
  // Local development puts builds under .local/public. Express refuses dotted
  // paths by default, which turned every page into a 500 until sendFile was
  // told the path is ours, not the request's.
  const root = mkdtempSync(path.join(tmpdir(), "mobicare-dot-"));
  const dotted = path.join(root, ".local", "public");
  mkdirSync(path.join(dotted, "gateway"), { recursive: true });
  writeFileSync(path.join(dotted, "gateway", "index.html"), "<!doctype html><title>Gateway</title>");

  const app = makeApp(dotted);
  const response = await get(app, "/");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Gateway/);
});

test("a site that was not built is simply not mounted", () => {
  const root = mkdtempSync(path.join(tmpdir(), "mobicare-partial-"));
  mkdirSync(path.join(root, "gateway"), { recursive: true });
  writeFileSync(path.join(root, "gateway", "index.html"), "<!doctype html>");

  const previous = process.env["SERVE_STATIC_DIR"];
  process.env["SERVE_STATIC_DIR"] = root;
  try {
    const mounted = mountStaticSites(express());
    assert.equal(mounted.length, 1);
    assert.match(mounted[0]!, /gateway/);
  } finally {
    if (previous === undefined) delete process.env["SERVE_STATIC_DIR"];
    else process.env["SERVE_STATIC_DIR"] = previous;
  }
});
