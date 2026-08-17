import { ReactNode } from "react";
import Navbar from "./Navbar";
import Footer from "./Footer";
import { useLocation } from "wouter";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const isHQ = location === "/hq";

  // If HQ page, we might want to hide the standard nav/footer to keep it minimal
  if (isHQ) {
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
