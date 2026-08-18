import { setAuthTokenGetter } from '@workspace/api-client-react';

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

setAuthTokenGetter(() => {
  const portal = currentPortal();
  if (portal === 'hq') return localStorage.getItem(HQ_ACCESS_KEY);
  if (portal === 'patient') return localStorage.getItem(PT_ACCESS_KEY);
  return null;
});

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
