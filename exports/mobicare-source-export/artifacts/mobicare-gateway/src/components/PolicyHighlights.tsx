import { ShieldCheck, UserCheck, AlertCircle, Truck } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  showTiers?: boolean;
}

export default function PolicyHighlights({ className, showTiers = true }: Props) {
  return (
    <div className={cn("space-y-12", className)}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="bg-card p-6 rounded-2xl border shadow-sm border-border"
        >
          <div className="bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center mb-4 text-primary">
            <UserCheck className="w-6 h-6" />
          </div>
          <h3 className="font-display font-semibold text-lg text-dark-green mb-2">Real Pharmacists</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            We never approve a prescription required order without a licensed pharmacist review. No shortcut, no algorithm deciding.
          </p>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="bg-card p-6 rounded-2xl border shadow-sm border-border"
        >
          <div className="bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center mb-4 text-primary">
            <Truck className="w-6 h-6" />
          </div>
          <h3 className="font-display font-semibold text-lg text-dark-green mb-2">Fast, Honest Delivery</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            No inflated estimates, no silent delays. Just a real courier, on a real route, bringing real medicine to your door.
          </p>
        </motion.div>
      </div>

      {showTiers && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="bg-secondary p-6 md:p-8 rounded-3xl"
        >
          <h3 className="font-display font-semibold text-xl text-dark-green mb-6 flex items-center gap-2">
            <ShieldCheck className="text-primary w-6 h-6" />
            Medicine Tiers Explained
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-card rounded-2xl p-5 border border-border/50">
              <span className="inline-block px-3 py-1 bg-green-100 text-green-800 text-xs font-bold rounded-full mb-3 uppercase tracking-wider">
                Over-the-counter
              </span>
              <h4 className="font-medium text-dark-green mb-2">Tier 3</h4>
              <p className="text-sm text-muted-foreground">
                Safe for general use. These medicines are available without a prescription and can be ordered for delivery or collection immediately.
              </p>
            </div>
            
            <div className="bg-card rounded-2xl p-5 border border-border/50">
              <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-full mb-3 uppercase tracking-wider">
                Prescription Required
              </span>
              <h4 className="font-medium text-dark-green mb-2">Tier 2</h4>
              <p className="text-sm text-muted-foreground">
                You must upload a valid doctor's prescription. A licensed pharmacist reviews yours before the order can proceed to payment.
              </p>
            </div>

            <div className="bg-card rounded-2xl p-5 border border-accent/20">
              <span className="inline-block px-3 py-1 bg-accent/10 text-accent text-xs font-bold rounded-full mb-3 uppercase tracking-wider flex items-center gap-1 w-fit">
                <AlertCircle className="w-3 h-3" /> Controlled
              </span>
              <h4 className="font-medium text-dark-green mb-2">Tier 1</h4>
              <p className="text-sm text-muted-foreground">
                Strictly regulated. Controlled medicines are collection-only, with an in-person ID check at pickup. They are never sold online-only, and never delivered.
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
