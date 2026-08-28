import { ReactNode, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { Redirect, Link } from "wouter";
import { calculateDaysRemaining, isInsideWarningWindow } from "@/utils/password";
import { AlertCircle, Menu, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

function ExpiryBanner() {
  const { user, passwordPolicy } = useAuth();
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem("mc_banner_dismissed") === "1"
  );

  if (dismissed || user?.mustChangePassword) return null;

  const insideWarningWindow = isInsideWarningWindow(user, passwordPolicy);
  if (!insideWarningWindow) return null;

  const daysRemaining = calculateDaysRemaining(user, passwordPolicy);

  const handleDismiss = () => {
    sessionStorage.setItem("mc_banner_dismissed", "1");
    setDismissed(true);
  };

  return (
    <div className="bg-accent text-accent-foreground px-4 py-3 flex flex-wrap items-center justify-between shadow-sm border-b border-accent-border gap-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertCircle className="w-4 h-4 text-accent-foreground/80 shrink-0" />
        <p>
          Your password will expire in {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'}.
          <Link href="/change-password" className="ml-2 underline underline-offset-2 hover:text-primary transition-colors whitespace-nowrap">
            Update it now
          </Link>
        </p>
      </div>
      <button 
        onClick={handleDismiss}
        className="p-1.5 hover:bg-black/10 rounded-md transition-colors shrink-0 -mr-1.5"
        aria-label="Dismiss banner"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);

  const handleMobileNavOpenChange = (open: boolean) => {
    setMobileNavOpen(open);
    if (!open) {
      window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <p className="text-muted-foreground font-medium">Loading MobiCare...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  return (
    <div className="flex min-h-[100dvh] bg-background text-foreground">
      <aside className="hidden md:block shrink-0">
        <Sidebar />
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={handleMobileNavOpenChange}>
        <SheetContent
          side="left"
          className="w-[min(20rem,88vw)] max-w-none border-0 bg-sidebar p-0 [&>button]:text-sidebar-foreground"
        >
          <SheetTitle className="sr-only">Portal navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Navigate between pharmacy portal pages.
          </SheetDescription>
          <Sidebar onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="min-w-0 flex-1 overflow-x-hidden flex flex-col h-[100dvh]">
        <header className="md:hidden flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4">
          <button
            ref={mobileMenuButtonRef}
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border bg-background text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Open navigation menu"
            aria-haspopup="dialog"
            aria-expanded={mobileNavOpen}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <img
            src={`${import.meta.env.BASE_URL}mobicare-pin.png`}
            alt=""
            className="h-8 w-auto"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold leading-tight">MobiCare</p>
            <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Pharmacy Portal
            </p>
          </div>
        </header>
        <ExpiryBanner />
        <div className="flex-1 overflow-y-auto bg-muted/30 p-4 sm:p-6 md:p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
