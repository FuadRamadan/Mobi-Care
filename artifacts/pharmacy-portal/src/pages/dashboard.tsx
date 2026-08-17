import { useGetAnalyticsOverview, useGetOrdersByDay } from "@workspace/api-client-react";
import { formatLeones } from "@/lib/format";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, parseISO } from "date-fns";
import { Activity, Clock, Package, AlertTriangle, TrendingUp, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  const { data: analytics, isLoading: analyticsLoading } = useGetAnalyticsOverview();
  const { data: chartData, isLoading: chartLoading } = useGetOrdersByDay();

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Today's Overview</h1>
        <p className="text-muted-foreground mt-1 text-sm">Key metrics and recent activity for your pharmacy.</p>
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
          title="Revenue (30d)" 
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

      <div className="flex gap-4 mb-8">
        {analytics.pendingOrders > 0 && (
          <Link href="/orders" className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 hover:bg-primary/90 transition-colors shadow-sm">
            Review {analytics.pendingOrders} Pending Orders <ArrowRight className="w-4 h-4" />
          </Link>
        )}
        {analytics.pendingPrescriptions > 0 && (
          <Link href="/prescriptions" className="bg-destructive text-destructive-foreground px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 hover:bg-destructive/90 transition-colors shadow-sm">
            Review {analytics.pendingPrescriptions} Prescriptions <ArrowRight className="w-4 h-4" />
          </Link>
        )}
      </div>

      <div className="bg-card border border-card-border rounded-xl p-6 shadow-sm">
        <div className="mb-6">
          <h3 className="text-lg font-semibold">Order Volume & Revenue</h3>
          <p className="text-sm text-muted-foreground">Last 30 days</p>
        </div>
        <div className="h-[350px] w-full">
          {chartData && chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(val) => format(parseISO(val), 'MMM d')}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  dx={-10}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', borderRadius: '8px', padding: '12px' }}
                  labelFormatter={(val) => format(parseISO(val as string), 'MMM d, yyyy')}
                  formatter={(value: number, name: string) => [
                    name === 'revenueLeones' ? formatLeones(value) : value,
                    name === 'revenueLeones' ? 'Revenue' : 'Orders'
                  ]}
                />
                <Area 
                  type="monotone" 
                  dataKey="orders" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorOrders)" 
                  activeDot={{ r: 6, fill: "hsl(var(--primary))", stroke: "hsl(var(--background))", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              No data available for the last 30 days
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
  icon: any; 
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
