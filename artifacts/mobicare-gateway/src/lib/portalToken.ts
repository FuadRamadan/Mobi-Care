import { setAuthTokenGetter } from '@workspace/api-client-react';
import { apiUrl } from '@/lib/apiUrl';

/**
 * The gateway hosts two authenticated portals in one SPA:
 *   /hq/*  — HQ staff dashboard   (mc_hq_* keys)
 *   /app/* — patient experience   (mc_pt_* keys)
 *
 * The generated API client has a single token getter, so pick the token by
 * the current path. Public marketing pages send no token.
 */
export const HQ_ACCESS_KEY = 'mc_hq_access';
export const HQ_REFRESH_KEY = 'mc_hq_refresh';
export const HQ_USER_KEY = 'mc_hq_user';

export const PT_ACCESS_KEY = 'mc_pt_access';
export const PT_REFRESH_KEY = 'mc_pt_refresh';
export const PT_USER_KEY = 'mc_pt_user';

function currentPortal(): 'hq' | 'patient' | null {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = window.location.pathname.startsWith(base)
    ? window.location.pathname.slice(base.length)
    : window.location.pathname;
  if (path === '/hq' || path.startsWith('/hq/')) return 'hq';
  if (path === '/app' || path.startsWith('/app/')) return 'patient';
  return null;
}

// Every request gets a valid token: one about to expire is renewed first,
// which also covers a background tab or a sleeping laptop whose timers paused.
setAuthTokenGetter(() => {
  const portal = currentPortal();
  return portal ? freshToken(portal) : null;
});

type Portal = 'hq' | 'patient';
const KEYS: Record<Portal, { access: string; refresh: string }> = {
  hq: { access: HQ_ACCESS_KEY, refresh: HQ_REFRESH_KEY },
  patient: { access: PT_ACCESS_KEY, refresh: PT_REFRESH_KEY },
};
/** Renew when fewer than this many seconds are left. */
const RENEW_MARGIN_SECONDS = 120;

/** Fired when a portal's session cannot be renewed; its auth provider signs out. */
export const sessionExpiredEvent = (portal: Portal) => `mobicare:${portal}-session-expired`;

// Refresh tokens are single-use, so one renewal at a time per portal.
const renewing: Partial<Record<Portal, Promise<string | null>>> = {};

/** The portal's access token, renewed first if it is about to expire. */
export function freshToken(portal: Portal): Promise<string | null> {
  const { access, refresh } = KEYS[portal];
  const token = localStorage.getItem(access);
  if (!token && !localStorage.getItem(refresh)) return Promise.resolve(null);
  if (token && tokenSecondsLeft(access) > RENEW_MARGIN_SECONDS) return Promise.resolve(token);
  renewing[portal] ??= renew(portal).finally(() => {
    delete renewing[portal];
  });
  return renewing[portal]!;
}

async function renew(portal: Portal): Promise<string | null> {
  const { access, refresh } = KEYS[portal];
  const refreshToken = localStorage.getItem(refresh);
  let rejected = !refreshToken;
  if (refreshToken) {
    try {
      const res = await fetch(apiUrl('/api/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (res.ok) {
        const data = (await res.json()) as { accessToken: string; refreshToken: string };
        localStorage.setItem(access, data.accessToken);
        localStorage.setItem(refresh, data.refreshToken);
        return data.accessToken;
      }
      rejected = res.status === 401;
    } catch {
      // Offline: keep the session; the next request tries again.
    }
  }
  // Another tab may have renewed with the same refresh token a moment ago.
  if (tokenSecondsLeft(access) > 0) return localStorage.getItem(access);
  if (rejected) window.dispatchEvent(new Event(sessionExpiredEvent(portal)));
  return null;
}

/** Decode seconds-until-expiry of a stored JWT (NaN if absent/unreadable). */
export function tokenSecondsLeft(storageKey: string): number {
  const token = localStorage.getItem(storageKey);
  if (!token) return NaN;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp - Date.now() / 1000;
  } catch {
    return NaN;
  }
}
