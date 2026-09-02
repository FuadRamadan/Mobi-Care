import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useQueryClient } from '@tanstack/react-query';
import { login as apiLogin, logout as apiLogout, refreshToken as apiRefreshToken, registerPatient as apiRegisterPatient, setAuthTokenGetter, updatePatientPushToken } from '@workspace/api-client-react';
import { registerForPushNotifications } from '@/lib/pushNotifications';

/** Tokens go in platform-backed secure storage; display data goes in AsyncStorage. */
const SEC_KEY_ACCESS = 'mc_mobile_access';
const SEC_KEY_REFRESH = 'mc_mobile_refresh';
const ASYNC_KEY_USER = 'mc_mobile_user';

interface PatientUser {
  id: string;
  name: string;
  phone?: string | null;
  role: string;
}

interface AuthContextValue {
  user: PatientUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (name: string, phone: string, password: string, age: number) => Promise<void>;
  updateUser: (updates: Pick<PatientUser, 'name'>) => Promise<void>;
  logout: () => Promise<void>;
}

function getJwtExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const decoded = typeof atob !== 'undefined'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('binary');
    const payload = JSON.parse(decoded);
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Write a value to SecureStore on native; fall back to AsyncStorage on web (no Keychain). */
async function secureSet(key: string, value: string) {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    await AsyncStorage.setItem('__sec__' + key, value);
  }
}

async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return AsyncStorage.getItem('__sec__' + key);
  }
}

async function secureDelete(key: string) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch { /* ignore */ }
  try {
    await AsyncStorage.removeItem('__sec__' + key);
  } catch { /* ignore */ }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PatientUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const accessTokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);
  const queryClient = useQueryClient();

  // Register a stable token getter for the API client
  useEffect(() => {
    setAuthTokenGetter(() => accessTokenRef.current);
    return () => setAuthTokenGetter(null);
  }, []);

  /**
   * Ask for notification permission, get the Expo push token, and register it
   * on the backend. Fire-and-forget — push failures never block auth flows.
   */
  const syncPushToken = useCallback(() => {
    (async () => {
      try {
        const token = await registerForPushNotifications();
        if (token) await updatePatientPushToken({ expoPushToken: token });
      } catch {
        // best effort — push is optional
      }
    })();
  }, []);

  const applyTokens = useCallback(async (accessToken: string, refreshToken: string, userData: PatientUser) => {
    queryClient.clear();
    accessTokenRef.current = accessToken;
    refreshTokenRef.current = refreshToken;
    setUser(userData);
    // Tokens → SecureStore; display data → AsyncStorage
    await Promise.all([
      secureSet(SEC_KEY_ACCESS, accessToken),
      secureSet(SEC_KEY_REFRESH, refreshToken),
      AsyncStorage.setItem(ASYNC_KEY_USER, JSON.stringify(userData)),
    ]);
  }, [queryClient]);

  const clearSession = useCallback(async (refreshTok?: string | null) => {
    try {
      // Stop push notifications for this device before the token is invalidated
      if (accessTokenRef.current) await updatePatientPushToken({ expoPushToken: null });
    } catch { /* best effort */ }
    try {
      if (refreshTok) await apiLogout({ refreshToken: refreshTok });
    } catch { /* best effort */ }
    queryClient.clear();
    accessTokenRef.current = null;
    refreshTokenRef.current = null;
    setUser(null);
    await Promise.all([
      secureDelete(SEC_KEY_ACCESS),
      secureDelete(SEC_KEY_REFRESH),
      AsyncStorage.removeItem(ASYNC_KEY_USER),
    ]);
  }, [queryClient]);

  // Load stored session on mount
  useEffect(() => {
    async function loadSession() {
      try {
        const [at, rt, userStr] = await Promise.all([
          secureGet(SEC_KEY_ACCESS),
          secureGet(SEC_KEY_REFRESH),
          AsyncStorage.getItem(ASYNC_KEY_USER),
        ]);
        if (at && rt && userStr) {
          queryClient.clear();
          accessTokenRef.current = at;
          refreshTokenRef.current = rt;
          setUser(JSON.parse(userStr));
          // Refresh the device push token registration for the restored session
          syncPushToken();
        }
      } catch {
        // Storage read failed — start fresh
      } finally {
        setIsLoading(false);
      }
    }
    loadSession();
  }, [queryClient, syncPushToken]);

  // Proactive token refresh: check every 60s, refresh if ≤120s remaining
  useEffect(() => {
    const interval = setInterval(async () => {
      const at = accessTokenRef.current;
      const rt = refreshTokenRef.current;
      if (!at || !rt) return;
      try {
        const exp = getJwtExp(at);
        if (exp !== null && exp - Date.now() / 1000 <= 120) {
          const tokens = await apiRefreshToken({ refreshToken: rt });
          accessTokenRef.current = tokens.accessToken;
          refreshTokenRef.current = tokens.refreshToken;
          await Promise.all([
            secureSet(SEC_KEY_ACCESS, tokens.accessToken),
            secureSet(SEC_KEY_REFRESH, tokens.refreshToken),
          ]);
        }
      } catch {
        await clearSession(null);
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [clearSession]);

  const login = useCallback(async (phone: string, password: string) => {
    const result = await apiLogin({ identifier: phone, password });
    if (result.user.role !== 'patient') {
      throw new Error('This app is for patients only. Pharmacy staff use a separate portal.');
    }
    await applyTokens(result.accessToken, result.refreshToken, {
      id: result.user.id,
      name: result.user.name,
      phone: result.user.phone ?? null,
      role: result.user.role,
    });
    syncPushToken();
  }, [applyTokens, syncPushToken]);

  const register = useCallback(async (name: string, phone: string, password: string, age: number) => {
    const result = await apiRegisterPatient({ name, phone, password, age });
    await applyTokens(result.accessToken, result.refreshToken, {
      id: result.user.id,
      name: result.user.name,
      phone: result.user.phone ?? null,
      role: result.user.role,
    });
    syncPushToken();
  }, [applyTokens, syncPushToken]);

  const updateUser = useCallback(async (updates: Pick<PatientUser, 'name'>) => {
    if (!user) return;
    const next = { ...user, ...updates };
    setUser(next);
    await AsyncStorage.setItem(ASYNC_KEY_USER, JSON.stringify(next));
  }, [user]);

  const logout = useCallback(async () => {
    await clearSession(refreshTokenRef.current);
  }, [clearSession]);

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, register, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
