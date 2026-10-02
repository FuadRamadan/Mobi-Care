/**
 * Keeps the pharmacy's sign-in valid while the portal is open.
 *
 * An access token lasts 15 minutes. Every API request asks for a token here
 * first: one that is about to expire is renewed with the refresh token before
 * the request goes out. Renewing on demand, rather than on a timer, also
 * covers a tab that was in the background or a laptop that was asleep, where
 * browsers pause timers.
 *
 * Refresh tokens are single-use, so only one renewal runs at a time in a tab.
 * If another tab renewed first (and so used up the shared refresh token), its
 * new access token is picked up from storage instead of signing out.
 */

export const ACCESS_KEY = "mc_access";
export const REFRESH_KEY = "mc_refresh";

/** Renew when fewer than this many seconds are left. */
const RENEW_MARGIN_SECONDS = 60;

/** Fired when the session cannot be renewed and the pharmacy must sign in again. */
export const SESSION_EXPIRED_EVENT = "mobicare:session-expired";

export function tokenSecondsLeft(token: string | null): number {
  if (!token) return NaN;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp - Date.now() / 1000;
  } catch {
    return NaN;
  }
}

let renewing: Promise<string | null> | null = null;

/** The access token to send, renewed first if it is about to expire. */
export async function freshAccessToken(): Promise<string | null> {
  const access = localStorage.getItem(ACCESS_KEY);
  if (!access && !localStorage.getItem(REFRESH_KEY)) return null;
  if (access && tokenSecondsLeft(access) > RENEW_MARGIN_SECONDS) return access;
  renewing ??= renew().finally(() => {
    renewing = null;
  });
  return renewing;
}

async function renew(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  let rejected = false;
  if (refreshToken) {
    try {
      const base = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
      const res = await fetch(`${base}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (res.ok) {
        const data = (await res.json()) as { accessToken: string; refreshToken: string };
        localStorage.setItem(ACCESS_KEY, data.accessToken);
        localStorage.setItem(REFRESH_KEY, data.refreshToken);
        return data.accessToken;
      }
      rejected = res.status === 401;
    } catch {
      // Offline or the server is unreachable: keep the session and let the
      // request fail on its own; the next request tries again.
    }
  }
  // Another tab may have renewed with the same refresh token a moment ago.
  const latest = localStorage.getItem(ACCESS_KEY);
  if (latest && tokenSecondsLeft(latest) > 0) return latest;
  if (rejected || !refreshToken) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  return latest;
}
