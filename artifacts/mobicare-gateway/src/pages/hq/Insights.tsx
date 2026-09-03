import { useEffect, useState } from 'react';
import { Redirect } from 'wouter';
import HqLayout from './HqLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHqAuth } from '@/hq/auth';
import { HQ_ACCESS_KEY } from '@/lib/portalToken';

type Insights = {
  totals: Record<string, number>;
  trends: Record<string, Array<{ period: string; count: number }>>;
  rankings: Record<string, Array<{ label: string; count?: number; revenue?: number; category?: string; area?: string }>>;
};
const today = new Date().toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

export default function HqInsights() {
  const { user } = useHqAuth();
  const [start, setStart] = useState(monthAgo);
  const [end, setEnd] = useState(today);
  const [interval, setInterval] = useState<'day' | 'week' | 'month'>('day');
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    setError('');
    const response = await fetch(`${import.meta.env.BASE_URL}api/hq/insights?start=${start}&end=${end}&interval=${interval}`, { headers: { Authorization: `Bearer ${localStorage.getItem(HQ_ACCESS_KEY)}` } });
    if (!response.ok) { setError('Unable to load aggregate insights.'); return; }
    setData(await response.json() as Insights);
  };
  useEffect(() => { if (user?.canViewDataInsights) void load(); }, [user?.canViewDataInsights]);
  if (!user) return <Redirect to="/hq" />;
  if (!user.canViewDataInsights) return <Redirect to="/hq/dashboard" />;
  const exportCsv = async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}api/hq/insights/export.csv?start=${start}&end=${end}&interval=${interval}`, { headers: { Authorization: `Bearer ${localStorage.getItem(HQ_ACCESS_KEY)}` } });
    if (!response.ok) { setError('Unable to export aggregate insights.'); return; }
    const href = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = href; link.download = 'mobicare-data-insights.csv'; link.click();
    URL.revokeObjectURL(href);
  };
  const exportCurrentData = async (resource: 'orders' | 'patients' | 'notifications' | 'catalogue' | 'inventory') => {
    setError('');
    const response = await fetch(`${import.meta.env.BASE_URL}api/hq/exports/${resource}.csv`, { headers: { Authorization: `Bearer ${localStorage.getItem(HQ_ACCESS_KEY)}` } });
    if (!response.ok) { setError(`Unable to export current ${resource} data.`); return; }
    const href = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = href; link.download = `mobicare-${resource}.csv`; link.click();
    URL.revokeObjectURL(href);
  };
  const setPreset = (days: number) => {
    setStart(new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10));
    setEnd(today);
  };
  return <HqLayout title="Data & Insights">
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-4 flex flex-wrap gap-3 items-end">
        <label className="text-sm">From<Input type="date" value={start} max={end} onChange={e => setStart(e.target.value)} /></label>
        <label className="text-sm">To<Input type="date" value={end} min={start} max={today} onChange={e => setEnd(e.target.value)} /></label>
        <Button onClick={() => void load()}>Apply range</Button>
        {[7, 30, 90].map(days => <Button key={days} variant="outline" onClick={() => setPreset(days)}>Last {days} days</Button>)}
        <label className="text-sm">Group by<select className="ml-2 rounded border bg-background px-2 py-2" value={interval} onChange={e => setInterval(e.target.value as 'day' | 'week' | 'month')}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>
        <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
        <Button variant="outline" onClick={() => window.print()}>Print / Save PDF</Button>
      </div>
      <p className="text-sm text-muted-foreground">Aggregate reporting. No patient identities or order-level records are displayed or exported. Every recorded group is included.</p>
      <section className="rounded-xl border bg-card p-4">
        <h2 className="font-semibold">Current data exports</h2>
        <p className="mt-1 text-sm text-muted-foreground">Download a current, read-only CSV snapshot. Exporting never changes or removes the original records.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['orders', 'patients', 'notifications', 'catalogue', 'inventory'] as const).map(resource => (
            <Button key={resource} variant="outline" onClick={() => void exportCurrentData(resource)}>
              Export {titleize(resource)}
            </Button>
          ))}
        </div>
      </section>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        {Object.entries(data?.totals ?? {}).map(([key, value]) => <div key={key} className="rounded-xl border bg-card p-4"><p className="text-xs uppercase text-muted-foreground">{key.replace(/([A-Z])/g, ' $1')}</p><p className="mt-2 text-2xl font-bold">{value.toLocaleString()}</p></div>)}
      </div>
      <div className="grid gap-4 md:grid-cols-2">{Object.entries(data?.trends ?? {}).map(([key, rows]) => <Trend key={key} title={titleize(key)} rows={rows} />)}</div>
      <div className="grid gap-4 md:grid-cols-2">{Object.entries(data?.rankings ?? {}).map(([key, rows]) => <Ranking key={key} title={titleize(key)} rows={rows} />)}</div>
    </div>
  </HqLayout>;
}
const titleize = (value: string) => value.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
function Ranking({ title, rows }: { title: string; rows: Array<{ label: string; count?: number; revenue?: number; category?: string; area?: string }> }) {
  return <section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">{title}</h2>{rows.length ? <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-2 text-sm">{rows.map((row, index) => <li key={`${row.label ?? row.category}-${index}`} className="flex justify-between gap-2 border-b pb-1 last:border-0"><span>{row.label ?? `${row.category} — ${row.area}`}</span><strong>{(row.revenue ?? row.count ?? 0).toLocaleString()}</strong></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No data in this period.</p>}</section>;
}
function Trend({ title, rows }: { title: string; rows: Array<{ period: string; count: number }> }) {
  const max = Math.max(...rows.map(row => Number(row.count)), 1);
  return <section className="rounded-xl border bg-card p-4"><h2 className="font-semibold">{title}</h2>{rows.length ? <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-2">{rows.map(row => <div key={row.period} className="grid grid-cols-[6rem_1fr_3rem] items-center gap-2 text-xs"><span>{row.period}</span><div className="h-3 rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: `${Math.max(3, Number(row.count) / max * 100)}%` }} /></div><strong className="text-right">{Number(row.count).toLocaleString()}</strong></div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">No data in this period.</p>}</section>;
}