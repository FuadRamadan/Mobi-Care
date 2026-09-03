import { useGetAnalyticsOverview } from "@workspace/api-client-react";
import { useEffect, useState } from "react";
import { formatLeones } from "@/lib/format";
import { format, parseISO } from "date-fns";
import { Activity, Clock, Package, AlertTriangle, TrendingUp, ArrowRight, type LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { data: analytics, isLoading: analyticsLoading } = useGetAnalyticsOverview();
  const today = new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState<'7' | '30' | '90' | 'custom'>('30');
  const [start, setStart] = useState(new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(today);
  const [chartData, setChartData] = useState<Array<{ date: string; orders: number; revenueLeones: number }> | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setChartLoading(true);
    fetch(`${import.meta.env.BASE_URL}api/pharmacy/analytics/orders-by-day?start=${start}&end=${end}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('mc_access')}` },
      signal: controller.signal,
    })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Unable to load order trend.')))
      .then((rows: Array<{ date: string; orders: number; revenueLeones: number }>) => setChartData(rows))
      .catch(error => { if (error.name !== 'AbortError') setChartData([]); })
      .finally(() => { if (!controller.signal.aborted) setChartLoading(false); });
    return () => controller.abort();
  }, [start, end]);
  const selectRange = (value: '7' | '30' | '90' | 'custom') => {
    setRange(value);
    if (value !== 'custom') {
      setStart(new Date(Date.now() - (Number(value) - 1) * 86400_000).toISOString().slice(0, 10));
      setEnd(today);
    }
  };

  if (analyticsLoading || chartLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-card rounded-xl border border-card-border animate-pulse" />
          ))}
        </div>
        <div className="h-[400px] bg-card rounded-xl border border-card-border animate-pulse" />
      </div>
    );
  }

  if (!analytics) return null;
  const maxDailyOrders = Math.max(
    1,
    ...(chartData ?? []).map((day) => day.orders),
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Today's Overview</h1>
        <p className="text-muted-foreground mt-1 text-sm">Key metrics and recent activity for your pharmacy.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Daily Revenue"
          value={formatLeones(analytics.dailyRevenueLeones)}
          icon={TrendingUp}
          trend="Today's pharmacy earnings"
        />
        <MetricCard 
          title="Pending Orders" 
          value={analytics.pendingOrders} 
          icon={Clock} 
          trend="Action required" 
          urgent={analytics.pendingOrders > 0} 
          linkTo="/orders"
        />
        <MetricCard 
          title="Pending Prescriptions" 
          value={analytics.pendingPrescriptions} 
          icon={Activity} 
          trend="Awaiting review"
          urgent={analytics.pendingPrescriptions > 0}
          linkTo="/prescriptions"
        />
        <MetricCard 
          title="Pharmacy earnings"
          value={formatLeones(analytics.revenueLeones)} 
          icon={TrendingUp} 
          trend="Completed orders" 
        />
        <MetricCard 
          title="Low Stock Items" 
          value={analytics.lowStockItems} 
          icon={AlertTriangle} 
          trend="< 5 in stock"
          urgent={analytics.lowStockItems > 0}
          linkTo="/inventory"
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-8">
        {analytics.pendingOrders > 0 && (
          <Link href="/orders" className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium flex items-center justify-between sm:justify-start gap-2 hover:bg-primary/90 transition-colors shadow-sm">
            Review {analytics.pendingOrders} Pending Orders <ArrowRight className="w-4 h-4" />
          </Link>
        )}
        {analytics.pendingPrescriptions > 0 && (
          <Link href="/prescriptions" className="bg-destructive text-destructive-foreground px-4 py-2 rounded-md text-sm font-medium flex items-center justify-between sm:justify-start gap-2 hover:bg-destructive/90 transition-colors shadow-sm">
            Review {analytics.pendingPrescriptions} Prescriptions <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </div>

      <div className="bg-card border border-card-border rounded-xl p-4 sm:p-6 shadow-sm">
        <div className="mb-6">
          <h3 className="text-lg font-semibold">Order Volume & Revenue</h3>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {(['7', '30', '90'] as const).map(days => <Button key={days} size="sm" variant={range === days ? 'default' : 'outline'} onClick={() => selectRange(days)}>Last {days} days</Button>)}
            <Button size="sm" variant={range === 'custom' ? 'default' : 'outline'} onClick={() => selectRange('custom')}>Custom</Button>
            {range === 'custom' && <>
              <input className="rounded border bg-background px-2 py-1 text-sm" type="date" value={start} max={end} onChange={event => setStart(event.target.value)} />
              <input className="rounded border bg-background px-2 py-1 text-sm" type="date" value={end} min={start} max={today} onChange={event => setEnd(event.target.value)} />
            </>}
          </div>
        </div>
        <div className="h-[350px] w-full">
          {chartData && chartData.length > 0 ? (
            <div
              className="flex h-full min-w-[680px] items-end gap-1 overflow-x-auto border-b border-border px-2 pt-8"
              role="img"
              aria-label={`Daily completed order volume from ${start} to ${end}`}
            >
              {chartData.map((day, index) => (
                <div
                  key={day.date}
                  className="group flex h-full min-w-5 flex-1 flex-col items-center justify-end gap-2"
                  title={`${format(parseISO(day.date), 'MMM d, yyyy')}: ${day.orders} orders, ${formatLeones(day.revenueLeones)}`}
                >
                  <span className="pointer-events-none hidden rounded bg-popover px-2 py-1 text-xs shadow group-hover:block">
                    {day.orders}
                  </span>
                  <div
                    className="w-full min-h-1 rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
                    style={{ height: `${Math.max(2, (day.orders / maxDailyOrders) * 85)}%` }}
                    aria-hidden="true"
                  />
                  <span className="h-5 text-[10px] text-muted-foreground">
                    {index % 5 === 0 || index === chartData.length - 1
                      ? format(parseISO(day.date), 'MMM d')
                      : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              No orders in this period
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ 
  title, 
  value, 
  icon: Icon, 
  trend,
  urgent,
  linkTo
}: { 
  title: string; 
  value: string | number; 
  icon: LucideIcon;
  trend?: string;
  urgent?: boolean;
  linkTo?: string;
}) {
  const content = (
    <div className={`bg-card rounded-xl p-6 border shadow-sm transition-all h-full ${urgent ? 'border-destructive/50 bg-destructive/5' : 'border-card-border'} ${linkTo ? 'hover:shadow-md hover:border-primary/50' : ''}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        <div className={`p-2 rounded-md ${urgent ? 'bg-destructive/20 text-destructive' : 'bg-primary/10 text-primary'}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="mt-4">
        <div className="text-3xl font-bold text-foreground">{value}</div>
        {trend && (
          <p className={`mt-1 text-xs ${urgent ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
            {trend}
          </p>
        )}
      </div>
    </div>
  );

  if (linkTo) {
    return <Link href={linkTo} className="block h-full">{content}</Link>;
  }
  return content;
}
