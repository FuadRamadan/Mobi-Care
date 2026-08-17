import { useAuth } from "@/contexts/AuthContext";
import { useGetUnreadCount, getGetUnreadCountQueryKey } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, ShoppingBag, Package, FileText, User, Bell, LogOut } from "lucide-react";
import clsx from "clsx";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/orders", label: "Orders", icon: ShoppingBag },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/prescriptions", label: "Prescriptions", icon: FileText },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/profile", label: "Profile", icon: User },
];

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  
  const { data: unreadData } = useGetUnreadCount({ 
    query: { refetchInterval: 60000, enabled: !!user, queryKey: getGetUnreadCountQueryKey() } 
  });

  return (
    <div className="w-64 bg-sidebar text-sidebar-foreground min-h-[100dvh] flex flex-col border-r border-sidebar-border shadow-lg z-10 relative">
      <div className="p-6 flex flex-col gap-2 items-center bg-[#0B3D2E]">
        {/* Added dynamic import/reference to logo later, for now hardcode generic visual if logo asset unavailable. 
            We will use an img tag with the provided asset path. */}
        <div className="w-full flex justify-center mb-2">
          <img src={`${import.meta.env.BASE_URL}mobicare-logo.jpeg`} alt="MobiCare Logo" className="h-12 w-auto object-contain rounded-sm" />
        </div>
        <div className="text-center w-full">
          <h2 className="font-semibold text-lg truncate" title={user?.name}>{user?.name}</h2>
          <p className="text-xs text-sidebar-foreground/70 opacity-80 truncate">Portal Access</p>
        </div>
      </div>
      
      <nav className="flex-1 py-6 px-3 flex flex-col gap-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.startsWith(item.href);
          const isNotifications = item.href === "/notifications";
          const hasUnread = isNotifications && (unreadData?.unreadCount ?? 0) > 0;
          
          return (
            <Link key={item.href} href={item.href}>
              <div className={clsx(
                "flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors cursor-pointer text-sm font-medium",
                isActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground/80"
              )}>
                <item.icon className="w-5 h-5" />
                <span className="flex-1">{item.label}</span>
                {hasUnread && unreadData && (
                  <span className="bg-destructive text-destructive-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {unreadData.unreadCount}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <button 
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors cursor-pointer text-sm font-medium w-full hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground/80"
        >
          <LogOut className="w-5 h-5" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
}
