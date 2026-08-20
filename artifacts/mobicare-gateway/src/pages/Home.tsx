import { Link } from "wouter";
import { motion } from "framer-motion";
import { Mail, Phone } from "lucide-react";
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
            className="text-4xl md:text-6xl lg:text-7xl font-display font-bold text-dark-green mb-6 tracking-tight leading-tight text-center"
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

      {/* ── Partners ── */}
      <section className="py-10 px-4 bg-secondary/40">
        <div className="container mx-auto max-w-4xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-6">Our Partners</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-12">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="flex flex-col items-center gap-3"
            >
              <div className="w-28 h-28 rounded-2xl overflow-hidden border border-border shadow-sm flex items-center justify-center bg-white">
                <img src="/orange-sl-logo.png" alt="Orange Sierra Leone" loading="lazy" decoding="async" className="w-full h-full object-cover" />
              </div>
              <p className="font-display font-semibold text-dark-green">Orange Sierra Leone</p>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="flex flex-col items-center gap-3"
            >
              <div className="w-28 h-28 rounded-2xl overflow-hidden border border-border shadow-sm flex items-center justify-center bg-white p-3">
                <img src="/innovation-sl-logo.jpg" alt="Innovation SL" loading="lazy" decoding="async" className="w-full h-full object-contain" />
              </div>
              <p className="font-display font-semibold text-dark-green">Innovation SL</p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Contact Us ── */}
      <section className="py-20 px-4 bg-dark-green">
        <div className="container mx-auto max-w-4xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-4">Contact Us</p>
          <h2 className="font-display font-bold text-2xl md:text-3xl text-white mb-10">Get in touch</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-10">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-white/10 border border-white/10 rounded-2xl p-6 flex flex-col items-center gap-2"
            >
              <Mail className="w-7 h-7 text-primary" />
              <p className="text-xs text-white/60 uppercase tracking-widest font-semibold">Email</p>
              <a href="mailto:mobicaresl00@gmail.com" className="text-sm font-medium text-white hover:text-primary transition-colors break-all">
                mobicaresl00@gmail.com
              </a>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="bg-white/10 border border-white/10 rounded-2xl p-6 flex flex-col items-center gap-2"
            >
              <Phone className="w-7 h-7 text-primary" />
              <p className="text-xs text-white/60 uppercase tracking-widest font-semibold">Phone</p>
              <a href="tel:+23275726975" className="text-sm font-medium text-white hover:text-primary transition-colors">
                +232 75 726 975
              </a>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="bg-white/10 border border-white/10 rounded-2xl p-6 flex flex-col items-center gap-2"
            >
              <span className="text-2xl">📍</span>
              <p className="text-xs text-white/60 uppercase tracking-widest font-semibold">Address</p>
              <p className="text-sm font-medium text-white">84 Sixth Road, Malama Lumley</p>
            </motion.div>
          </div>

          {/* Social links */}
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <a
              href="https://linkedin.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#0A66C2] text-white text-xs font-semibold hover:opacity-90 transition-opacity"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              LinkedIn
            </a>
            <a
              href="https://instagram.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-gradient-to-r from-[#833AB4] via-[#E1306C] to-[#F77737] text-white text-xs font-semibold hover:opacity-90 transition-opacity"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
              Instagram
            </a>
            <a
              href="https://facebook.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#1877F2] text-white text-xs font-semibold hover:opacity-90 transition-opacity"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              Facebook
            </a>
            <a
              href="https://x.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-black text-white text-xs font-semibold hover:opacity-80 transition-opacity"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              X
            </a>
          </div>
        </div>
      </section>

    </div>
  );
}
