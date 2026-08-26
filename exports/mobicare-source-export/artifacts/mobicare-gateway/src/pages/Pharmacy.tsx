import { motion } from "framer-motion";
import { Store, TrendingUp, Users, Mail, Lock } from "lucide-react";
import PolicyHighlights from "@/components/PolicyHighlights";
import { PORTALS, PARTNER_CONTACT_EMAIL } from "@/config/portals";

export default function Pharmacy() {
  return (
    <div className="flex-1 w-full pb-20">
      <section className="pt-16 pb-12 px-4 bg-dark-green text-white">
        <div className="container mx-auto max-w-4xl">
          <div className="flex items-center gap-3 mb-6 text-primary">
            <Store className="w-8 h-8" />
            <span className="font-display font-semibold uppercase tracking-wider text-sm text-secondary">For Pharmacies</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-bold mb-6 leading-tight">
            Reach more patients. <br />Manage orders in one place.
          </h1>
          <p className="text-lg text-secondary/80 mb-10 max-w-2xl leading-relaxed">
            Partner with MobiCare to expand your reach across Sierra Leone. Receive orders, review prescriptions, manage your inventory, and track deliveries through a single, easy-to-use portal.
          </p>
          
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <a 
              href={PORTALS.pharmacy.loginUrl}
              className="bg-primary text-primary-foreground px-8 py-4 rounded-full font-medium text-lg hover:bg-primary/90 transition-colors shadow-lg inline-flex items-center justify-center w-full sm:w-auto"
            >
              Pharmacy Login
            </a>
          </div>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="container mx-auto max-w-4xl">
          
          {/* Partner Notice */}
          <div className="bg-orange-50 border border-orange-200 rounded-2xl p-6 md:p-8 mb-16 flex flex-col md:flex-row gap-6 items-start md:items-center">
            <div className="bg-orange-100 p-4 rounded-full text-orange-money flex-shrink-0">
              <Lock className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-display font-semibold text-xl text-dark-green mb-2">Partner Onboarding</h3>
              <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                To ensure quality and trust, there is NO self-registration for pharmacies. MobiCare HQ issues credentials directly to verified, licensed partners.
              </p>
              <a 
                href={`mailto:${PARTNER_CONTACT_EMAIL}`}
                className="inline-flex items-center gap-2 text-primary font-medium hover:underline"
              >
                <Mail className="w-4 h-4" />
                Request to become a partner
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-20">
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="flex items-start gap-4"
            >
              <div className="w-12 h-12 rounded-xl bg-card border flex items-center justify-center text-primary flex-shrink-0">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-lg text-dark-green mb-1">New Customers</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Patients search for their required medicines and your pharmacy appears as an option if you have stock, bringing footfall you wouldn't otherwise get.
                </p>
              </div>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="flex items-start gap-4"
            >
              <div className="w-12 h-12 rounded-xl bg-card border flex items-center justify-center text-primary flex-shrink-0">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-display font-semibold text-lg text-dark-green mb-1">Streamlined Operations</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Handle digital payments securely, verify prescriptions submitted by users, and coordinate delivery riders all from the pharmacy dashboard.
                </p>
              </div>
            </motion.div>
          </div>

          <div className="border-t pt-16">
            <h2 className="text-2xl font-display font-bold text-dark-green mb-8">Platform Integrity</h2>
            <p className="text-muted-foreground mb-8">As a partner, you participate in a system built on these strict policies to ensure patient safety.</p>
            {/* Show policies, they apply to pharmacies as well so they know the rules */}
            <PolicyHighlights />
          </div>
        </div>
      </section>
    </div>
  );
}
