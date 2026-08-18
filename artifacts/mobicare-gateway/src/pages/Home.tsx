import { Link } from "wouter";
import { motion } from "framer-motion";
import { Search, ShoppingBag, Truck, Smartphone, FileCheck } from "lucide-react";
import PolicyHighlights from "@/components/PolicyHighlights";

export default function Home() {
  const steps = [
    { icon: Search, title: "Search", desc: "Find the exact medicine you need." },
    { icon: FileCheck, title: "Compare", desc: "Check prices across local pharmacies." },
    { icon: ShoppingBag, title: "Order", desc: "Choose delivery or pickup." },
    { icon: Smartphone, title: "Pay", desc: "Securely via Orange Money." },
    { icon: Truck, title: "Track", desc: "Follow your order to your door." },
  ];

  return (
    <div className="flex-1 w-full">
      {/* Hero Section */}
      <section className="pt-20 pb-16 md:pt-32 md:pb-24 px-4 overflow-hidden relative">
        <div className="absolute inset-0 bg-secondary/50 -z-10 rounded-b-[3rem] md:rounded-b-[5rem] scale-x-105" />
        <div className="container mx-auto max-w-5xl text-center">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-6xl lg:text-7xl font-display font-bold text-dark-green mb-6 tracking-tight leading-tight"
          >
            Your trusted connection to pharmacies <br className="hidden md:block"/>
            <span className="text-primary">across Sierra Leone.</span>
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-12"
          >
            Find the medicines you need from trusted pharmacies, all in one place with MobiCare.
          </motion.p>

          {/* Portals entry */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto"
          >
            <Link 
              href="/patient"
              className="group relative flex flex-col items-center justify-center p-8 bg-primary text-primary-foreground rounded-3xl overflow-hidden transition-transform hover:-translate-y-1 shadow-lg hover:shadow-xl"
            >
              <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              <h2 className="text-2xl font-display font-bold mb-2 relative z-10">For Patients</h2>
              <p className="text-primary-foreground/80 text-sm relative z-10 text-center">Find medicines, compare prices, and order delivery.</p>
            </Link>

            <Link 
              href="/pharmacy"
              className="group relative flex flex-col items-center justify-center p-8 bg-card text-foreground rounded-3xl border-2 border-transparent hover:border-primary/20 transition-all hover:-translate-y-1 shadow-lg hover:shadow-xl"
            >
              <h2 className="text-2xl font-display font-bold text-dark-green mb-2">For Pharmacies</h2>
              <p className="text-muted-foreground text-sm text-center">Reach more patients and manage orders from one portal.</p>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-4 bg-background/60">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-display font-bold text-dark-green mb-4">How it works</h2>
            <p className="text-muted-foreground">Simple steps to get what you need.</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 md:gap-6 relative">
            <div className="hidden md:block absolute top-1/2 left-0 right-0 h-0.5 bg-border -translate-y-1/2 -z-10" />
            {steps.map((step, i) => (
              <motion.div 
                key={step.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="flex flex-col items-center text-center"
              >
                <div className="w-16 h-16 rounded-full bg-secondary text-primary flex items-center justify-center mb-4 shadow-sm border border-border">
                  <step.icon className="w-7 h-7" />
                </div>
                <h3 className="font-display font-bold text-dark-green mb-1">{step.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed px-2">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust & Policies */}
      <section className="py-20 px-4 bg-white border-y border-border">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-display font-bold text-dark-green mb-4">Honesty in every order</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              We believe healthcare needs trust above all else. Here is exactly how we handle your money, prescriptions, and safety.
            </p>
          </div>
          <PolicyHighlights />
        </div>
      </section>
      
      {/* Visual De-emphasized HQ Link placed near footer */}
      <div className="py-12 bg-background/60 flex justify-center">
        <Link href="/hq" className="text-sm text-muted-foreground hover:text-foreground transition-colors border border-border/50 bg-card px-4 py-2 rounded-full">
          Staff Portal Access
        </Link>
      </div>
    </div>
  );
}
