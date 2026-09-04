import {
  useGetAnalyticsOverview,
  useGetPharmacyCommissionAnalytics,
  exportPharmacyCommissionHistory
} from "@workspace/api-client-react";
import { formatLeones } from "@/lib/format";
import { format, parseISO, subDays, isSameDay } from "date-fns";
import { Activity, Clock, Package, AlertTriangle, TrendingUp, ArrowRight, type LucideIcon, FileText, Download } from "lucide-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  unpaid: "bg-destructive/10 text-destructive",
  partially_paid: "bg-amber-100 text-amber-800",
  paid: "bg-green-100 text-green-800",
};

const formatStatus = (status: string) => {
  if (status === 'partially_paid') return 'Partially Paid';
  return status.charAt(0).toUpperCase() + status.slice(1);
};

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: analytics, isLoading: analyticsLoading } = useGetAnalyticsOverview();
  const [dateRange, setDateRange] = useState("30");
  const [customStart, setCustomStart] = useState(() => format(subDays(new Date(), 30), 'yyyy-MM-dd'));
  const [customEnd, setCustomEnd] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  const queryParams = useMemo(() => {
    if (dateRange === "custom") {
      return { start: customStart, end: customEnd };
    }
    const end = format(new Date(), 'yyyy-MM-dd');
    const start = format(subDays(new Date(), parseInt(dateRange, 10)), 'yyyy-MM-dd');
    return { start, end };
  }, [dateRange, customStart, customEnd]);

  const { data: commissionData, isLoading: commissionLoading } = useGetPharmacyCommissionAnalytics(queryParams);

  const chartData = commissionData?.daily || [];
  const todayStat = commissionData?.today;
  const outstandingCommission = commissionData?.outstandingCommissionMinor ?? 0;

  const handleExportCSV = async () => {
    try {
      // The generated API client method fetches the CSV string.
      const csv = await exportPharmacyCommissionHistory(queryParams);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `commission_history_${format(new Date(), 'yyyy-MM-dd')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err) {
      toast.error("Failed to export CSV");
    }
  };

  if (analyticsLoading || commissionLoading) {
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

  if (!analytics || !commissionData) return null;

  const maxDailyOrders = Math.max(1, ...chartData.map((day) => day.ordersCount));

  // Calculate today's metrics from the commission backend directly
  const ordersToday = todayStat?.ordersCount || 0;
  const commissionTodayMinor = todayStat?.commissionDueMinor || 0;
  const grossTodayMinor = todayStat?.grossCollectedMinor || 0;
  const earningsTodayMinor = todayStat?.pharmacyEarningsMinor || 0;

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Today's Overview</h1>
        <p className="text-muted-foreground mt-1 text-sm">Key metrics and recent activity for your pharmacy.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Commission Owed Today"
          value={formatLeones(commissionTodayMinor / 100)}
          icon={FileText}
          trend="Owed to MobiCare"
          urgent={commissionTodayMinor > 0}
        />
        <MetricCard
          title="Gross Collected Today"
          value={formatLeones(grossTodayMinor / 100)}
          icon={TrendingUp}
          trend="Paid by patients"
        />
        <MetricCard
          title="Your Earnings Today"
          value={formatLeones(earningsTodayMinor / 100)}
          icon={TrendingUp}
          trend="Gross minus commission"
        />
        <MetricCard
          title="Orders Today"
          value={ordersToday}
          icon={Package}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
        <MetricCard
          title="Outstanding Balance"
          value={formatLeones(outstandingCommission / 100)}
          icon={AlertTriangle}
          trend="Across all unpaid days"
          urgent={outstandingCommission > 0}
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold">Order Volume & Commission Trends</h3>
            <p className="text-sm text-muted-foreground">Daily performance</p>
          </div>
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            {dateRange === "custom" && (
              <div className="flex items-center gap-2 mr-2">
                <Input
                  type="date"
                  className="w-36 h-9"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
                <span className="text-muted-foreground">-</span>
                <Input
                  type="date"
                  className="w-36 h-9"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
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
        <div className="h-[350px] w-full">
          {chartData.length > 0 ? (
            <div
              className="flex h-full min-w-[680px] items-end gap-1 overflow-x-auto border-b border-border px-2 pt-8"
              role="img"
              aria-label={`Daily order volume for the selected period`}
            >
              {chartData.map((day, index) => {
                const dayComm = day.commissionDueMinor / 100;
                return (
                  <div
                    key={day.settlementDate}
                    className="group flex h-full min-w-5 flex-1 flex-col items-center justify-end gap-2"
                    title={`${format(parseISO(day.settlementDate), 'MMM d, yyyy')}: ${day.ordersCount} orders, Comm: ${formatLeones(dayComm)}`}
                  >
                    <span className="pointer-events-none hidden rounded bg-popover px-2 py-1 text-xs shadow group-hover:block whitespace-nowrap z-10">
                      {day.ordersCount} ord / {formatLeones(dayComm)}
                    </span>
                    <div
                      className="w-full min-h-[4px] rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
                      style={{ height: `${Math.max(1, (day.ordersCount / maxDailyOrders) * 85)}%` }}
                      aria-hidden="true"
                    />
                    <span className="h-5 text-[10px] text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
                      {index % Math.ceil(chartData.length / 10) === 0 || index === chartData.length - 1
                        ? format(parseISO(day.settlementDate), 'MMM d')
                        : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              No data available for the selected period
            </div>
          )}
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-4 sm:p-6 shadow-sm overflow-x-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Commission History</h3>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={handleExportCSV}>
              <Download className="w-4 h-4" />
              Export CSV
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => window.print()}>
              <FileText className="w-4 h-4" />
              Print / PDF
            </Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Gross Collected</TableHead>
              <TableHead className="text-right">Your Earnings</TableHead>
              <TableHead className="text-right">Commission Due</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...chartData].reverse().filter(d => d.ordersCount > 0 || isSameDay(parseISO(d.settlementDate), new Date())).map(day => {
              const comm = day.commissionDueMinor / 100;
              const gross = day.grossCollectedMinor / 100;
              const earnings = day.drugAmountTotalMinor / 100;
              return (
                <TableRow
                  key={day.settlementDate}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setLocation(`/orders?date=${format(parseISO(day.settlementDate), 'yyyy-MM-dd')}`)}
                  title="View orders for this day"
                >
                  <TableCell className="font-medium text-primary">{format(parseISO(day.settlementDate), 'MMM d, yyyy')}</TableCell>
                  <TableCell className="text-right">{day.ordersCount}</TableCell>
                  <TableCell className="text-right">{formatLeones(gross)}</TableCell>
                  <TableCell className="text-right">{formatLeones(earnings)}</TableCell>
                  <TableCell className="text-right">{formatLeones(comm)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center justify-center px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[day.status] || "bg-muted text-muted-foreground"}`}>
                      {formatStatus(day.status)}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
            {chartData.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground h-24">
                  No commission records for this period.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
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
