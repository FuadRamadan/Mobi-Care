import { useAuth } from "@/contexts/AuthContext";
import {
  useGetUnreadCount,
  getGetUnreadCountQueryKey,
  useGetAnalyticsOverview,
  getGetAnalyticsOverviewQueryKey,
} from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, ShoppingBag, Package, FileText, User, Bell, LogOut } from "lucide-react";
import { MobiCareLogo } from "@/components/MobiCareLogo";
import clsx from "clsx";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/inventory", label: "Inventory", icon: Package },
];

const incomingItems = [
  { href: "/orders", label: "Incoming Orders", icon: ShoppingBag },
  { href: "/prescriptions", label: "Prescriptions", icon: FileText },
  { href: "/notifications", label: "Notifications", icon: Bell },
];

const accountItems = [
  { href: "/profile", label: "Profile", icon: User },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const LIVE_REFRESH_MS = 15_000;
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const { data: unreadData } = useGetUnreadCount({
    query: {
      refetchInterval: LIVE_REFRESH_MS,
      enabled: !!user,
      queryKey: getGetUnreadCountQueryKey(),
    },
  });

  const { data: analytics } = useGetAnalyticsOverview({
    query: {
      // Analytics includes several aggregate queries. Keep the frequent live
      // refresh reserved for the lightweight unread-notification count.
      refetchInterval: 60_000,
      enabled: !!user,
      queryKey: getGetAnalyticsOverviewQueryKey(),
    },
  });

  const unread = unreadData?.unreadCount ?? 0;
  const pendingRx = analytics?.pendingPrescriptions ?? 0;
  const lowStock = analytics?.lowStockItems ?? 0;

  function getBadge(href: string): { label: string; kind: "warn" | "info" } | null {
    if (href === "/orders" && analytics?.pendingOrders)
      return { label: String(analytics.pendingOrders), kind: "info" };
    if (href === "/notifications" && unread > 0)
      return { label: String(unread), kind: "info" };
    if (href === "/prescriptions" && pendingRx > 0)
      return { label: String(pendingRx), kind: "info" };
    if (href === "/inventory" && lowStock > 0)
      return { label: `${lowStock} low`, kind: "warn" };
    return null;
  }

  return (
    <div className="w-60 max-w-full bg-sidebar text-sidebar-foreground h-[100dvh] flex flex-col border-r border-sidebar-border shadow-md z-10 relative">
      {/* Logo */}
      <div className="px-5 pt-5 pb-4 flex items-center gap-3 border-b border-sidebar-border/40">
        <MobiCareLogo markClassName="h-9" textClassName="text-sm" />
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-widest text-sidebar-foreground/50 leading-tight">
            Pharmacy Portal
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 flex flex-col gap-0.5 overflow-y-auto">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 px-2 mb-2">
          Menu
        </p>
        {navItems.map((item) => {
          const isActive = location.startsWith(item.href);
          const badge = getBadge(item.href);

          return (
            <Link key={item.href} href={item.href}>
              <div
                onClick={onNavigate}
                className={clsx(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors cursor-pointer text-sm font-medium select-none",
                  isActive
                    ? "bg-[#1A8F6E] text-white"
                    : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground/75"
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 leading-none">{item.label}</span>
                {badge && (
                  <span
                    className={clsx(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none",
                      badge.kind === "warn"
                        ? "bg-amber-100 text-amber-700"
                        : isActive
                        ? "bg-white/20 text-white"
                        : "bg-[#1A8F6E]/15 text-[#1A8F6E]"
                    )}
                  >
                    {badge.label}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
        <p className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 px-2 mt-5 mb-2">
          Incoming
        </p>
        {incomingItems.map((item) => {
          const isActive = location.startsWith(item.href);
          const badge = getBadge(item.href);

          return (
            <Link key={item.href} href={item.href}>
              <div
                onClick={onNavigate}
                className={clsx(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors cursor-pointer text-sm font-medium select-none",
                  isActive
                    ? "bg-[#1A8F6E] text-white"
                    : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground/75"
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 leading-none">{item.label}</span>
                {badge && (
                  <span
                    className={clsx(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none",
                      isActive
                        ? "bg-white/20 text-white"
                        : "bg-[#1A8F6E]/15 text-[#1A8F6E]"
                    )}
                  >
                    {badge.label}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
        <p className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 px-2 mt-5 mb-2">
          Account
        </p>
        {accountItems.map((item) => {
          const isActive = location.startsWith(item.href);

          return (
            <Link key={item.href} href={item.href}>
              <div
                onClick={onNavigate}
                className={clsx(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors cursor-pointer text-sm font-medium select-none",
                  isActive
                    ? "bg-[#1A8F6E] text-white"
                    : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground/75"
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 leading-none">{item.label}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* User + sign-out */}
      <div className="p-4 border-t border-sidebar-border/40 space-y-3">
        <div className="flex items-center gap-2.5 px-1">
          <div className="w-7 h-7 rounded-full bg-[#1A8F6E]/20 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-[#1A8F6E]">
              {user?.name?.charAt(0).toUpperCase() ?? "P"}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate leading-tight">{user?.name ?? "Pharmacist"}</p>
            <p className="text-[10px] text-sidebar-foreground/50 flex items-center gap-1 leading-tight">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              Online · Receiving orders
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            onNavigate?.();
            logout();
          }}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-md border border-sidebar-border/60 text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}
