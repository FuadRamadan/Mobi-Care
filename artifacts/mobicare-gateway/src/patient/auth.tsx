import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { useLogin, useRegisterPatient } from '@workspace/api-client-react';
import {
  PT_ACCESS_KEY as ACCESS_KEY,
  PT_REFRESH_KEY as REFRESH_KEY,
  PT_USER_KEY as USER_KEY,
  tokenSecondsLeft,
} from '@/lib/portalToken';

export interface PatientUser {
  id: string;
  name: string;
  phone: string;
}

interface PatientAuthValue {
  user: PatientUser | null;
  login: (phone: string, password: string) => Promise<void>;
  register: (name: string, phone: string, password: string) => Promise<void>;
  logout: () => void;
}

const PatientAuthContext = createContext<PatientAuthValue | null>(null);

function readStoredUser(): PatientUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw && localStorage.getItem(ACCESS_KEY) ? (JSON.parse(raw) as PatientUser) : null;
  } catch {
    return null;
  }
}

export function PatientAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PatientUser | null>(readStoredUser);
  const loginMutation = useLogin();
  const registerMutation = useRegisterPatient();

  const storeSession = useCallback(
    (accessToken: string, refreshToken: string, u: { id: string; name: string; phone?: string | null }) => {
      localStorage.setItem(ACCESS_KEY, accessToken);
      localStorage.setItem(REFRESH_KEY, refreshToken);
      const ptUser: PatientUser = { id: u.id, name: u.name, phone: u.phone ?? '' };
      localStorage.setItem(USER_KEY, JSON.stringify(ptUser));
      setUser(ptUser);
    },
    [],
  );

  const login = useCallback(
    async (phone: string, password: string) => {
      const res = await loginMutation
        .mutateAsync({ data: { identifier: phone, password } })
        .catch(() => {
          throw new Error('Wrong phone number or password');
        });
      if (res.user.role !== 'patient') {
        throw new Error('This login is for patients. Pharmacies and HQ staff have their own portals.');
      }
      storeSession(res.accessToken, res.refreshToken, res.user);
    },
    [loginMutation, storeSession],
  );

  const register = useCallback(
    async (name: string, phone: string, password: string) => {
      const res = await registerMutation
        .mutateAsync({ data: { name, phone, password } })
        .catch((err: any) => {
          throw new Error(
            err?.status === 409 || /exists/i.test(String(err?.message))
              ? 'An account with this phone number already exists — try signing in.'
              : 'Could not create your account. Check your details and try again.',
          );
        });
      storeSession(res.accessToken, res.refreshToken, res.user);
    },
    [registerMutation, storeSession],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, []);

  // Rotate the 15-minute access token before expiry; log out if refresh fails.
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
    <PatientAuthContext.Provider value={{ user, login, register, logout }}>
      {children}
    </PatientAuthContext.Provider>
  );
}

export function usePatientAuth(): PatientAuthValue {
  const ctx = useContext(PatientAuthContext);
  if (!ctx) throw new Error('usePatientAuth must be used within PatientAuthProvider');
  return ctx;
}
