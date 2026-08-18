import { motion } from "framer-motion";
import { Heart, ShieldCheck, Smartphone, Users, Search, FileCheck, ShoppingBag, Truck } from "lucide-react";
import PolicyHighlights from "@/components/PolicyHighlights";

const values = [
  {
    icon: Heart,
    title: "Built for Africa",
    description:
      "MobiCare is designed from the ground up for the realities of healthcare access across Africa — mobile-first, offline-aware, and priced for everyone.",
  },
  {
    icon: ShieldCheck,
    title: "Safety First",
    description:
      "Every pharmacy on our platform is licensed and verified. Every prescription is reviewed by a qualified pharmacist before dispensing.",
  },
  {
    icon: Smartphone,
    title: "Mobile Money Native",
    description:
      "We integrate directly with Mobile Money services so payments are simple, safe, and trackable — no bank account required.",
  },
  {
    icon: Users,
    title: "Community Driven",
    description:
      "We work closely with local pharmacists, healthcare workers, and patients to keep improving the platform in ways that matter most.",
  },
];

export default function About() {
  return (
    <div className="flex-1 w-full pb-20">
      {/* Hero */}
      <section className="pt-16 pb-12 px-4 bg-secondary/70">
        <div className="container mx-auto max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 mb-6 text-primary"
          >
            <Users className="w-8 h-8" />
            <span className="font-display font-semibold uppercase tracking-wider text-sm">About Us</span>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-4xl md:text-5xl font-display font-bold text-dark-green mb-6 leading-tight"
          >
            Connecting people to the medicines they need.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg text-muted-foreground max-w-2xl leading-relaxed"
          >
            MobiCare is a Sierra Leonean health-tech platform that bridges the gap between patients and licensed pharmacies. We make it easy to find, compare, and order medicines safely, from anywhere, on any phone.
          </motion.p>
        </div>
      </section>

      {/* Mission */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-4xl">
          {/* Origin Story */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-card border-l-4 border-primary rounded-2xl p-8 md:p-12 mb-16"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-4">Our Origin Story</p>
            <p className="text-lg md:text-xl text-dark-green leading-relaxed">
              In 2024, a patient at Connaught Hospital died because his family could not find Human Albumin in time. The drug existed elsewhere in Freetown. Nobody knew.
            </p>
          </motion.div>

          {/* Mission & Vision side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-card border rounded-2xl p-8 flex flex-col"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-4">Our Mission</p>
              <p className="text-xl md:text-2xl font-display font-bold text-dark-green leading-snug">
                "To close the gap between the medicine that exists and the patients who needs it."
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="bg-primary/5 border border-primary/20 rounded-2xl p-8 flex flex-col"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-4">Our Vision</p>
              <p className="text-xl md:text-2xl font-display font-bold text-dark-green leading-snug">
                "No one has to die searching for a medicine that already exists."
              </p>
            </motion.div>
          </div>

          {/* What We Do */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-16"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-6">What We Do</p>
            <h2 className="font-display font-bold text-2xl md:text-3xl text-dark-green mb-6">The Problem</h2>
            <div className="space-y-5 text-muted-foreground leading-relaxed">
              <p>
                Only 33% of the sub-Saharan African population has regular access to essential medicines (WHO, 2017). But most of the time, these medications are not missing from the countries — they are missing from view. No shared data of what is where.
              </p>
              <p>
                For patients, this means traveling from pharmacy to pharmacy, often while unwell, with no assurance but hope. In an emergency, that search costs hours. Sometimes it costs a life.
              </p>
            </div>
          </motion.div>

          {/* Challenges & Solutions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
            {/* Challenges */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-red-50 border border-red-100 rounded-2xl p-8"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-red-500 mb-4">Challenges of Access to Essential Medicines</p>
              <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                Sierra Leone's own health facility data tells the story plainly: the average facility stocks only six of the twenty essential medicines it should have, and not one facility surveyed had them all.
              </p>
              <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                But the challenge does not stop at the facility. It extends across the entire chain between a medicine arriving in the country and reaching the patient who needs it.
              </p>
              <div className="space-y-5">
                {[
                  { title: "No Visibility of Stock", body: "Pharmacies hold their inventory in separate, unconnected records. Neither patients nor health workers can see what is available, or where, until they physically ask." },
                  { title: "The Manual Search", body: "Patients and families travel from pharmacy to pharmacy, often while unwell, asking the same question and receiving no answer. In an emergency, that search costs hours that patients do not have." },
                  { title: "Price Opacity", body: "The same medicine can cost very different amounts at different pharmacies, and patients have no way to compare before travelling. Many overpay simply because they cannot see the alternatives." },
                  { title: "Distance and Access", body: "Reaching a pharmacy requires physical travel, which excludes those who are furthest away, least mobile, or too unwell to make the journey. Access to medicine should not depend on proximity." },
                  { title: "Unregulated Alternatives", body: "When the formal system fails them, patients turn to informal sellers with no professional oversight, no prescription review, and no guarantee that what they receive is safe or genuine." },
                ].map((item) => (
                  <div key={item.title}>
                    <h4 className="font-semibold text-dark-green text-sm mb-1">{item.title}</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">{item.body}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Solutions */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="bg-primary/5 border border-primary/20 rounded-2xl p-8"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-4">Our Solutions</p>
              <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
                Using technology at MobiCare, we make every medicine in the country findable in real time, so that no patient loses their life searching for a drug that already exists.
              </p>
              <div className="space-y-5">
                {[
                  { title: "Real-Time Stock Visibility", body: "We aggregate live inventory across our entire partner pharmacy network, so patients and health workers can see exactly what is available and where, before they travel." },
                  { title: "One Search, Every Pharmacy", body: "A patient searches once and sees every pharmacy holding that medicine, ranked by price and distance. Hours of searching become seconds." },
                  { title: "Transparent Pricing", body: "We show the real price at every pharmacy, side by side, so patients can choose with full information and no hidden markup." },
                  { title: "Delivery to the Patient", body: "Medicine reaches the patient rather than the patient reaching the medicine, so that distance, mobility, and illness stop being barriers to treatment." },
                  { title: "Professional Oversight", body: "Every prescription medicine is reviewed by a licensed pharmacist before it is approved, bringing patients back into a safe, regulated system rather than an informal one." },
                ].map((item) => (
                  <div key={item.title}>
                    <h4 className="font-semibold text-dark-green text-sm mb-1">{item.title}</h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">{item.body}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>

          {/* How It Works */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-16"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-6">How It Works</p>
            <h2 className="font-display font-bold text-2xl md:text-3xl text-dark-green mb-10">Simple steps to get what you need.</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 md:gap-6 relative">
              <div className="hidden md:block absolute top-8 left-0 right-0 h-0.5 bg-border -z-10" />
              {[
                { icon: Search,      title: "Search",  desc: "Find the exact medicine you need." },
                { icon: FileCheck,   title: "Compare", desc: "Check prices across local pharmacies." },
                { icon: ShoppingBag, title: "Order",   desc: "Choose delivery or pickup." },
                { icon: Smartphone,  title: "Pay",     desc: "Securely via Orange Money." },
                { icon: Truck,       title: "Track",   desc: "Follow your order to your door." },
              ].map((step, i) => (
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
          </motion.div>

          {/* Recognition */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-amber-50 border border-amber-200 rounded-2xl p-8 md:p-10 mb-16 flex items-start gap-5"
          >
            <div className="text-3xl">🏆</div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-amber-700 mb-2">Recognition</p>
              <p className="font-display font-bold text-lg text-dark-green">National Grand Prize winner, Orange Social Venture Prize 2026.</p>
            </div>
          </motion.div>

          {/* Values */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-20">
            {values.map((v, i) => (
              <motion.div
                key={v.title}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.07 }}
                className="flex flex-col gap-3"
              >
                <div className="w-10 h-10 rounded-xl bg-card border flex items-center justify-center text-primary">
                  <v.icon className="w-5 h-5" />
                </div>
                <h3 className="font-display font-semibold text-xl text-dark-green">{v.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{v.description}</p>
              </motion.div>
            ))}
          </div>

          {/* Meet Our Team */}
          <div className="border-t pt-16 mb-16">
            <h2 className="text-2xl font-display font-bold text-dark-green mb-2">Meet Our Team</h2>
            <p className="text-muted-foreground text-sm mb-12">The people behind MobiCare.</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
              {[
                { initials: "AK", name: "Dr. Abdullah Osman Koroma", role: "Founder & Medical Doctor", color: "bg-primary/10 text-primary" },
                { initials: "FS", name: "Fuad Ramada Sesay", role: "CTO", color: "bg-blue-100 text-blue-700" },
                { initials: "AS", name: "Alhaji Samura", role: "DevOps Engineer", color: "bg-purple-100 text-purple-700" },
                { initials: "AZ", name: "Pharm Alpha Aziz Jalloh", role: "Superintendent Pharmacist", color: "bg-green-100 text-green-700" },
                { initials: "MS", name: "Pharm Mamie Saio Johnson", role: "Pharmacy Manager", color: "bg-teal-100 text-teal-700" },
              ].map((member, i) => (
                <motion.div
                  key={member.name}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="flex flex-col items-center text-center"
                >
                  <div className={`w-24 h-24 rounded-full ${member.color} flex items-center justify-center text-2xl font-display font-bold mb-4 border-2 border-white shadow-md`}>
                    {member.initials}
                  </div>
                  <h3 className="font-display font-semibold text-dark-green text-sm leading-snug mb-1">{member.name}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{member.role}</p>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Policy promises */}
          <div className="border-t pt-16">
            <h2 className="text-2xl font-display font-bold text-dark-green mb-8">Our Promises to You</h2>
            <PolicyHighlights showTiers={false} />
          </div>
        </div>
      </section>
    </div>
  );
}
