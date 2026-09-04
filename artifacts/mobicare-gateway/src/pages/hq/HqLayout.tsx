import { type ReactNode, useEffect, useRef } from 'react';
import { Link, useLocation, Redirect } from 'wouter';
import {
  LayoutDashboard,
  Package,
  Truck,
  Building2,
  Pill,
  Bike,
  Flag,
  Wallet,
  ScrollText,
  ShieldCheck,
  Users,
  LogOut,
  Bell,
  CheckCheck,
  Cable,
  BarChart3,
  Megaphone,
  type LucideIcon,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetHqUnreadCountQueryKey,
  getListHqNotificationsQueryKey,
  useGetHqUnreadCount,
  useListHqNotifications,
  useMarkHqNotificationsRead,
  useGetHqDashboard,
  getGetHqDashboardQueryKey,
} from '@workspace/api-client-react';
import { toast } from 'sonner';
import { useHqAuth } from '@/hq/auth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const NAV: Array<{
  href: string;
  label: string;
  icon: LucideIcon;
  requiresIntegrations?: boolean;
  requiresSettlements?: boolean;
  requiresInsights?: boolean;
  badge?: 'pendingPrescriptions' | 'unconfirmedDeliveries' | 'pendingSettlements';
}> = [
  { href: '/hq/dashboard', label: 'Command Centre', icon: LayoutDashboard },
  { href: '/hq/orders', label: 'All Orders', icon: Package, badge: 'pendingPrescriptions' },
  { href: '/hq/dispatch', label: 'Dispatch', icon: Truck, badge: 'unconfirmedDeliveries' },
  { href: '/hq/pharmacies', label: 'Pharmacies', icon: Building2 },
  { href: '/hq/catalogue', label: 'Catalogue', icon: Pill },
  { href: '/hq/couriers', label: 'Couriers', icon: Bike },
  { href: '/hq/advertisements', label: 'Promotions', icon: Megaphone },
  { href: '/hq/flags', label: 'Flags', icon: Flag },
  { href: '/hq/settlements', label: 'Settlements', icon: Wallet, requiresSettlements: true, badge: 'pendingSettlements' },
  { href: '/hq/insights', label: 'Data & Insights', icon: BarChart3, requiresInsights: true },
  { href: '/hq/audit', label: 'Audit Log', icon: ScrollText },
  { href: '/hq/team', label: 'Team Profiles', icon: Users },
  { href: '/hq/settings', label: 'Security & Settings', icon: ShieldCheck },
  { href: '/hq/api-connections', label: 'API Connections', icon: Cable, requiresIntegrations: true },
];

