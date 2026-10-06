import {
  getGetAnalyticsOverviewQueryKey,
  getGetPharmacyOnlineAnalyticsQueryKey,
  useGetAnalyticsOverview,
  useGetPharmacyOnlineAnalytics,
} from "@workspace/api-client-react";
import { formatLeones } from "@/lib/format";
import { format, subDays } from "date-fns";
import { Activity, Clock, Package, AlertTriangle, TrendingUp, ArrowRight, Wallet, type LucideIcon } from "lucide-react";
import { Link } from "wouter";
import { useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { TrendChart, TREND_GREEN } from "@/components/TrendChart";

/**
 * The pharmacy's Overview. Every order is paid through MobiCare (Monime), so
 * the money figures are the pharmacy's own prices and what it earns after
 * MobiCare's 5% commission, counted on the day the payment was confirmed.
 */
export default function Dashboard() {
  const { data: analytics, isLoading: analyticsLoading } = useGetAnalyticsOverview({
    query: {
      queryKey: getGetAnalyticsOverviewQueryKey(),
      refetchInterval: 5_000,
    },
  });
  const [dateRange, setDateRange] = useState("30");
  const [customStart, setCustomStart] = useState(() => format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(() => format(new Date(), "yyyy-MM-dd"));

  const queryParams = useMemo(() => {
    if (dateRange === "custom") return { start: customStart, end: customEnd };
    const end = format(new Date(), "yyyy-MM-dd");
    const start = format(subDays(new Date(), parseInt(dateRange, 10)), "yyyy-MM-dd");
    return { start, end };
  }, [dateRange, customStart, customEnd]);

  const { data: sales, isLoading: salesLoading } = useGetPharmacyOnlineAnalytics(queryParams, {
    query: {
      queryKey: getGetPharmacyOnlineAnalyticsQueryKey(queryParams),
      refetchInterval: 15_000,
      placeholderData: (previous) => previous,
    },
  });

  const days = useMemo(() => (sales?.daily ?? []).map((d) => ({ date: d.date, orders: d.ordersCount })), [sales]);
  const series = useMemo(
    () => [{ key: "earnings", label: "Your earnings", color: TREND_GREEN, values: (sales?.daily ?? []).map((d) => d.receiveMinor) }],
    [sales],
  );

  if (analyticsLoading || (salesLoading && !sales)) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-card rounded-xl border border-card-border animate-pulse" />
          ))}
        </div>
        <div className="h-[400px] bg-card rounded-xl border border-card-border animate-pulse" />
      </div>
    );
  }

  if (!analytics) return null;

  const today = sales?.today;
  const salesTodayMinor = today?.salesMinor ?? 0;
  const earningsTodayMinor = today?.receiveMinor ?? 0;
  const ordersToday = today?.ordersCount ?? 0;

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Today's Overview</h1>
        <p className="text-muted-foreground mt-1 text-sm">Key metrics and recent activity for your pharmacy.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          title="Gross Collected Today"
          value={formatLeones(salesTodayMinor / 100)}
          icon={TrendingUp}
          trend="Paid by patients, at your prices"
        />
        <MetricCard
          title="Your Earnings Today"
          value={formatLeones(earningsTodayMinor / 100)}
          icon={Wallet}
          trend="After MobiCare's 5% commission"
          linkTo="/payouts"
        />
        <MetricCard title="Orders Today" value={ordersToday} icon={Package} trend="Paid orders" />
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
          title="Low Stock Items"
          value={analytics.lowStockItems}
          icon={AlertTriangle}
          trend="< 5 in stock"
          urgent={analytics.lowStockItems > 0}
          linkTo="/inventory"
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">Sales Trend</h3>
            <p className="text-sm text-muted-foreground">Your daily earnings from paid orders. Tap a day to see its orders.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dateRange === "custom" && (
              <div className="flex items-center gap-2">
                <Input type="date" className="w-36 h-9" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                <span className="text-muted-foreground">-</span>
                <Input type="date" className="w-36 h-9" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
              </div>
            )}
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Select range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className={salesLoading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <TrendChart days={days} series={series} label="Your daily earnings from paid orders" />
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
  linkTo,
}: {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  urgent?: boolean;
  linkTo?: string;
}) {
  const content = (
    <div className={`bg-card rounded-xl p-6 border shadow-sm transition-all h-full ${urgent ? "border-destructive/50 bg-destructive/5" : "border-card-border"} ${linkTo ? "hover:shadow-md hover:border-primary/50" : ""}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        <div className={`p-2 rounded-md ${urgent ? "bg-destructive/20 text-destructive" : "bg-primary/10 text-primary"}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="mt-4">
        <div className="text-3xl font-bold text-foreground">{value}</div>
        {trend && (
          <p className={`mt-1 text-xs ${urgent ? "text-destructive font-medium" : "text-muted-foreground"}`}>
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
