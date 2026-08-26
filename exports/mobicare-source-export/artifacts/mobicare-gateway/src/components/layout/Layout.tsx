import { ReactNode } from "react";
import Navbar from "./Navbar";
import Footer from "./Footer";
import { useLocation } from "wouter";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const isHQ = location === "/hq" || location.startsWith("/hq/");
  const isPatientApp = location === "/app" || location.startsWith("/app/");

  // HQ and patient app pages bring their own shells — no marketing nav/footer.
  if (isHQ || isPatientApp) {
    return <main className="flex-1 flex flex-col min-h-screen bg-background">{children}</main>;
  }

  return (
    <div className="relative flex flex-col min-h-screen">
      {/* Pharmacy-themed soft background */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 bg-cover bg-center opacity-40"
        style={{ backgroundImage: "url('/pharmacy-bg.jpg')" }}
      />
      <Navbar />
      <main className="flex-1 flex flex-col w-full">
        {children}
      </main>
      <Footer />
    </div>
  );
}
