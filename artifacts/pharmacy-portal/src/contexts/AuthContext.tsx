import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { PharmacyUser, useLogin, useLogout, useRefreshToken } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface AuthContextType {
  user: PharmacyUser | null;
  login: ReturnType<typeof useLogin>["mutateAsync"];
  logout: () => void;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PharmacyUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const loginMutation = useLogin();
  const logoutMutation = useLogout();
  const refreshMutation = useRefreshToken();

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
    setUser(null);
    setLocation("/login");
  }, [logoutMutation, queryClient, setLocation]);

  useEffect(() => {
    async function initAuth() {
      const access = localStorage.getItem("mc_access");
      const refresh = localStorage.getItem("mc_refresh");

      if (access) {
        const decoded = decodeJwt(access);
        if (decoded && decoded.exp * 1000 > Date.now()) {
          setUser(decoded.user || decoded); // depending on how user is packed in JWT, usually decoded contains user object or fields directly
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
          setUser(decoded?.user || decoded);
        } catch (e) {
          queryClient.clear();
          localStorage.removeItem("mc_access");
          localStorage.removeItem("mc_refresh");
          setUser(null);
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
    setUser(res.user);
    toast.success(`Welcome to ${res.user.name}`);
    setLocation("/dashboard");
    return res;
  };

  return (
    <AuthContext.Provider value={{ user, login, logout: handleLogout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
