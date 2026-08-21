import { ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { Redirect, Link } from "wouter";
import { calculateDaysRemaining, isInsideWarningWindow } from "@/utils/password";
import { AlertCircle, X } from "lucide-react";

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
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-x-hidden flex flex-col h-[100dvh]">
        <ExpiryBanner />
        <div className="flex-1 overflow-y-auto bg-muted/30 p-6 md:p-8">
          <div className="max-w-7xl mx-auto space-y-6">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
