import { Link, useLocation } from "wouter";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PORTALS } from "@/config/portals";

export default function Navbar() {
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  const links = [
    { href: "/about", label: "About Us" },
    { href: "/pharmacy", label: "For Pharmacies" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-card/80 backdrop-blur-md">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center hover:opacity-90 transition-opacity">
          <div className="bg-[#0B3D2E] rounded px-3 py-1 flex items-center">
            <img
              src="/mobicare-logo.jpeg"
              alt="MobiCare"
              className="h-11 w-auto"
            />
          </div>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-8">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-sm font-medium transition-colors hover:text-primary",
                location === link.href ? "text-primary" : "text-muted-foreground"
              )}
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/patient"
            className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-full text-sm font-medium transition-all shadow-sm"
          >
            Get Medicines
          </Link>

        </nav>

        {/* Mobile Toggle */}
        <button
          className="md:hidden p-2 text-foreground"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Toggle Menu"
        >
          {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile Nav */}
      {isOpen && (
        <div className="md:hidden border-t bg-card">
          <nav className="container mx-auto px-4 py-4 flex flex-col gap-4">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className={cn(
                  "block px-2 py-2 text-lg font-medium rounded-md",
                  location === link.href
                    ? "bg-secondary text-primary"
                    : "text-foreground hover:bg-secondary/50"
                )}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-2">
              <Link
                href="/patient"
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-center w-full bg-primary text-primary-foreground px-4 py-3 rounded-xl font-medium"
              >
                Get Medicines
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
