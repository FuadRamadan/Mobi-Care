import { Link } from "wouter";
import { Pill } from "lucide-react";

export default function Footer() {
  return (
    <footer className="bg-dark-green text-secondary-foreground pt-16 pb-8 border-t border-white/10">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 md:gap-8 mb-12">
          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="flex items-center gap-2 mb-4 inline-flex">
              <div className="bg-primary p-1.5 rounded-lg">
                <Pill className="h-6 w-6 text-white" strokeWidth={2.5} />
              </div>
              <span className="font-display font-bold text-2xl tracking-tight text-white">MobiCare</span>
            </Link>
            <p className="text-secondary/70 max-w-sm text-sm leading-relaxed">
              Your trusted connection to pharmacies across Sierra Leone. Plain-spoken, honest, and built for your mobile phone.
            </p>
          </div>
          
          <div>
            <h4 className="font-display font-semibold text-white mb-4">Portals</h4>
            <ul className="space-y-3">
              <li>
                <Link href="/patient" className="text-sm text-secondary/70 hover:text-white transition-colors">
                  For Patients
                </Link>
              </li>
              <li>
                <Link href="/pharmacy" className="text-sm text-secondary/70 hover:text-white transition-colors">
                  For Pharmacies
                </Link>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-display font-semibold text-white mb-4">Support</h4>
            <ul className="space-y-3">
              <li>
                <a href="mailto:support@mobicare.sl" className="text-sm text-secondary/70 hover:text-white transition-colors">
                  support@mobicare.sl
                </a>
              </li>
              <li>
                <a href="mailto:partners@mobicare.sl" className="text-sm text-secondary/70 hover:text-white transition-colors">
                  Partner with us
                </a>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-secondary/50">
            &copy; {new Date().getFullYear()} MobiCare Sierra Leone. All rights reserved.
          </p>
          
          {/* De-emphasized HQ link */}
          <Link href="/hq" className="text-xs text-secondary/30 hover:text-secondary/60 transition-colors">
            HQ Access
          </Link>
        </div>
      </div>
    </footer>
  );
}
