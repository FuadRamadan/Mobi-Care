import { Link } from "wouter";
import { motion } from "framer-motion";
import { Search, ShoppingBag, Truck, Smartphone, FileCheck } from "lucide-react";
import PolicyHighlights from "@/components/PolicyHighlights";

// ─── Floating medical element SVGs ───────────────────────────────────────────

function Capsule({ size = 40, tilt = 0 }: { size?: number; tilt?: number }) {
  const w = size * 2.2;
  const h = size;
  const r = h / 2;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ transform: `rotate(${tilt}deg)` }}>
      <defs>
        <clipPath id="cap-clip">
          <rect width={w} height={h} rx={r} />
        </clipPath>
      </defs>
      <rect width={w} height={h} rx={r} fill="none" stroke="#1A8F6E" strokeWidth={1.5} />
      <rect width={w / 2} height={h} fill="#1A8F6E" fillOpacity={0.15} clipPath="url(#cap-clip)" />
      <rect x={w / 2} width={w / 2} height={h} fill="#0B3D2E" fillOpacity={0.08} clipPath="url(#cap-clip)" />
      <line x1={w / 2} y1={2} x2={w / 2} y2={h - 2} stroke="#1A8F6E" strokeWidth={1.5} strokeOpacity={0.6} />
    </svg>
  );
}

function Tablet({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28">
      <circle cx={14} cy={14} r={13} fill="#1A8F6E" fillOpacity={0.1} stroke="#1A8F6E" strokeWidth={1.5} />
      <line x1={7} y1={14} x2={21} y2={14} stroke="#1A8F6E" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

function PharmacyCross({ size = 30 }: { size?: number }) {
  const arm = size * 0.28;
  const mid = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect x={mid - arm} y={2} width={arm * 2} height={size - 4} rx={arm * 0.6}
        fill="#1A8F6E" fillOpacity={0.18} stroke="#1A8F6E" strokeWidth={1.2} />
      <rect x={2} y={mid - arm} width={size - 4} height={arm * 2} rx={arm * 0.6}
        fill="#1A8F6E" fillOpacity={0.18} stroke="#1A8F6E" strokeWidth={1.2} />
    </svg>
  );
}

function MedicineBottle({ size = 44 }: { size?: number }) {
  const w = size * 0.55;
  const h = size;
  const capH = h * 0.18;
  const neckH = h * 0.12;
  const bodyH = h - capH - neckH;
  const bodyW = w;
  const neckW = w * 0.6;
  const capW = w * 0.72;
  const cx = w / 2;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {/* cap */}
      <rect x={(w - capW) / 2} y={0} width={capW} height={capH} rx={3}
        fill="#0B3D2E" fillOpacity={0.25} stroke="#0B3D2E" strokeWidth={1.2} />
      {/* neck */}
      <rect x={(w - neckW) / 2} y={capH} width={neckW} height={neckH}
        fill="#1A8F6E" fillOpacity={0.15} stroke="#1A8F6E" strokeWidth={1} />
      {/* body */}
      <rect x={0} y={capH + neckH} width={bodyW} height={bodyH} rx={4}
        fill="#1A8F6E" fillOpacity={0.12} stroke="#1A8F6E" strokeWidth={1.5} />
      {/* label line */}
      <line x1={5} y1={capH + neckH + bodyH * 0.38}
            x2={bodyW - 5} y2={capH + neckH + bodyH * 0.38}
            stroke="#1A8F6E" strokeWidth={1} strokeOpacity={0.5} />
      {/* Rx */}
      <text x={cx} y={capH + neckH + bodyH * 0.68}
        textAnchor="middle" fontSize={size * 0.18}
        fill="#1A8F6E" fillOpacity={0.7} fontWeight="bold" fontFamily="system-ui">Rx</text>
    </svg>
  );
}

