import { useEffect, useId, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  valueMinor: number; // what the line shows (cents)
  orders: number; // shown in the tooltip
}

export type TrendStyle = "area" | "line";

/** Validated chart green (chroma, lightness and contrast checks pass on the card surface). */
const SERIES = "#0E8C62";
const HEIGHT = 280;
const PAD = { top: 16, right: 16, bottom: 34, left: 64 };

const money = (minor: number) => `Le ${(minor / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const moneyExact = (minor: number) => `Le ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
 * A pharmacy's daily trend: one series (earnings), so no legend; the tooltip
 * adds the order count. Draws itself in on load and whenever the range
 * changes, unless the reader prefers reduced motion.
 *
 * - "area": smooth curve over a soft fill, ringed markers on stems.
 * - "line": straight segments with a dot on every day, over a light grid.
 */
export function TrendChart({ points, style, label }: { points: TrendPoint[]; style: TrendStyle; label: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, "");

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
  const max = Math.max(0, ...points.map((p) => p.valueMinor));
  const { top, step } = niceScale(max);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const xAt = (i: number) => pad.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yAt = (v: number) => pad.top + innerH - (v / top) * innerH;
  const coords = points.map((p, i) => [xAt(i), yAt(p.valueMinor)] as [number, number]);
  const baseline = pad.top + innerH;

  const linePath = style === "area"
    ? smoothPath(coords)
    : coords.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  const areaPath = coords.length ? `${linePath} L${coords.at(-1)![0]},${baseline} L${coords[0]![0]},${baseline} Z` : "";

  // Date labels: about one per 90px, always including the last day.
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 90))));
  const showLabel = (i: number) => i === points.length - 1 || (i % every === 0 && points.length - 1 - i >= every / 2);
  // Markers on every day while they have room; otherwise hover only.
  const markEvery = innerW / Math.max(1, points.length) >= 14;
  // Replays the drawing animation when the data changes.
  const animationKey = useMemo(() => `${points.length}:${points[0]?.date}:${points.at(-1)?.date}:${max}`, [points, max]);

  const onMove = (event: React.PointerEvent<SVGRectElement>) => {
    const box = (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * width;
    const i = Math.round(((x - pad.left) / innerW) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };
  const onKey = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setHover((h) => Math.min(points.length - 1, Math.max(0, (h ?? points.length - 1) + (event.key === "ArrowRight" ? 1 : -1))));
  };

  const active = hover !== null ? points[hover] : null;
  const allZero = max === 0;

  return (
    <div ref={wrapRef} className="relative w-full" data-testid={`trend-chart-${style}`}>
      <style>{`
        @keyframes tc-draw { from { stroke-dashoffset: var(--tc-len); } to { stroke-dashoffset: 0; } }
        @keyframes tc-rise { from { transform: scaleY(0); opacity: 0; } to { transform: scaleY(1); opacity: 1; } }
        @keyframes tc-pop { 0% { transform: scale(0); } 70% { transform: scale(1.25); } 100% { transform: scale(1); } }
        @keyframes tc-stem { from { transform: scaleY(0); } to { transform: scaleY(1); } }
        .tc-line { stroke-dasharray: var(--tc-len); animation: tc-draw 1.4s cubic-bezier(.4,0,.2,1) both; }
        .tc-area { transform-box: fill-box; transform-origin: bottom; animation: tc-rise 1.1s cubic-bezier(.4,0,.2,1) .15s both; }
        .tc-mark { transform-box: fill-box; transform-origin: center; animation: tc-pop .45s ease-out both; }
        .tc-stem { transform-box: fill-box; transform-origin: bottom; animation: tc-stem .5s ease-out both; }
        @media (prefers-reduced-motion: reduce) { .tc-line, .tc-area, .tc-mark, .tc-stem { animation: none; } }
      `}</style>
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
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES} stopOpacity={style === "area" ? 0.28 : 0.08} />
            <stop offset="100%" stopColor={SERIES} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Grid and y axis: recessive */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={width - pad.right} y1={yAt(v)} y2={yAt(v)} stroke="hsl(var(--border))" strokeDasharray={style === "area" && v > 0 ? "4 4" : undefined} />
            <text x={pad.left - 8} y={yAt(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="hsl(var(--muted-foreground))" className="tabular-nums">
              {money(v)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          showLabel(i) ? (
            <text key={p.date} x={xAt(i)} y={HEIGHT - 10} textAnchor={i === points.length - 1 ? "end" : i === 0 ? "start" : "middle"} fontSize={11} fill="hsl(var(--muted-foreground))">
              {format(parseISO(p.date), "MMM d")}
            </text>
          ) : null,
        )}

        <g key={animationKey}>
          {areaPath && <path className="tc-area" d={areaPath} fill={`url(#${gradientId})`} />}

          {style === "area" && markEvery && coords.map(([x, y], i) => (
            <line key={`s${i}`} className="tc-stem" x1={x} x2={x} y1={baseline} y2={y} stroke={SERIES} strokeOpacity={0.35} strokeWidth={1.5}
              style={{ animationDelay: `${0.5 + (i / points.length) * 0.9}s` }} />
          ))}

          <path
            className="tc-line"
            d={linePath}
            fill="none"
            stroke={SERIES}
            strokeWidth={style === "area" ? 2.5 : 2}
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={1000}
            style={{ ["--tc-len" as string]: 1000 }}
          />

          {markEvery && coords.map(([x, y], i) => (
            <circle key={`m${i}`} className="tc-mark" cx={x} cy={y}
              r={style === "area" ? 5 : 4}
              fill={style === "area" ? "hsl(var(--card))" : SERIES}
              stroke={style === "area" ? SERIES : "hsl(var(--card))"}
              strokeWidth={2}
              style={{ animationDelay: `${0.5 + (i / points.length) * 0.9}s` }} />
          ))}
        </g>

        {/* Crosshair */}
        {active && hover !== null && (
          <g pointerEvents="none">
            <line x1={xAt(hover)} x2={xAt(hover)} y1={pad.top} y2={baseline} stroke="hsl(var(--foreground))" strokeOpacity={0.25} />
            <circle cx={xAt(hover)} cy={yAt(active.valueMinor)} r={6} fill={SERIES} stroke="hsl(var(--card))" strokeWidth={2} />
          </g>
        )}
        <rect x={pad.left} y={pad.top} width={innerW} height={innerH + 8} fill="transparent"
          onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
      </svg>

      {allZero && (
        <p className="absolute inset-x-0 top-1/3 text-center text-sm text-muted-foreground pointer-events-none">
          No sales in this period yet
        </p>
      )}

      {active && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-card-border bg-popover px-3 py-2 shadow-md text-xs"
          style={{
            left: Math.min(Math.max(xAt(hover) - 70, 0), width - 150),
            top: Math.max(0, yAt(active.valueMinor) - 76),
            width: 150,
          }}
          role="status"
        >
          <div className="text-muted-foreground">{format(parseISO(active.date), "EEE, MMM d")}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-block w-3 h-0.5 rounded" style={{ background: SERIES }} />
            <span className="text-sm font-semibold tabular-nums text-foreground">{moneyExact(active.valueMinor)}</span>
          </div>
          <div className="text-muted-foreground tabular-nums">{active.orders} order{active.orders === 1 ? "" : "s"}</div>
        </div>
      )}

      {/* The same numbers without hovering, for screen readers. */}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead><tr><th>Date</th><th>Earnings</th><th>Orders</th></tr></thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}><td>{p.date}</td><td>{moneyExact(p.valueMinor)}</td><td>{p.orders}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
