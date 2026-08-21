import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
  useRef,
} from "react";
import { PharmacyUser, PasswordChangeResult, PasswordPolicy, useLogin, useLogout, useRefreshToken } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface AuthContextType {
  user: PharmacyUser | null;
  passwordPolicy: PasswordPolicy | null;
  login: ReturnType<typeof useLogin>["mutateAsync"];
  logout: () => void;
  completePasswordChange: (res: PasswordChangeResult) => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

function decodeJwt(token: string) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

function readSessionJson<T>(key: string): T | null {
  const value = sessionStorage.getItem(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PharmacyUser | null>(null);
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicy | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const hasInitialized = useRef(false);

  const loginMutation = useLogin();
  const logoutMutation = useLogout();
  const refreshMutation = useRefreshToken();

  useEffect(() => {
    const handleInvalidatedSession = () => {
      queryClient.clear();
      localStorage.removeItem("mc_access");
      localStorage.removeItem("mc_refresh");
      sessionStorage.removeItem("mc_user");
      sessionStorage.removeItem("mc_policy");
      sessionStorage.removeItem("mc_banner_dismissed");
      setUser(null);
      setPasswordPolicy(null);
      setLocation("/login");
      toast.error("Your session was ended after a security update. Please sign in again.");
    };

    window.addEventListener("mobicare:session-invalidated", handleInvalidatedSession);
    return () => {
      window.removeEventListener("mobicare:session-invalidated", handleInvalidatedSession);
    };
  }, [queryClient, setLocation]);

  useEffect(() => {
    const handlePasswordChangeRequired = () => {
      setUser((currentUser) => {
        if (!currentUser) return currentUser;
        const updatedUser = { ...currentUser, mustChangePassword: true };
        sessionStorage.setItem("mc_user", JSON.stringify(updatedUser));
        return updatedUser;
      });
      setLocation("/change-password");
      toast.warning("Your password has expired. Set a new password to continue.");
    };

    window.addEventListener("mobicare:password-change-required", handlePasswordChangeRequired);
    return () => {
      window.removeEventListener("mobicare:password-change-required", handlePasswordChangeRequired);
    };
  }, [setLocation]);

  const handleLogout = useCallback(async () => {
    const refresh = localStorage.getItem("mc_refresh");
    if (refresh) {
      try {
        await logoutMutation.mutateAsync({ data: { refreshToken: refresh } });
      } catch (e) {
        // ignore errors on logout
      }
    }
    queryClient.clear();
    localStorage.removeItem("mc_access");
    localStorage.removeItem("mc_refresh");
    sessionStorage.removeItem("mc_user");
    sessionStorage.removeItem("mc_policy");
    sessionStorage.removeItem("mc_banner_dismissed");
    setUser(null);
    setPasswordPolicy(null);
    setLocation("/login");
  }, [logoutMutation, queryClient, setLocation]);

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    async function initAuth() {
      const access = localStorage.getItem("mc_access");
      const refresh = localStorage.getItem("mc_refresh");

      if (access) {
        const decoded = decodeJwt(access);
        if (decoded && decoded.exp * 1000 > Date.now()) {
          const decodedUser = decoded.user || decoded;
          const savedUser = readSessionJson<PharmacyUser>("mc_user");
          const sameUser =
            savedUser &&
            (savedUser.id === decodedUser.id || savedUser.id === decodedUser.sub);
          setUser(sameUser ? { ...savedUser, ...decodedUser } : decodedUser);
          const claimPolicy = decoded.passwordPolicy || decoded.user?.passwordPolicy;
          if (claimPolicy) {
            setPasswordPolicy(claimPolicy);
            sessionStorage.setItem("mc_policy", JSON.stringify(claimPolicy));
          } else {
            setPasswordPolicy(readSessionJson<PasswordPolicy>("mc_policy"));
          }
          setIsLoading(false);
          return;
        }
      }

      if (refresh) {
        try {
          const res = await refreshMutation.mutateAsync({ data: { refreshToken: refresh } });
          localStorage.setItem("mc_access", res.accessToken);
          localStorage.setItem("mc_refresh", res.refreshToken);
          const decoded = decodeJwt(res.accessToken);
          const decodedUser = decoded?.user || decoded;
          const savedUser = readSessionJson<PharmacyUser>("mc_user");
          const sameUser =
            savedUser &&
            decodedUser &&
            (savedUser.id === decodedUser.id || savedUser.id === decodedUser.sub);
          setUser(sameUser ? { ...savedUser, ...decodedUser } : decodedUser);
          const claimPolicy = decoded?.passwordPolicy || decoded?.user?.passwordPolicy;
          if (claimPolicy) {
            setPasswordPolicy(claimPolicy);
            sessionStorage.setItem("mc_policy", JSON.stringify(claimPolicy));
          } else {
            setPasswordPolicy(readSessionJson<PasswordPolicy>("mc_policy"));
          }
        } catch (e) {
          queryClient.clear();
          localStorage.removeItem("mc_access");
          localStorage.removeItem("mc_refresh");
          sessionStorage.removeItem("mc_user");
          sessionStorage.removeItem("mc_policy");
          setUser(null);
          setPasswordPolicy(null);
        }
      }
      setIsLoading(false);
    }

    initAuth();
  }, [queryClient, refreshMutation]);

  const login = async (...args: Parameters<typeof loginMutation.mutateAsync>) => {
    const res = await loginMutation.mutateAsync(...args);
    queryClient.clear();
    localStorage.setItem("mc_access", res.accessToken);
    localStorage.setItem("mc_refresh", res.refreshToken);
    sessionStorage.setItem("mc_user", JSON.stringify(res.user));
    if (res.passwordPolicy) {
      sessionStorage.setItem("mc_policy", JSON.stringify(res.passwordPolicy));
      setPasswordPolicy(res.passwordPolicy);
    }
    sessionStorage.removeItem("mc_banner_dismissed");
    setUser(res.user);
    if (res.user.mustChangePassword) {
      setLocation("/change-password");
    } else {
      toast.success(`Welcome to ${res.user.name}`);
      setLocation("/dashboard");
    }
    return res;
  };

  const completePasswordChange = useCallback((res: PasswordChangeResult) => {
    if (res.accessToken && res.refreshToken && res.user) {
      localStorage.setItem("mc_access", res.accessToken);
      localStorage.setItem("mc_refresh", res.refreshToken);
      sessionStorage.setItem("mc_user", JSON.stringify(res.user));
      if (res.passwordPolicy) {
        sessionStorage.setItem("mc_policy", JSON.stringify(res.passwordPolicy));
        setPasswordPolicy(res.passwordPolicy);
      }
      setUser(res.user);
      queryClient.clear();
      setLocation("/dashboard");
      toast.success("Password updated successfully");
    }
  }, [queryClient, setLocation]);

  return (
    <AuthContext.Provider value={{ user, passwordPolicy, login, logout: handleLogout, completePasswordChange, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