function DeliveryBox({ size = 36 }: { size?: number }) {
  const s = size;
  const top = s * 0.32;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
      {/* box body */}
      <rect x={2} y={top} width={s - 4} height={s - top - 2} rx={3}
        fill="#1A8F6E" fillOpacity={0.12} stroke="#1A8F6E" strokeWidth={1.5} />
      {/* lid */}
      <path d={`M2,${top} L${s / 2},${top * 0.3} L${s - 2},${top}`}
        fill="#1A8F6E" fillOpacity={0.2} stroke="#1A8F6E" strokeWidth={1.5} strokeLinejoin="round" />
      {/* centre crease */}
      <line x1={s / 2} y1={top} x2={s / 2} y2={s - 2}
        stroke="#1A8F6E" strokeWidth={1} strokeOpacity={0.4} strokeDasharray="2 2" />
    </svg>
  );
}

function HeartbeatLine({ width = 70, height = 28 }: { width?: number; height?: number }) {
  const mid = height / 2;
  const d = `M0,${mid} L${width * 0.2},${mid} L${width * 0.32},${mid - height * 0.85}
             L${width * 0.42},${mid + height * 0.7} L${width * 0.52},${mid}
             L${width},${mid}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={d} fill="none" stroke="#1A8F6E" strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.7} />
    </svg>
  );
}

function HexShield({ size = 32 }: { size?: number }) {
  const cx = size / 2, cy = size / 2, r = size * 0.44;
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(" ");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <polygon points={pts} fill="#0B3D2E" fillOpacity={0.1}
        stroke="#0B3D2E" strokeWidth={1.5} strokeOpacity={0.4} />
      <path d={`M${cx - 6},${cy - 1} L${cx - 2},${cy + 4} L${cx + 6},${cy - 4}`}
        fill="none" stroke="#1A8F6E" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Float wrapper ─────────────────────────────────────────────────────────────

function Float({
  children,
  x, y,
  yAmp = 10,
  duration = 5,
  delay = 0,
  rotateDeg = 0,
  rotateAmp = 4,
  opacity = 0.55,
}: {
  children: React.ReactNode;
  x: string; y: string;
  yAmp?: number;
  duration?: number;
  delay?: number;
  rotateDeg?: number;
  rotateAmp?: number;
  opacity?: number;
}) {
  return (
    <motion.div
      style={{ position: "absolute", left: x, top: y, opacity, pointerEvents: "none" }}
      animate={{
        y: [0, -yAmp, 0],
        rotate: [rotateDeg - rotateAmp, rotateDeg + rotateAmp, rotateDeg - rotateAmp],
      }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    >
      {children}
    </motion.div>
  );
}

// ─── Floating layer ────────────────────────────────────────────────────────────

function FloatingMedical() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {/* top-left cluster */}
      <Float x="4%" y="8%" yAmp={12} duration={6} delay={0} rotateDeg={-25} rotateAmp={3} opacity={0.45}>
        <Capsule size={18} tilt={-25} />
      </Float>
      <Float x="9%" y="28%" yAmp={8} duration={7.5} delay={1.2} rotateDeg={0} rotateAmp={2} opacity={0.35}>
        <PharmacyCross size={22} />
      </Float>
      <Float x="2%" y="55%" yAmp={10} duration={5.5} delay={0.4} rotateDeg={15} rotateAmp={4} opacity={0.3}>
        <Tablet size={22} />
      </Float>

      {/* top-right cluster */}
      <Float x="84%" y="6%" yAmp={14} duration={6.8} delay={0.8} rotateDeg={20} rotateAmp={3} opacity={0.4}>
        <MedicineBottle size={42} />
      </Float>
      <Float x="91%" y="32%" yAmp={9} duration={5.2} delay={2} rotateDeg={-10} rotateAmp={3} opacity={0.35}>
        <Capsule size={16} tilt={60} />
      </Float>
      <Float x="78%" y="18%" yAmp={11} duration={7} delay={0.3} rotateDeg={0} rotateAmp={2} opacity={0.3}>
        <HexShield size={28} />
      </Float>

      {/* mid-left */}
      <Float x="1%" y="72%" yAmp={7} duration={8} delay={1.5} rotateDeg={-5} rotateAmp={3} opacity={0.28}>
        <HeartbeatLine width={58} height={22} />
      </Float>

      {/* mid-right */}
      <Float x="86%" y="62%" yAmp={10} duration={6.2} delay={0.9} rotateDeg={8} rotateAmp={3} opacity={0.38}>
        <DeliveryBox size={32} />
      </Float>
      <Float x="93%" y="76%" yAmp={8} duration={7.3} delay={1.8} rotateDeg={0} rotateAmp={2} opacity={0.28}>
        <PharmacyCross size={20} />
      </Float>

      {/* bottom scatter */}
      <Float x="14%" y="82%" yAmp={9} duration={5.8} delay={2.5} rotateDeg={-15} rotateAmp={4} opacity={0.3}>
        <Capsule size={14} tilt={45} />
      </Float>
      <Float x="72%" y="88%" yAmp={11} duration={6.5} delay={1.1} rotateDeg={10} rotateAmp={3} opacity={0.28}>
        <Tablet size={20} />
      </Float>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const steps = [
    { icon: Search,      title: "Search",  desc: "Find the exact medicine you need." },
    { icon: FileCheck,   title: "Compare", desc: "Check prices across local pharmacies." },
    { icon: ShoppingBag, title: "Order",   desc: "Choose delivery or pickup." },
    { icon: Smartphone,  title: "Pay",     desc: "Securely via Orange Money." },
    { icon: Truck,       title: "Track",   desc: "Follow your order to your door." },
  ];

  return (
    <div className="flex-1 w-full">
      {/* ── Hero ── */}
      <section className="pt-20 pb-16 md:pt-32 md:pb-24 px-4 overflow-hidden relative">
        {/* soft background wash */}
        <div className="absolute inset-0 bg-secondary/50 -z-10 rounded-b-[3rem] md:rounded-b-[5rem] scale-x-105" />

        {/* floating medical elements — behind text */}
        <div className="absolute inset-0 -z-[5]">
          <FloatingMedical />
        </div>

        <div className="container mx-auto max-w-5xl text-center relative">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 text-primary rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-widest mb-8"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Trusted by pharmacies across Sierra Leone
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.08 }}
            className="text-4xl md:text-6xl lg:text-7xl font-display font-bold text-dark-green mb-6 tracking-tight leading-tight"
          >
            Your trusted connection to pharmacies <br className="hidden md:block"/>
            <span className="text-primary">across Sierra Leone.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.16 }}
            className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-12"
          >
            Find the medicines you need from trusted pharmacies, all in one place with MobiCare.
          </motion.p>

          {/* Portal cards */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.24 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto"
          >
            <Link
              href="/patient"
              className="group relative flex flex-col items-center justify-center p-8 bg-primary text-primary-foreground rounded-3xl overflow-hidden transition-transform hover:-translate-y-1 shadow-lg hover:shadow-xl"
            >
              <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              <h2 className="text-2xl font-display font-bold mb-2 relative z-10">For Patients</h2>
              <p className="text-primary-foreground/80 text-sm relative z-10 text-center">
                Find medicines, compare prices, and order delivery.
              </p>
            </Link>

            <Link
              href="/pharmacy"
              className="group relative flex flex-col items-center justify-center p-8 bg-card text-foreground rounded-3xl border-2 border-transparent hover:border-primary/20 transition-all hover:-translate-y-1 shadow-lg hover:shadow-xl"
            >
              <h2 className="text-2xl font-display font-bold text-dark-green mb-2">For Pharmacies</h2>
              <p className="text-muted-foreground text-sm text-center">
                Reach more patients and manage orders from one portal.
              </p>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ── How it works ── */}
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

      {/* ── Trust & Policies ── */}
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

      {/* ── Staff portal link ── */}
      <div className="py-12 bg-background/60 flex justify-center">
        <Link href="/hq" className="text-sm text-muted-foreground hover:text-foreground transition-colors border border-border/50 bg-card px-4 py-2 rounded-full">
          Staff Portal Access
        </Link>
      </div>
    </div>
  );
}
