/**
 * Optional static hosting for the two web frontends.
 *
 * Lets the whole platform deploy as a single application: the API at /api, the
 * pharmacy portal at /pharmacy-portal, and the gateway (public site, patient
 * app and HQ dashboard) at the root. That matches how the gateway already links
 * between them in src/config/portals.ts, and because everything is one origin
 * there is no cross-origin request to configure at all.
 *
 * Off unless SERVE_STATIC_DIR is set, so nothing changes for anyone running the
 * API on its own with the frontends hosted separately.
 *
 * Expected layout under SERVE_STATIC_DIR:
 *
 *   <dir>/gateway/           built with BASE_PATH=/
 *   <dir>/pharmacy-portal/   built with BASE_PATH=/pharmacy-portal/
 *
 * Each site must be built with the BASE_PATH it is served from, or its asset
 * URLs will point at the wrong place.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Express, type Request, type Response } from "express";

/**
 * Everything Vite emits into assets/ carries a content hash in its filename, so
 * those files never change and can be cached indefinitely. Matching on the
 * directory rather than guessing at the filename shape: Vite writes
 * "index-DPfUf00k.js", not "index.DPfUf00k.js", and a filename pattern loose
 * enough to catch that also catches ordinary hyphenated names.
 */
const ASSETS_DIR = `${path.sep}assets${path.sep}`;

interface Site {
  /** URL prefix, "/" for the root site. */
  mount: string;
  /** Directory name under SERVE_STATIC_DIR. */
  directory: string;
}

const SITES: Site[] = [
  // Longest prefix first: the portal must match before the root site.
  { mount: "/pharmacy-portal", directory: "pharmacy-portal" },
  { mount: "/", directory: "gateway" },
];

function staticOptions(): Parameters<typeof express.static>[1] {
  return {
    // index.html is served by the fallback below so its headers stay under our
    // control; letting express.static serve it would cache the entry point.
    index: false,
    redirect: false,
    setHeaders(res, filePath) {
      if (filePath.includes(ASSETS_DIR)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        res.setHeader("Cache-Control", "public, max-age=300");
      }
    },
  };
}

/**
 * Serve a site's index.html for navigation requests that matched no file.
 *
 * Only for requests a browser makes when navigating: a GET that accepts HTML
 * and has no file extension. A missing script or image must stay a 404 rather
 * than quietly returning HTML, which turns a deploy mistake into a confusing
 * parse error in the console instead of an obvious missing file.
 */
function spaFallback(indexFile: string) {
  return (req: Request, res: Response, next: express.NextFunction): void => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (!req.accepts("html")) {
      next();
      return;
    }
    if (path.extname(req.path)) {
      next();
      return;
    }

    // The entry point must never be cached, or a released build keeps loading
    // asset URLs that no longer exist.
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(indexFile, (error) => {
      if (error) next(error);
    });
  };
}

/**
 * Mount the built frontends, if configured. Returns what was mounted so startup
 * can report it.
 *
 * Must be called after the API routes: the API owns /api, and the root site's
 * fallback would otherwise answer for it.
 */
export function mountStaticSites(app: Express): string[] {
  const root = process.env["SERVE_STATIC_DIR"];
  if (!root) return [];

  const resolvedRoot = path.resolve(root);
  const mounted: string[] = [];

  for (const site of SITES) {
    const directory = path.join(resolvedRoot, site.directory);
    const indexFile = path.join(directory, "index.html");

    if (!existsSync(indexFile)) {
      // A site that was not built simply is not served. Reported by the caller
      // so a missing build is visible at startup rather than as a 404 later.
      continue;
    }

    app.use(site.mount, express.static(directory, staticOptions()));
    app.use(site.mount, spaFallback(indexFile));
    mounted.push(`${site.mount} → ${path.relative(process.cwd(), directory)}`);
  }

  return mounted;
}

/** Whether static hosting is switched on, for startup logging. */
export function staticHostingConfigured(): boolean {
  return Boolean(process.env["SERVE_STATIC_DIR"]);
}
