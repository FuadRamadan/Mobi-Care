import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { useLogin } from '@workspace/api-client-react';
import {
  HQ_ACCESS_KEY as ACCESS_KEY,
  HQ_REFRESH_KEY as REFRESH_KEY,
  HQ_USER_KEY as USER_KEY,
  tokenSecondsLeft,
} from '@/lib/portalToken';

export interface HqUser {
  id: string;
  name: string;
  username: string;
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
      localStorage.setItem(ACCESS_KEY, accessToken);
      localStorage.setItem(REFRESH_KEY, refreshToken);
      const hqUser: HqUser = { id: u.id, name: u.name, username: u.username };
      localStorage.setItem(USER_KEY, JSON.stringify(hqUser));
      setUser(hqUser);
    },
    [loginMutation],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  // Keep the 15-minute access token fresh: check every minute and rotate via
  // /auth/refresh when it is close to (or past) expiry. On refresh failure,
  // clear the session so the guard redirects to the login page.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function ensureFresh() {
      const secondsLeft = tokenSecondsLeft(ACCESS_KEY);
      if (Number.isNaN(secondsLeft)) return logout();
      if (secondsLeft > 120) return;
      const refreshToken = localStorage.getItem(REFRESH_KEY);
      if (!refreshToken) return logout();
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) throw new Error(`refresh failed (${res.status})`);
        const data = (await res.json()) as { accessToken: string; refreshToken: string };
        if (cancelled) return;
        localStorage.setItem(ACCESS_KEY, data.accessToken);
        localStorage.setItem(REFRESH_KEY, data.refreshToken);
      } catch {
        if (!cancelled) logout();
      }
    }

    void ensureFresh();
    const interval = setInterval(ensureFresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
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
