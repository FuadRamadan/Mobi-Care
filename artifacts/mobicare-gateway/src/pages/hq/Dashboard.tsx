import { getGetHqDashboardQueryKey, useGetHqDashboard } from '@workspace/api-client-react';
import {
  Package,
  Building2,
  Bike,
  Flag,
  Wallet,
  Truck,
  Banknote,
  PauseCircle,
} from 'lucide-react';
import HqLayout from './HqLayout';
import { StatCard, StatusBadge, formatLeones, formatDate, EmptyState } from './shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function HqDashboard() {
  const { data: d, isLoading } = useGetHqDashboard({
    query: { queryKey: getGetHqDashboardQueryKey(), refetchInterval: 10_000 },
  });
  const t = d?.totals;

  return (
    <HqLayout title="Command Centre">
      {isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}
      {t && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Orders (all time)" value={t.orders} hint={`${t.ordersToday} today`} icon={<Package />} />
            <StatCard label="Completed revenue" value={formatLeones(t.completedRevenueLeones)} hint="Delivered or collected orders" icon={<Banknote />} />
            <StatCard label="Pharmacies" value={t.activePharmacies} hint={`${t.pharmacies} total`} icon={<Building2 />} />
            <StatCard label="Couriers" value={t.activeCouriers} hint={`${t.couriers} total`} icon={<Bike />} />
            <StatCard label="Awaiting dispatch" value={t.awaitingDispatch} icon={<Truck />} />
            <StatCard label="Open flags" value={t.openFlags} icon={<Flag />} />
            <StatCard label="Held drugs" value={t.heldDrugs} icon={<PauseCircle />} />
            <StatCard label="Pending settlements" value={t.pendingSettlements} icon={<Wallet />} />
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Live order feed</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(d.recentOrders ?? []).length === 0 && (
                  <EmptyState>No orders yet.</EmptyState>
                )}
                {(d.recentOrders ?? []).map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2 text-sm"
                    data-testid={`row-recent-order-${o.id}`}
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{o.patientName}</span>
                      <span className="text-muted-foreground"> · {o.pharmacyName ?? 'Unknown pharmacy'}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-muted-foreground">{formatLeones(o.totalLeones)}</span>
                      <StatusBadge status={o.status} />
                      <span className="text-xs text-muted-foreground hidden sm:inline">{formatDate(o.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Orders by status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(d.ordersByStatus ?? []).length === 0 && (
                  <div className="text-sm text-muted-foreground">No data yet.</div>
                )}
                {(d.ordersByStatus ?? []).map((s) => (
                  <div key={s.status} className="flex items-center justify-between text-sm">
                    <StatusBadge status={s.status} />
                    <span className="font-medium">{s.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </HqLayout>
  );
}
