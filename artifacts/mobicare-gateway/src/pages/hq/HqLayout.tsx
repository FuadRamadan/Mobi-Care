import { type ReactNode, useEffect } from 'react';
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
  LogOut,
} from 'lucide-react';
import { useHqAuth } from '@/hq/auth';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/hq/dashboard', label: 'Command Centre', icon: LayoutDashboard },
  { href: '/hq/orders', label: 'All Orders', icon: Package },
  { href: '/hq/dispatch', label: 'Dispatch', icon: Truck },
  { href: '/hq/pharmacies', label: 'Pharmacies', icon: Building2 },
  { href: '/hq/catalogue', label: 'Catalogue', icon: Pill },
  { href: '/hq/couriers', label: 'Couriers', icon: Bike },
  { href: '/hq/flags', label: 'Flags', icon: Flag },
  { href: '/hq/settlements', label: 'Settlements', icon: Wallet },
  { href: '/hq/audit', label: 'Audit Log', icon: ScrollText },
];

export default function HqLayout({ children, title }: { children: ReactNode; title: string }) {
  const { user, logout } = useHqAuth();
  const [location] = useLocation();

  useEffect(() => {
    document.title = `${title} — MobiCare HQ`;
  }, [title]);

  if (!user) return <Redirect to="/hq" />;

  return (
    <div className="flex min-h-screen w-full bg-muted/30">
      {/* Sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col bg-dark-green text-white">
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/10">
          <img src="/mobicare-pin.png" alt="MobiCare" className="h-8 w-auto" />
          <div>
            <div className="font-display font-bold leading-tight">MobiCare HQ</div>
            <div className="text-[11px] text-white/60">Oversight console</div>
          </div>
        </div>
        <nav className="flex-1 py-4 space-y-0.5 px-2">
          {NAV.map(({ href, label, icon: Icon }) => (
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
              {label}
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
        <div className="md:hidden flex items-center gap-2 bg-dark-green text-white px-4 py-3 overflow-x-auto">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                'whitespace-nowrap text-xs rounded-full px-3 py-1.5',
                location === href ? 'bg-white/20' : 'bg-white/5 text-white/70',
              )}
            >
              {label}
            </Link>
          ))}
        </div>
        <main className="flex-1 p-4 md:p-8">
          <h1 className="font-display font-bold text-2xl text-dark-green mb-6">{title}</h1>
          {children}
        </main>
      </div>
    </div>
  );
}
