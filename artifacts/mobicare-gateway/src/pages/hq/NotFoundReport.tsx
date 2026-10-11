import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Ban, Download, MapPin, Minus, PackageX, SearchX, SpellCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HQ_ACCESS_KEY } from '@/lib/portalToken';
import { apiUrl } from '@/lib/apiUrl';

type Reason = 'out_of_stock' | 'not_listed' | 'misspelled' | 'not_in_catalogue';
type AreaCount = { area: string; searches: number; people: number };
type Row = {
  medicine: string;
  inCatalogue: boolean;
  reason: Reason;
  reasons: Partial<Record<Reason, number>>;
  searches: number;
  people: number;
  areas: AreaCount[];
  typed: string[];
  firstSeen: string;
  lastSeen: string;
  weekly: Array<{ week: string; searches: number }>;
  trend: 'rising' | 'falling' | 'steady' | 'new';
};
type Report = {
  range: { start: string; end: string };
  shareable: boolean;
  minimumPeople: number;
  summary: { searches: number; unavailableSearches: number; medicines: number; people: number };
  reasons: Array<{ reason: Reason; label: string; searches: number }>;
  areas: AreaCount[];
  rows: Row[];
};

const REASONS: Record<Reason, { label: string; short: string; icon: typeof Ban; tone: string }> = {
  out_of_stock: { label: 'Out of stock everywhere', short: 'Out of stock', icon: PackageX, tone: 'bg-amber-50 text-amber-900 border-amber-200' },
  not_listed: { label: 'No pharmacy offers it', short: 'Not offered', icon: Ban, tone: 'bg-rose-50 text-rose-900 border-rose-200' },
  misspelled: { label: 'Misspelled (it is available)', short: 'Misspelled', icon: SpellCheck, tone: 'bg-sky-50 text-sky-900 border-sky-200' },
  not_in_catalogue: { label: "Not in MobiCare's catalogue", short: 'Not in catalogue', icon: SearchX, tone: 'bg-muted text-foreground border-border' },
};

const TREND = {
  rising: { label: 'Rising', icon: ArrowUpRight, tone: 'text-rose-700' },
  falling: { label: 'Falling', icon: ArrowDownRight, tone: 'text-emerald-700' },
  steady: { label: 'Steady', icon: Minus, tone: 'text-muted-foreground' },
  new: { label: 'New', icon: Sparkles, tone: 'text-amber-700' },
} as const;

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtWeek = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * "Medicines not found": what patients searched for and could not get, why,
 * where and how the count is moving. Shown inside Data & Insights, with the
 * page's date range.
 */
