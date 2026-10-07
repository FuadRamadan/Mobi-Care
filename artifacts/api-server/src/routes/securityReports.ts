import { safeRouter } from "../lib/safeRouter.js";
import { recordSecurityEvent } from "../lib/securityEvents.js";

/**
 * POST /api/security/csp-report
 *
 * Browsers send a report here whenever the content security policy blocks
 * something on a MobiCare page (lib/contentSecurityPolicy.ts). Both report
 * formats are accepted: the older "csp-report" object and the newer Reporting
 * API list. Only the address's origin and path are kept, never its query
 * string, which can carry an image link's signature.
 */
const router = safeRouter();

type Violation = { blocked: string; directive: string; page: string };

/** The same violation from the same page counts once per 10 minutes. */
const recent = new Map<string, number>();
const REPEAT_MS = 10 * 60_000;

function trimUrl(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return value.slice(0, 40); // "inline", "eval", "data"
  try {
    const url = new URL(value);
    return url.protocol.startsWith("http") ? `${url.origin}${url.pathname}`.slice(0, 300) : url.protocol;
  } catch {
    return value.slice(0, 40);
  }
}

function violations(body: unknown): Violation[] {
  const list = Array.isArray(body) ? body : [body];
  return list.flatMap((item): Violation[] => {
    if (!item || typeof item !== "object") return [];
    const report = (item as Record<string, unknown>)["csp-report"] ?? (item as Record<string, unknown>)["body"];
    if (!report || typeof report !== "object") return [];
    const r = report as Record<string, unknown>;
    return [{
      blocked: trimUrl(r["blocked-uri"] ?? r["blockedURL"]),
      directive: String(r["effective-directive"] ?? r["effectiveDirective"] ?? r["violated-directive"] ?? "").slice(0, 60),
      page: trimUrl(r["document-uri"] ?? r["documentURL"]),
    }];
  });
}

router.post("/csp-report", async (req, res) => {
  const now = Date.now();
  for (const [key, at] of recent) if (now - at > REPEAT_MS) recent.delete(key);
  for (const violation of violations(req.body).slice(0, 10)) {
    const key = `${violation.directive}|${violation.blocked}|${violation.page}`;
    if (recent.has(key) || recent.size > 1000) continue;
    recent.set(key, now);
    await recordSecurityEvent({
      kind: "csp_violation",
      ipAddress: req.ip,
      path: violation.page,
      details: { blocked: violation.blocked, directive: violation.directive },
    });
  }
  res.status(204).end();
});

export default router;
