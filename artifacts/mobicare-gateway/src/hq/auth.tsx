import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLogin } from '@workspace/api-client-react';
import {
  HQ_ACCESS_KEY as ACCESS_KEY,
  HQ_REFRESH_KEY as REFRESH_KEY,
  HQ_USER_KEY as USER_KEY,
  freshToken,
  sessionExpiredEvent,
  tokenSecondsLeft,
} from '@/lib/portalToken';

export interface HqUser {
  id: string;
  name: string;
  username: string;
  canManageIntegrations: boolean;
  canManageSettlements: boolean;
  canManageCatalogue: boolean;
  canViewDataInsights: boolean;
}

interface HqAuthValue {
  user: HqUser | null;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => void;
}

const HqAuthContext = createContext<HqAuthValue | null>(null);

function readStoredUser(): HqUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw && localStorage.getItem(ACCESS_KEY) ? (JSON.parse(raw) as HqUser) : null;
  } catch {
    return null;
  }
}

export function HqAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<HqUser | null>(readStoredUser);
  const queryClient = useQueryClient();
  const loginMutation = useLogin();

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await loginMutation
        .mutateAsync({ data: { identifier, password } })
        .catch(() => {
          throw new Error('Invalid username or password');
        });
      const { accessToken, refreshToken, user: u } = res;
      if (u.role !== 'hq') {
        throw new Error('This login is for HQ staff only. Pharmacies should use the Pharmacy Portal.');
      }
      queryClient.clear();
      localStorage.setItem(ACCESS_KEY, accessToken);
      localStorage.setItem(REFRESH_KEY, refreshToken);
      const hqUser: HqUser = {
        id: u.id,
        name: u.name,
        username: u.username,
        canManageIntegrations: u.canManageIntegrations === true,
        canManageSettlements: u.canManageSettlements === true,
        // Absent from logins made before the permission existed; the server
        // is the real check, so the screen stays usable until the next login.
        canManageCatalogue: u.canManageCatalogue !== false,
        canViewDataInsights: u.canViewDataInsights === true,
      };
      localStorage.setItem(USER_KEY, JSON.stringify(hqUser));
      setUser(hqUser);
    },
    [loginMutation, queryClient],
  );

  const logout = useCallback(() => {
    queryClient.clear();
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, [queryClient]);

  // Keep the 15-minute access token fresh: check every minute and rotate via
  // /auth/refresh when it is close to (or past) expiry. On refresh failure,
  // clear the session so the guard redirects to the login page.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function ensureFresh() {
      // The same renewal every request uses, so the refresh token is never
      // sent twice.
      const token = await freshToken('hq');
      if (!cancelled && !(token && tokenSecondsLeft(ACCESS_KEY) > 0)) logout();
    }
    const onExpired = () => logout();
    window.addEventListener(sessionExpiredEvent('hq'), onExpired);

    void ensureFresh();
    const interval = setInterval(ensureFresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener(sessionExpiredEvent('hq'), onExpired);
    };
  }, [user, logout]);

  return (
    <HqAuthContext.Provider value={{ user, login, logout }}>
      {children}
    </HqAuthContext.Provider>
  );
}

export function useHqAuth(): HqAuthValue {
  const ctx = useContext(HqAuthContext);
  if (!ctx) throw new Error('useHqAuth must be used within HqAuthProvider');
  return ctx;
}