export default function HqLayout({ children, title }: { children: ReactNode; title: string }) {
  const { user, logout } = useHqAuth();
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  const newestNotificationId = useRef<string | null>(null);
  const { data: notifications = [] } = useListHqNotifications({
    query: {
      queryKey: getListHqNotificationsQueryKey(),
      enabled: !!user,
      refetchInterval: 10_000,
    },
  });
  const { data: unread } = useGetHqUnreadCount({
    query: {
      queryKey: getGetHqUnreadCountQueryKey(),
      enabled: !!user,
      refetchInterval: 10_000,
    },
  });
  const markRead = useMarkHqNotificationsRead();
  const unreadCount = unread?.unreadCount ?? 0;
  const { data: dashboard } = useGetHqDashboard({
    query: { queryKey: getGetHqDashboardQueryKey(), enabled: !!user, refetchInterval: 5_000 },
  });
  const queueCounts = dashboard?.totals;

  useEffect(() => {
    document.title = `${title} — MobiCare HQ`;
  }, [title]);

  useEffect(() => {
    const newest = notifications[0];
    if (!newest) return;

    if (
      newestNotificationId.current &&
      newestNotificationId.current !== newest.id &&
      (newest.type === 'new_order' || newest.type === 'order_ready')
    ) {
      toast.info(newest.title, { description: newest.body });
    }
    newestNotificationId.current = newest.id;
  }, [notifications]);

  const refreshNotifications = () => {
    queryClient.invalidateQueries({ queryKey: getListHqNotificationsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetHqUnreadCountQueryKey() });
  };

  const markNotificationsRead = async (ids?: string[]) => {
    try {
      await markRead.mutateAsync({ data: ids ? { ids } : undefined });
      refreshNotifications();
    } catch {
      toast.error('We could not update the notification status. Please try again.');
    }
  };

  if (!user) return <Redirect to="/hq" />;

  return (
    <div className="flex min-h-screen w-full bg-muted/30">
      {/* Sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col bg-dark-green text-white">
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/10">
          <div className="rounded-full bg-white px-2 py-1 inline-flex items-center gap-1.5" aria-label="MobiCare">
            <img src="/mobicare-pin.png" alt="" className="h-8 w-auto" />
            <span className="font-display font-bold text-sm leading-none">
              <span className="text-[#0B3D2E]">Mobi</span>
              <span className="text-[#2E9E77]">Care</span>
            </span>
          </div>
          <div>
            <div className="font-display font-bold leading-tight">HQ</div>
            <div className="text-[11px] text-white/60">Oversight console</div>
          </div>
        </div>
        <nav className="flex-1 py-4 space-y-0.5 px-2 overflow-y-auto">
          {NAV.filter(
            (item) =>
              (!item.requiresIntegrations ||
                user.canManageIntegrations !== false) &&
              (!item.requiresSettlements ||
                user.canManageSettlements !== false) &&
               (!item.requiresInsights || user.canViewDataInsights === true),
          ).map(({ href, label, icon: Icon, badge }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                location === href
                  ? 'bg-white/15 text-white font-medium'
                  : 'text-white/70 hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon className="w-4 h-4" />
               <span className="flex-1">{label}</span>
               {badge && (queueCounts?.[badge] ?? 0) > 0 && <span className="min-w-5 rounded-full bg-amber-400 px-1.5 text-center text-[10px] font-bold text-dark-green">{queueCounts![badge] > 99 ? '99+' : queueCounts![badge]}</span>}
            </Link>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-white/10 text-sm">
          <div className="text-white/80 truncate mb-2">{user.name}</div>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
            data-testid="button-hq-logout"
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-2 bg-dark-green text-white px-3 py-2.5">
          <div className="rounded-full bg-white px-2 py-1 inline-flex items-center gap-1" aria-label="MobiCare">
            <img src="/mobicare-pin.png" alt="" className="h-7 w-auto shrink-0" />
            <span className="font-display font-bold text-sm leading-none">
              <span className="text-[#0B3D2E]">Mobi</span>
              <span className="text-[#2E9E77]">Care</span>
            </span>
          </div>
          <label className="sr-only" htmlFor="hq-mobile-navigation">HQ section</label>
          <select
            id="hq-mobile-navigation"
            value={location}
            onChange={(event) => navigate(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-medium text-white outline-none focus:ring-2 focus:ring-white/40"
          >
            {NAV.filter(
              (item) =>
                (!item.requiresIntegrations ||
                  user.canManageIntegrations !== false) &&
                (!item.requiresSettlements ||
                   user.canManageSettlements !== false) &&
                (!item.requiresInsights || user.canViewDataInsights === true),
            ).map(({ href, label }) => (
              <option key={href} value={href} className="text-foreground">
                {label}
              </option>
            ))}
          </select>
          <button
            onClick={logout}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <main className="flex-1 p-4 md:p-8">
          <div className="flex items-center justify-between gap-4 mb-6">
            <h1 className="font-display font-bold text-2xl text-dark-green">{title}</h1>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="relative shrink-0"
                  aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
                  data-testid="button-hq-notifications"
                >
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <span
                      className="absolute -right-2 -top-2 min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center"
                      data-testid="badge-hq-notification-count"
                    >
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
                  <div>
                    <p className="text-sm font-semibold">Incoming alerts</p>
                    <p className="text-xs text-muted-foreground">
                      {unreadCount ? `${unreadCount} unread` : 'You are all caught up'}
                    </p>
                  </div>
                  {unreadCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => void markNotificationsRead()}
                      disabled={markRead.isPending}
                    >
                      <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
                      Mark all read
                    </Button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto divide-y">
                  {notifications.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-center text-muted-foreground">
                      No incoming order alerts yet.
                    </p>
                  ) : (
                    notifications.slice(0, 8).map((notification) => (
                      <Link
                         key={notification.id}
                        href="/hq/orders"
                        className={cn(
                          'block px-4 py-3 transition-colors hover:bg-muted/60',
                          !notification.readAt && 'bg-primary/5',
                        )}
                        onClick={() => {
                          if (!notification.readAt) void markNotificationsRead([notification.id]);
                        }}
                      >
                        <div className="flex gap-2.5">
                          <span className={cn(
                            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                            notification.readAt ? 'bg-transparent' : 'bg-primary',
                          )} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{notification.title}</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{notification.body}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {new Date(notification.createdAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
                {notifications.length > 0 && (
                  <div className="border-t px-4 py-2.5">
                    <Link href="/hq/orders" className="text-xs font-medium text-primary hover:underline">
                      View all orders
                    </Link>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
