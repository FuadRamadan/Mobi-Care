import { useEffect, useId, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";

/*
 * Kept identical in the pharmacy portal and the HQ site
 * (artifacts/mobicare-gateway/src/components/TrendChart.tsx): change both.
 */

export interface TrendSeries {
  key: string;
  label: string;
  /** Validated against the card surface and against each other (dataviz checks). */
  color: string;
  /** One value per point, in cents. */
  values: number[];
}

export interface TrendDay {
  date: string; // YYYY-MM-DD
  orders: number;
  /** Extra tooltip lines, e.g. a revenue breakdown. */
  details?: { label: string; minor: number }[];
}

/** MobiCare green and violet: both pass lightness, chroma, contrast and colour-blind checks. */
export const TREND_GREEN = "#0E8C62";
export const TREND_VIOLET = "#7B4FD6";

const HEIGHT = 280;
const PAD = { top: 16, right: 16, bottom: 34, left: 64 };

const money = (minor: number) => `Le ${(minor / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
/** Short axis labels for phones: "Le 8k", "Le 1.5m". */
const moneyShort = (minor: number) => {
  const le = minor / 100;
  if (le >= 1_000_000) return `Le ${+(le / 1_000_000).toFixed(1)}m`;
  if (le >= 1_000) return `Le ${+(le / 1_000).toFixed(1)}k`;
  return `Le ${le}`;
};
const moneyExact = (minor: number) =>
  `${minor < 0 ? "−" : ""}Le ${(Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Round the top of the axis up to a tidy number, with 4 steps. */
function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 4_000, step: 1_000 };
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  return { top: step * 4, step };
}

/** Monotone cubic curve through the points (never overshoots: a dip stays a dip). */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0]![0]},${pts[0]![1]}` : "";
  const n = pts.length;
  const dx: number[] = [], slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]![0] - pts[i]![0]);
    slope.push((pts[i + 1]![1] - pts[i]![1]) / dx[i]!);
  }
  const t: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) t.push(slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2);
  t.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i]! / slope[i]!, b = t[i + 1]! / slope[i]!, h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * slope[i]!; t[i + 1] = k * b * slope[i]!; }
  }
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!, h = dx[i]! / 3;
    d += ` C${x0 + h},${y0 + t[i]! * h} ${x1 - h},${y1 - t[i + 1]! * h} ${x1},${y1}`;
  }
  return d;
}

/**
 * A daily trend: smooth curves over a soft fill, ringed markers, and thin
 * stems from the first series to the baseline. Draws itself in on load and
 * when the range changes (unless the reader prefers reduced motion). Tap,
 * hover or use the arrow keys for a day's figures.
 */
export function TrendChart({ days, series, label }: { days: TrendDay[]; series: TrendSeries[]; label: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry!.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const narrow = width < 520;
  const pad = narrow ? { ...PAD, left: 52, right: 10 } : PAD;
  const innerW = width - pad.left - pad.right;
  const innerH = HEIGHT - pad.top - pad.bottom;
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const { top, step } = niceScale(max);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const xAt = (i: number) => pad.left + (days.length <= 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  // Negative days (e.g. a refund's Monime fee) sit on the baseline.
  const yAt = (v: number) => pad.top + innerH - (Math.max(0, v) / top) * innerH;
  const baseline = pad.top + innerH;

  const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(innerW / 90))));
  const showLabel = (i: number) => i === days.length - 1 || (i % every === 0 && days.length - 1 - i >= every / 2);
  const markEvery = innerW / Math.max(1, days.length) >= 14;
  const animationKey = useMemo(
    () => `${days.length}:${days[0]?.date}:${days.at(-1)?.date}:${max}`,
    [days, max],
  );

  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const box = (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * width;
    const i = Math.round(((x - pad.left) / innerW) * (days.length - 1));
    setHover(Math.min(days.length - 1, Math.max(0, i)));
  };
  const onKey = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setHover((h) => Math.min(days.length - 1, Math.max(0, (h ?? days.length - 1) + (event.key === "ArrowRight" ? 1 : -1))));
  };

  const active = hover !== null ? days[hover] : null;
  const tooltipTop = hover !== null ? Math.min(...series.map((s) => yAt(s.values[hover] ?? 0))) : 0;
  const tooltipW = series.length > 1 || active?.details?.length ? 232 : 176;

  return (
    <div ref={wrapRef} className="relative w-full" data-testid="trend-chart">
      <style>{`
        @keyframes tc-draw { from { stroke-dashoffset: 1000; } to { stroke-dashoffset: 0; } }
        @keyframes tc-rise { from { transform: scaleY(0); opacity: 0; } to { transform: scaleY(1); opacity: 1; } }
        @keyframes tc-pop { 0% { transform: scale(0); } 70% { transform: scale(1.25); } 100% { transform: scale(1); } }
        @keyframes tc-stem { from { transform: scaleY(0); } to { transform: scaleY(1); } }
        .tc-line { stroke-dasharray: 1000; animation: tc-draw 1.4s cubic-bezier(.4,0,.2,1) both; }
        .tc-area { transform-box: fill-box; transform-origin: bottom; animation: tc-rise 1.1s cubic-bezier(.4,0,.2,1) .15s both; }
        .tc-mark { transform-box: fill-box; transform-origin: center; animation: tc-pop .45s ease-out both; }
        .tc-stem { transform-box: fill-box; transform-origin: bottom; animation: tc-stem .5s ease-out both; }
        @media (prefers-reduced-motion: reduce) { .tc-line, .tc-area, .tc-mark, .tc-stem { animation: none; } }
      `}</style>

      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-5 gap-y-1 mb-2 text-xs text-muted-foreground" aria-hidden="true">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className="inline-block w-4 h-[3px] rounded" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        className="block outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-md"
      >
        <defs>
          {series.map((s, si) => (
            <linearGradient key={s.key} id={`${uid}-${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={si === 0 ? 0.26 : 0.16} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={width - pad.right} y1={yAt(v)} y2={yAt(v)} stroke="hsl(var(--border))" strokeDasharray={v > 0 ? "4 4" : undefined} />
            <text x={pad.left - 8} y={yAt(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="hsl(var(--muted-foreground))">
              {narrow ? moneyShort(v) : money(v)}
            </text>
          </g>
        ))}
        {days.map((d, i) =>
          showLabel(i) ? (
            <text key={d.date} x={xAt(i)} y={HEIGHT - 10} textAnchor={i === days.length - 1 ? "end" : i === 0 ? "start" : "middle"} fontSize={11} fill="hsl(var(--muted-foreground))">
              {format(parseISO(d.date), "MMM d")}
            </text>
          ) : null,
        )}

        <g key={animationKey}>
          {series.map((s, si) => {
            const coords = s.values.map((v, i) => [xAt(i), yAt(v)] as [number, number]);
            const line = smoothPath(coords);
            const area = coords.length ? `${line} L${coords.at(-1)![0]},${baseline} L${coords[0]![0]},${baseline} Z` : "";
            const delay = (i: number) => `${0.5 + si * 0.25 + (i / Math.max(1, days.length)) * 0.9}s`;
            return (
              <g key={s.key}>
                {area && <path className="tc-area" d={area} fill={`url(#${uid}-${si})`} />}
                {si === 0 && markEvery && coords.map(([x, y], i) => (
                  <line key={`s${i}`} className="tc-stem" x1={x} x2={x} y1={baseline} y2={y} stroke={s.color} strokeOpacity={0.3} strokeWidth={1.5} style={{ animationDelay: delay(i) }} />
                ))}
                <path className="tc-line" d={line} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" pathLength={1000} style={{ animationDelay: `${si * 0.25}s` }} />
                {markEvery && coords.map(([x, y], i) => (
                  <circle key={`m${i}`} className="tc-mark" cx={x} cy={y} r={4.5} fill="hsl(var(--card))" stroke={s.color} strokeWidth={2} style={{ animationDelay: delay(i) }} />
                ))}
              </g>
            );
          })}
        </g>

        {active && hover !== null && (
          <g pointerEvents="none">
            <line x1={xAt(hover)} x2={xAt(hover)} y1={pad.top} y2={baseline} stroke="hsl(var(--foreground))" strokeOpacity={0.25} />
            {series.map((s) => (
              <circle key={s.key} cx={xAt(hover)} cy={yAt(s.values[hover] ?? 0)} r={6} fill={s.color} stroke="hsl(var(--card))" strokeWidth={2} />
            ))}
          </g>
        )}
        <rect x={pad.left} y={pad.top} width={innerW} height={innerH + 8} fill="transparent"
          onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
      </svg>

      {max === 0 && (
        <p className="absolute inset-x-0 top-1/3 text-center text-sm text-muted-foreground pointer-events-none">
          No sales in this period yet
        </p>
      )}

      {active && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border bg-popover px-3 py-2 shadow-md text-xs"
          style={{
            left: Math.min(Math.max(xAt(hover) - tooltipW / 2, 0), width - tooltipW),
            top: Math.max(0, tooltipTop - 40 - 20 * (series.length + (active.details?.length ?? 0))) + (series.length > 1 ? 24 : 0),
            width: tooltipW,
          }}
          role="status"
        >
          <div className="text-muted-foreground">{format(parseISO(active.date), "EEE, MMM d")}</div>
          {series.map((s) => (
            <div key={s.key} className="mt-1 flex items-center gap-2">
              <span className="inline-block w-3 h-0.5 rounded shrink-0" style={{ background: s.color }} />
              {series.length > 1 && <span className="text-muted-foreground truncate flex-1">{s.label}</span>}
              <span className="text-sm font-semibold tabular-nums text-foreground whitespace-nowrap">{moneyExact(s.values[hover] ?? 0)}</span>
            </div>
          ))}
          {active.details?.map((d) => (
            <div key={d.label} className="flex justify-between gap-2 pl-5 text-muted-foreground tabular-nums">
              <span>{d.label}</span>
              <span className="whitespace-nowrap">{moneyExact(d.minor)}</span>
            </div>
          ))}
          <div className="mt-1 text-muted-foreground tabular-nums">{active.orders} order{active.orders === 1 ? "" : "s"}</div>
        </div>
      )}

      {/* The same numbers without hovering, for screen readers. */}
      <div className="sr-only">
      <table>
        <caption>{label}</caption>
        <thead>
          <tr><th>Date</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}<th>Orders</th></tr>
        </thead>
        <tbody>
          {days.map((d, i) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              {series.map((s) => <td key={s.key}>{moneyExact(s.values[i] ?? 0)}</td>)}
              <td>{d.orders}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
