import { motion } from "framer-motion";
import { Heart, ShieldCheck, Smartphone, Users } from "lucide-react";
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
      "We integrate directly with Orange Money so payments are simple, safe, and trackable — no bank account required.",
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
            MobiCare is a Sierra Leonean health-tech platform that bridges the gap between patients and licensed pharmacies. We make it easy to find, compare, and order medicines safely — from anywhere, on any phone.
          </motion.p>
        </div>
      </section>

      {/* Mission */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-card border rounded-2xl p-8 md:p-12 mb-16"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-4">Our Mission</p>
            <p className="text-2xl md:text-3xl font-display font-bold text-dark-green leading-snug">
              "To close the gap between the medicine that exists and the patients who needs it."
            </p>
          </motion.div>

          {/* Vision */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="bg-primary/5 border border-primary/20 rounded-2xl p-8 md:p-12 mb-16"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-4">Our Vision</p>
            <p className="text-2xl md:text-3xl font-display font-bold text-dark-green leading-snug">
              "No one has to die searching for a medicine that already exists."
            </p>
          </motion.div>

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

          {/* Who We Are */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-16"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-6">Who We Are</p>
            <div className="space-y-5 text-muted-foreground leading-relaxed">
              <p>
                MobiCare is built by <span className="font-semibold text-dark-green">MediTrace Health Systems Limited</span>, a health technology company registered in Sierra Leone.
              </p>
              <p>
                MobiCare was founded by <span className="font-semibold text-dark-green">Dr. Abdullah Osman Koroma</span>, a licensed medical doctor practicing in Freetown. The idea did not begin in a boardroom. It began at a hospital bedside, watching a family run out of time.
              </p>
              <p>
                He is joined by <span className="font-semibold text-dark-green">Fuad Ramada Sesay</span> and <span className="font-semibold text-dark-green">Alhaji Samura</span>, both running the technology and infrastructure, and <span className="font-semibold text-dark-green">Aziz</span> and <span className="font-semibold text-dark-green">Mamie Saio</span>, registered pharmacists in Sierra Leone leading pharmacy operations and partnerships.
              </p>
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
