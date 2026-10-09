/**
 * Content security policy for the website, patient app, HQ dashboard and
 * pharmacy portal.
 *
 * Sent with every page, it tells the browser the only places a page may load
 * code, styles, fonts, pictures and connections from. If harmful code were ever
 * slipped into a page, the browser would refuse to run it or let it send data
 * anywhere else — the protection that matters most while sign-ins are kept in
 * the browser. Each refusal is reported to /api/security/csp-report and shows
 * up in HQ's security activity.
 *
 * What the pages legitimately use, and why each is allowed:
 *
 *   accounts.google.com/gsi   Google sign-in (script, its pop-up frame, styles)
 *   fonts.googleapis.com      Google Fonts stylesheets
 *   fonts.gstatic.com         Google Fonts font files
 *   tile.openstreetmap.org    map pictures (or VITE_MAP_TILE_URL's host)
 *   S3_ENDPOINT               HQ uploads go straight to file storage
 *
 * Inline styles are allowed (the interface libraries set them); inline and
 * outside scripts are not.
 *
 * Settings:
 *   CSP_MODE=report-only      report problems without blocking anything, for
 *                             trying a new service before allowing it
 *   CSP_EXTRA_IMG_SRC         extra picture sources, space-separated
 *   CSP_EXTRA_CONNECT_SRC     extra connection targets, space-separated
 */

export const CSP_REPORT_PATH = "/api/security/csp-report";

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.replace(/\{[a-z]\}\./gi, "x."));
    // A tile URL with a {s} subdomain allows every subdomain of that host.
    const host = /\{[a-z]\}\./i.test(url) ? `*.${parsed.host.replace(/^x\./, "")}` : parsed.host;
    return `${parsed.protocol}//${host}`;
  } catch {
    return null;
  }
}

/** Where the browser uploads to and reads files from directly. */
function storageOrigins(env: NodeJS.ProcessEnv): string[] {
  const endpoint = origin(env["S3_ENDPOINT"]);
  if (!endpoint) return [];
  if (env["S3_FORCE_PATH_STYLE"] === "false" && env["S3_BUCKET"]) {
    const url = new URL(endpoint);
    return [`${url.protocol}//${env["S3_BUCKET"]}.${url.host}`];
  }
  return [endpoint];
}

function extra(value: string | undefined): string[] {
  return (value ?? "").split(/\s+/).filter((source) => /^(https:\/\/[\w.*-]+(:\d+)?|data:|blob:)$/.test(source));
}

export function contentSecurityPolicy(env: NodeJS.ProcessEnv = process.env): { name: string; value: string } {
  const tiles = origin(env["VITE_MAP_TILE_URL"]) ?? "https://tile.openstreetmap.org";
  const storage = storageOrigins(env);
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "https://accounts.google.com/gsi/client"],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://accounts.google.com/gsi/style"],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
    "img-src": ["'self'", "data:", "blob:", tiles, ...storage, ...extra(env["CSP_EXTRA_IMG_SRC"])],
    "connect-src": ["'self'", "https://accounts.google.com/gsi/", ...storage, ...extra(env["CSP_EXTRA_CONNECT_SRC"])],
    "frame-src": ["https://accounts.google.com/gsi/"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    // report-uri alone: every browser sends these at once. Adding the newer
    // report-to makes Chrome use it instead, which batches reports and holds
    // them, so a blocked attack would show up late or not at all.
    "report-uri": [CSP_REPORT_PATH],
  };
  const parts = Object.entries(directives).map(([name, sources]) => `${name} ${[...new Set(sources)].join(" ")}`);
  // Production is HTTPS only: any stray http:// address is upgraded rather
  // than loaded in the clear. Not locally, where the site itself is http.
  if (env["NODE_ENV"] === "production") parts.push("upgrade-insecure-requests");
  return {
    name: env["CSP_MODE"] === "report-only" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
    value: parts.join("; "),
  };
}

/** Headers for an HTML page. */
export function pageSecurityHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const policy = contentSecurityPolicy(env);
  return { [policy.name]: policy.value };
}