export default function NotFoundReport({ start, end, reloadKey }: { start: string; end: string; reloadKey: number }) {
  const [area, setArea] = useState('');
  const [shareable, setShareable] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [areas, setAreas] = useState<AreaCount[]>([]);
  const [error, setError] = useState('');

  const query = (sharing: boolean) =>
    `start=${start}&end=${end}${area ? `&area=${encodeURIComponent(area)}` : ''}${sharing ? '&shareable=1' : ''}`;
  const headers = () => ({ Authorization: `Bearer ${localStorage.getItem(HQ_ACCESS_KEY)}` });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError('');
      const response = await fetch(apiUrl(`/api/hq/insights/not-found?${query(shareable)}`), { headers: headers() });
      if (!response.ok) { if (!cancelled) setError('Could not load the medicines not found.'); return; }
      const data = (await response.json()) as Report;
      if (cancelled) return;
      setReport(data);
      // Keep the area list from the unfiltered view, so choosing one area
      // does not empty the list of the others.
      if (!area) setAreas(data.areas);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, area, shareable]);

  const download = async (sharing: boolean) => {
    const response = await fetch(apiUrl(`/api/hq/insights/not-found.csv?${query(sharing)}`), { headers: headers() });
    if (!response.ok) { setError('Could not download the report.'); return; }
    const name = /filename="?([^";]+)"?/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'mobicare-medicines-not-found.csv';
    const href = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = href; link.download = name; link.click();
    URL.revokeObjectURL(href);
  };

  const s = report?.summary;
  const share = s && s.searches > 0 ? Math.round((s.unavailableSearches / s.searches) * 100) : 0;
  const maxWeek = Math.max(1, ...(report?.rows ?? []).flatMap((r) => r.weekly.map((w) => w.searches)));

  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5 space-y-5" data-testid="section-not-found">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold">Medicines not found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            What patients searched for and could not get, why, and where. Spelling variants are counted as one medicine; a misspelling of a medicine that is in stock is not counted at all.
            Only searches from patients who leave "Help improve medicine access" on are counted.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void download(false)} data-testid="button-not-found-hq-csv">
            <Download className="w-4 h-4" /> HQ copy
          </Button>
          <Button onClick={() => void download(true)} data-testid="button-not-found-shareable-csv">
            <Download className="w-4 h-4" /> Shareable copy
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <select
            className="rounded-md border bg-background px-2 py-1.5"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            data-testid="select-not-found-area"
          >
            <option value="">All areas</option>
            {areas.map((a) => <option key={a.area} value={a.area}>{a.area}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={shareable} onChange={(e) => setShareable(e.target.checked)} data-testid="toggle-not-found-shareable" />
          Show as shared (only medicines and areas with {report?.minimumPeople && shareable ? report.minimumPeople : 5}+ different people)
        </label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Tile label="Searches not found" value={s ? s.unavailableSearches.toLocaleString() : '—'} note={s ? `${share}% of ${s.searches.toLocaleString()} searches` : ''} />
        <Tile label="Medicines" value={s ? s.medicines.toLocaleString() : '—'} note="searched for, not found" />
        <Tile label="Different people" value={s ? s.people.toLocaleString() : '—'} note="who could not find something" />
        <Tile label="Most common reason" value={report?.reasons.slice().sort((a, b) => b.searches - a.searches)[0] ? REASONS[report.reasons.slice().sort((a, b) => b.searches - a.searches)[0]!.reason].short : '—'} note="see the breakdown below" />
      </div>

      {report && report.reasons.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="not-found-reasons">
          {report.reasons.map((r) => {
            const meta = REASONS[r.reason];
            return (
              <span key={r.reason} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${meta.tone}`}>
                <meta.icon className="w-3.5 h-3.5" /> {meta.label} · {r.searches}
              </span>
            );
          })}
        </div>
      )}

      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="w-full min-w-[860px] text-sm" data-testid="table-not-found">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b">
              <th className="py-2 pl-4 sm:pl-0 pr-3 font-medium">Medicine</th>
              <th className="py-2 pr-3 font-medium">Why not found</th>
              <th className="py-2 pr-3 font-medium text-right">Searches</th>
              <th className="py-2 pr-3 font-medium text-right">People</th>
              <th className="py-2 pr-3 font-medium">Where</th>
              <th className="py-2 pr-3 font-medium">Last 8 weeks</th>
              <th className="py-2 pr-4 sm:pr-0 font-medium">Seen</th>
            </tr>
          </thead>
          <tbody>
            {(report?.rows ?? []).map((row) => {
              const reason = REASONS[row.reason];
              const trend = TREND[row.trend];
              return (
                <tr key={row.medicine} className="border-b last:border-0 align-top" data-testid="row-not-found">
                  <td className="py-3 pl-4 sm:pl-0 pr-3">
                    <p className="font-semibold">{row.medicine}</p>
                    {!row.inCatalogue && <p className="text-xs text-muted-foreground">As typed: not a MobiCare medicine</p>}
                    {row.inCatalogue && row.typed.some((t) => t !== row.medicine.toLowerCase()) && (
                      <p className="text-xs text-muted-foreground mt-0.5">Typed: {row.typed.join(', ')}</p>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${reason.tone}`}>
                      <reason.icon className="w-3.5 h-3.5" /> {reason.short}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums font-semibold">{row.searches.toLocaleString()}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{row.people.toLocaleString()}</td>
                  <td className="py-3 pr-3 text-xs">
                    {row.areas.slice(0, 3).map((a) => (
                      <div key={a.area} className="flex gap-1.5">
                        <span className="truncate max-w-[11rem]">{a.area}</span><span className="tabular-nums text-muted-foreground">· {a.searches}</span>
                      </div>
                    ))}
                    {row.areas.length > 3 && <div className="text-muted-foreground">+{row.areas.length - 3} more</div>}
                    {row.areas.length === 0 && (
                      <div className="text-muted-foreground">Spread out: no one area has {report?.minimumPeople ?? 5}+ people</div>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex items-end gap-2">
                      <Spark weekly={row.weekly} max={maxWeek} medicine={row.medicine} />
                      <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${trend.tone}`}>
                        <trend.icon className="w-3.5 h-3.5" /> {trend.label}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 pr-4 sm:pr-0 text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDay(row.firstSeen)} – {fmtDay(row.lastSeen)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {report && report.rows.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {report.shareable ? `No medicine was searched without success by ${report.minimumPeople} or more people in these dates.` : 'Every search in these dates found something.'}
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        The shareable copy is for the Ministry of Health, health organisations and pharmacies: it leaves out anything searched by
        fewer than 5 different people and never includes what was typed. The HQ copy has everything and stays inside MobiCare.
        Areas are delivery zones, else districts; exact locations are never stored.
      </p>
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

/** Eight weekly bars on one shared scale; hover or focus a bar for its week. */
function Spark({ weekly, max, medicine }: { weekly: Row['weekly']; max: number; medicine: string }) {
  const height = 28;
  return (
    <svg width={weekly.length * 9} height={height} role="img" aria-label={`${medicine}: ${weekly.map((w) => w.searches).join(', ')} searches over the last ${weekly.length} weeks`}>
      {weekly.map((w, i) => {
        const h = w.searches === 0 ? 1.5 : Math.max(3, (w.searches / max) * height);
        return (
          <g key={w.week}>
            <title>{`Week of ${fmtWeek(w.week)}: ${w.searches} search${w.searches === 1 ? '' : 'es'}`}</title>
            {/* Full-height hit area, larger than the bar. */}
            <rect x={i * 9} y={0} width={9} height={height} fill="transparent" />
            <rect
              x={i * 9 + 1}
              y={height - h}
              width={7}
              height={h}
              rx={1.5}
              fill={w.searches === 0 ? 'hsl(var(--muted-foreground) / 0.25)' : i === weekly.length - 1 ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.45)'}
            />
          </g>
        );
      })}
    </svg>
  );
}
