import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCompleteGoogleSignUp, useLogin, useRegisterPatient, useSignInWithGoogle } from '@workspace/api-client-react';
import {
  PT_ACCESS_KEY as ACCESS_KEY,
  PT_REFRESH_KEY as REFRESH_KEY,
  PT_USER_KEY as USER_KEY,
  freshToken,
  sessionExpiredEvent,
  tokenSecondsLeft,
} from '@/lib/portalToken';

export interface PatientUser {
  id: string;
  name: string;
  phone: string;
}

interface PatientAuthValue {
  user: PatientUser | null;
  profileCompletionPending: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (
    name: string,
    phone: string,
    password: string,
    dateOfBirth: string,
    consent: { acceptTermsAndPrivacy: true; acceptResearchAnalytics: boolean },
  ) => Promise<void>;
  /**
   * Signs in with Google. A Google account not yet linked to a patient comes
   * back as `needs_profile`: the phone number and date of birth come next.
   */
  signInWithGoogle: (credential: string) => Promise<GoogleOutcome>;
  completeGoogleSignUp: (details: {
    signupToken: string;
    name: string;
    phone: string;
    dateOfBirth: string;
    acceptTermsAndPrivacy: true;
    acceptResearchAnalytics: boolean;
  }) => Promise<void>;
  updateUserName: (name: string) => void;
  dismissProfileCompletion: () => void;
  logout: () => void;
}

export type GoogleOutcome =
  | { status: 'signed_in' }
  | { status: 'needs_profile'; signupToken: string; name: string | null; email: string | null };

/** The server's own words where it gave some, otherwise the fallback. */
function serverMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { error?: unknown } } | null)?.data;
  return typeof data?.error === 'string' ? data.error : fallback;
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
  const [profileCompletionPending, setProfileCompletionPending] = useState(false);
  const queryClient = useQueryClient();
  const loginMutation = useLogin();
  const registerMutation = useRegisterPatient();

  const dismissProfileCompletion = useCallback(() => {
    setProfileCompletionPending(false);
  }, []);

  const updateUserName = useCallback((name: string) => {
    setUser((current) => {
      if (!current) return current;
      const next = { ...current, name };
      localStorage.setItem(USER_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const storeSession = useCallback(
    (accessToken: string, refreshToken: string, u: { id: string; name: string; phone?: string | null }) => {
      queryClient.clear();
      localStorage.setItem(ACCESS_KEY, accessToken);
      localStorage.setItem(REFRESH_KEY, refreshToken);
      const ptUser: PatientUser = { id: u.id, name: u.name, phone: u.phone ?? '' };
      localStorage.setItem(USER_KEY, JSON.stringify(ptUser));
      setUser(ptUser);
      setProfileCompletionPending(true);
    },
    [queryClient],
  );

  const login = useCallback(
    async (phone: string, password: string) => {
      const res = await loginMutation
        .mutateAsync({ data: { identifier: phone, password } })
        .catch((err: unknown) => {
          // An account made with Google has no password: say so instead.
          const code = (err as { data?: { code?: string } } | null)?.data?.code;
          throw new Error(code === 'GOOGLE_ACCOUNT' ? serverMessage(err, '') : 'Wrong phone number or password');
        });
      if (res.user.role !== 'patient') {
        throw new Error('This login is for patients. Pharmacies and HQ staff have their own portals.');
      }
      storeSession(res.accessToken, res.refreshToken, res.user);
    },
    [loginMutation, storeSession],
  );

  const register = useCallback(
    async (
      name: string,
      phone: string,
      password: string,
      dateOfBirth: string,
      // Typed as literal true: the account and the consent that permits holding
      // it are created together, so there is no way to call this without it.
      consent: { acceptTermsAndPrivacy: true; acceptResearchAnalytics: boolean },
    ) => {
      const res = await registerMutation
        .mutateAsync({ data: { name, phone, password, dateOfBirth, ...consent } })
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

  const googleSignIn = useSignInWithGoogle();
  const googleSignUp = useCompleteGoogleSignUp();

  const signInWithGoogle = useCallback(
    async (credential: string): Promise<GoogleOutcome> => {
      const res = await googleSignIn
        .mutateAsync({ data: { credential } })
        .catch((err: unknown) => {
          throw new Error(serverMessage(err, 'Google sign-in did not work. Try again, or use your phone number.'));
        });
      if (res.status === 'needs_profile') {
        return { status: 'needs_profile', signupToken: res.signupToken!, name: res.name ?? null, email: res.email ?? null };
      }
      storeSession(res.accessToken!, res.refreshToken!, res.user!);
      return { status: 'signed_in' };
    },
    [googleSignIn, storeSession],
  );

  const completeGoogleSignUp = useCallback(
    async (details: Parameters<PatientAuthValue['completeGoogleSignUp']>[0]) => {
      const res = await googleSignUp
        .mutateAsync({ data: details })
        .catch((err: unknown) => {
          throw new Error(serverMessage(err, 'Could not create your account. Check your details and try again.'));
        });
      storeSession(res.accessToken!, res.refreshToken!, res.user!);
    },
    [googleSignUp, storeSession],
  );

  const logout = useCallback(() => {
    queryClient.clear();
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }, [queryClient]);

  // Rotate the 15-minute access token before expiry; log out if refresh fails.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function ensureFresh() {
      // The same renewal every request uses, so the refresh token is never
      // sent twice.
      const token = await freshToken('patient');
      if (!cancelled && !(token && tokenSecondsLeft(ACCESS_KEY) > 0)) logout();
    }
    const onExpired = () => logout();
    window.addEventListener(sessionExpiredEvent('patient'), onExpired);

    void ensureFresh();
    const interval = setInterval(ensureFresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener(sessionExpiredEvent('patient'), onExpired);
    };
  }, [user, logout]);

  return (
    <PatientAuthContext.Provider value={{
      user,
      login,
      register,
      signInWithGoogle,
      completeGoogleSignUp,
      updateUserName,
      logout,
      profileCompletionPending,
      dismissProfileCompletion,
    }}>
      {children}
    </PatientAuthContext.Provider>
  );
}

export function usePatientAuth(): PatientAuthValue {
  const ctx = useContext(PatientAuthContext);
  if (!ctx) throw new Error('usePatientAuth must be used within PatientAuthProvider');
  return ctx;
}
