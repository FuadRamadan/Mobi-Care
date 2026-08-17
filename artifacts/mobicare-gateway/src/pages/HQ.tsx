import { Link } from "wouter";
import { PORTALS } from "@/config/portals";
import { Pill, Shield, LogIn } from "lucide-react";

export default function HQ() {
  return (
    <div className="flex-1 w-full min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border rounded-3xl shadow-xl p-8 relative overflow-hidden">
        {/* Subtle decorative background for HQ */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-dark-green" />
        
        <div className="flex justify-center mb-8">
          <div className="bg-primary/10 p-3 rounded-2xl">
            <Shield className="w-10 h-10 text-primary" strokeWidth={2} />
          </div>
        </div>
        
        <div className="text-center mb-10">
          <h1 className="font-display font-bold text-2xl text-dark-green mb-2">MobiCare HQ</h1>
          <p className="text-muted-foreground text-sm">Authorized staff access only.</p>
        </div>

        <a 
          href={PORTALS.hq.loginUrl}
          className="flex items-center justify-center gap-2 w-full bg-dark-green text-white hover:bg-dark-green/90 py-4 px-6 rounded-xl font-medium transition-colors mb-6"
        >
          <LogIn className="w-5 h-5" />
          Log in to Dashboard
        </a>

        <div className="text-center mt-8 pt-6 border-t">
          <Link href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-2">
            <Pill className="w-4 h-4" />
            Return to public site
          </Link>
        </div>
      </div>
    </div>
  );
}
