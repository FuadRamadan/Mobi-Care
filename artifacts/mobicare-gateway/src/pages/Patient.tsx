import { motion } from "framer-motion";
import { Pill, Search, Shield, Smartphone } from "lucide-react";
import PolicyHighlights from "@/components/PolicyHighlights";
import { PORTALS } from "@/config/portals";

export default function Patient() {
  return (
    <div className="flex-1 w-full pb-20">
      <section className="pt-16 pb-12 px-4 bg-secondary/70">
        <div className="container mx-auto max-w-4xl">
          <div className="flex items-center gap-3 mb-6 text-primary">
            <Pill className="w-8 h-8" />
            <span className="font-display font-semibold uppercase tracking-wider text-sm">For Patients</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-bold text-dark-green mb-6 leading-tight">
            Find medicines. Compare prices. Order safely.
          </h1>
          <p className="text-lg text-muted-foreground mb-10 max-w-2xl leading-relaxed">
            Search across trusted local pharmacies, compare costs, and choose delivery to your door or collection in person. Pay securely by mobile money, upload prescriptions for review, and track your order every step of the way.
          </p>
          
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <a 
              href={PORTALS.patient.loginUrl}
              className="bg-primary text-primary-foreground px-8 py-4 rounded-full font-medium text-lg hover:bg-primary/90 transition-colors shadow-lg inline-flex items-center justify-center w-full sm:w-auto"
            >
              Open Patient App
            </a>
            <p className="text-sm text-muted-foreground flex items-center gap-2 px-2">
              <Smartphone className="w-4 h-4 text-primary" />
              Installable PWA — just tap "Add to Home Screen". No app store needed.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="container mx-auto max-w-4xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-20">
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="flex flex-col gap-3"
            >
              <div className="w-10 h-10 rounded-xl bg-card border flex items-center justify-center text-dark-green mb-2">
                <Search className="w-5 h-5" />
              </div>
              <h3 className="font-display font-semibold text-xl text-dark-green">Compare Prices</h3>
              <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                Don't guess what medicine costs. See transparent pricing from multiple licensed pharmacies before you choose where to buy.
              </p>
              
              <div className="mt-auto p-4 bg-background/50 rounded-xl border border-border/60">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm font-medium text-dark-green">Paracetamol 500mg</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">City Pharmacy</span>
                    <span className="font-semibold text-muted-foreground">Le 15,500</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-primary font-medium">HealthPlus</span>
                    <span className="font-bold text-primary">Le 14,200</span>
                  </div>
                </div>
              </div>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="flex flex-col gap-3"
            >
              <div className="w-10 h-10 rounded-xl bg-card border flex items-center justify-center text-orange-money mb-2">
                <Smartphone className="w-5 h-5" />
              </div>
              <h3 className="font-display font-semibold text-xl text-dark-green">Mobile Money</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Pay safely using Orange Money directly through your phone. Secure, tracked, and verified.
              </p>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="flex flex-col gap-3"
            >
              <div className="w-10 h-10 rounded-xl bg-card border flex items-center justify-center text-accent mb-2">
                <Shield className="w-5 h-5" />
              </div>
              <h3 className="font-display font-semibold text-xl text-dark-green">Safe Delivery</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Track your delivery rider to your door, or choose to collect your items directly from the pharmacy.
              </p>
            </motion.div>
          </div>

          <div className="border-t pt-16">
            <h2 className="text-2xl font-display font-bold text-dark-green mb-8">Our Promises to You</h2>
            <PolicyHighlights />
          </div>
        </div>
      </section>
    </div>
  );
}
