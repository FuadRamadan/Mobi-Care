import { type ReactNode } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { Search, ShoppingBag, ClipboardList, LogOut } from 'lucide-react';
import { usePatientAuth } from '@/patient/auth';
import { useCart } from '@/patient/cart';

/**
 * Patient app shell — mobile-first (PWA style): sticky top bar + bottom nav.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = usePatientAuth();
  const { itemCount } = useCart();
  const [location] = useLocation();

  if (!user) return <Redirect to="/app" />;

  const tabs = [
    { href: '/app/search', label: 'Search', icon: Search, testId: 'nav-search' },
    { href: '/app/checkout', label: 'Cart', icon: ShoppingBag, badge: itemCount, testId: 'nav-cart' },
    { href: '/app/orders', label: 'Orders', icon: ClipboardList, testId: 'nav-orders' },
  ];

  return (
    <div className="min-h-screen bg-secondary/40 flex flex-col">
      <header className="sticky top-0 z-20 bg-dark-green text-white shadow-md">
        <div className="max-w-3xl mx-auto flex items-center justify-between px-4 h-14">
          <Link href="/app/search" className="flex items-center gap-2 font-display font-bold">
            <img src="/mobicare-pin.png" alt="MobiCare" className="h-7 w-auto" />
            MobiCare
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="opacity-80 hidden sm:inline" data-testid="text-patient-name">{user.name}</span>
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
        <div className="max-w-3xl mx-auto grid grid-cols-3">
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
                      data-testid="badge-cart-count"
                    >
                      {t.badge}
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
