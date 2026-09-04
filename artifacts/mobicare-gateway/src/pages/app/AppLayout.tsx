import { type ReactNode } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { Search, ShoppingBag, ClipboardList, LogOut, Bell, User } from 'lucide-react';
import { usePatientAuth } from '@/patient/auth';
import { useCart } from '@/patient/cart';
import { useGetPatientUnreadCount, getGetPatientUnreadCountQueryKey } from '@workspace/api-client-react';
import { ProfileCompletionDialog } from './ProfileCompletionDialog';

/**
 * Patient app shell — mobile-first (PWA style): sticky top bar + bottom nav.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = usePatientAuth();
  const { itemCount } = useCart();
  const [location] = useLocation();

  const { data: unreadData } = useGetPatientUnreadCount({
    query: {
      refetchInterval: 30_000,
      queryKey: getGetPatientUnreadCountQueryKey(),
      // Only fetch when a patient is logged in
      enabled: !!user,
    },
  });
  const unreadCount = unreadData?.unreadCount ?? 0;

  if (!user) return <Redirect to="/app" />;

  const tabs = [
    { href: '/app/search', label: 'Search', icon: Search, testId: 'nav-search' },
    { href: '/app/checkout', label: 'Cart', icon: ShoppingBag, badge: itemCount, testId: 'nav-cart' },
    { href: '/app/orders', label: 'Orders', icon: ClipboardList, testId: 'nav-orders' },
    { href: '/app/notifications', label: 'Alerts', icon: Bell, badge: unreadCount, testId: 'nav-notifications' },
    { href: '/app/profile', label: 'Profile', icon: User, testId: 'nav-profile' },
  ];

  return (
    <div className="min-h-screen bg-secondary/40 flex flex-col">
      <ProfileCompletionDialog />
      <header className="sticky top-0 z-20 bg-dark-green text-white shadow-md">
        <div className="max-w-3xl mx-auto flex items-center justify-between px-4 h-14">
          <Link
            href="/app/search"
            className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 hover:opacity-90 transition-opacity"
            aria-label="MobiCare"
          >
            <img src="/mobicare-pin.png" alt="" className="h-7 w-auto" />
            <span className="font-display font-bold text-lg leading-none">
              <span className="text-[#0B3D2E]">Mobi</span>
              <span className="text-[#2E9E77]">Care</span>
            </span>
          </Link>
          <div className="flex items-center gap-2 text-sm">
            <span className="opacity-80 hidden sm:inline" data-testid="text-patient-name">{user.name}</span>
            {/* Notification bell shortcut */}
            <Link
              href="/app/notifications"
              className="relative p-2 rounded-full hover:bg-white/10"
              aria-label="Notifications"
              data-testid="button-notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span
                  className="absolute top-1 right-1 bg-red-500 text-white rounded-full text-[9px] min-w-3.5 h-3.5 px-0.5 flex items-center justify-center font-bold leading-none"
                  data-testid="badge-notification-count"
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>
            <button
              onClick={logout}
              className="p-2 rounded-full hover:bg-white/10"
              aria-label="Sign out"
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 pb-24">{children}</main>

      <nav className="fixed bottom-0 inset-x-0 z-20 bg-card border-t">
        <div className="max-w-3xl mx-auto grid grid-cols-5">
          {tabs.map((t) => {
            const active = location === t.href || location.startsWith(t.href + '/');
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-xs relative ${
                  active ? 'text-primary font-semibold' : 'text-muted-foreground'
                }`}
                data-testid={t.testId}
              >
                <span className="relative">
                  <t.icon className="w-5 h-5" />
                  {t.badge ? (
                    <span
                      className="absolute -top-1.5 -right-2.5 bg-primary text-primary-foreground rounded-full text-[10px] min-w-4 h-4 px-1 flex items-center justify-center"
                      data-testid={t.testId === 'nav-cart' ? 'badge-cart-count' : 'badge-alert-count'}
                    >
                      {t.badge > 9 ? '9+' : t.badge}
                    </span>
                  ) : null}
                </span>
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
