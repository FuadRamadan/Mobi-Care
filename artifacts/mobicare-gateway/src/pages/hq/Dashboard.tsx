import { getGetHqDashboardQueryKey, useGetHqDashboard, useConfirmDeliveryByHq } from '@workspace/api-client-react';
import {
  Package,
  Building2,
  Bike,
  Flag,
  Wallet,
  Truck,
  PauseCircle,
} from 'lucide-react';
import HqLayout from './HqLayout';
import { StatCard, StatusBadge, formatLeones, formatDate, EmptyState } from './shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { useEffect, useState } from 'react';
import { HQ_ACCESS_KEY } from '@/lib/portalToken';

type TrendData = {
  searches: Array<{ date: string; count: number }>;
  orders: Array<{ date: string; count: number }>;
  pharmacies: Array<{ id: string; name: string }>;
  searchScope: 'all';
};

export default function HqDashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState<'7' | '30' | '90' | 'custom'>('30');
  const [start, setStart] = useState(new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10));
  const [end, setEnd] = useState(today);
  const [pharmacyId, setPharmacyId] = useState('');
  const [trends, setTrends] = useState<TrendData | null>(null);
  const [trendLoading, setTrendLoading] = useState(true);
  const { data: d, isLoading } = useGetHqDashboard({
    query: { queryKey: getGetHqDashboardQueryKey(), refetchInterval: 10_000 },
  });
  const t = d?.totals;
  const confirmDelivery = useConfirmDeliveryByHq({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetHqDashboardQueryKey() });
        toast({ title: 'Order marked as delivered' });
      },
      onError: (error) => {
        toast({
          title: 'Could not mark order as delivered',
          description: error instanceof Error ? error.message : 'Please refresh and try again.',
          variant: 'destructive',
        });
      },
    },
  });
  const markDelivered = (orderId: string) => {
    if (!window.confirm('Mark this order as delivered? Use this only when the patient has received the order but cannot confirm delivery.')) return;
    confirmDelivery.mutate({ id: orderId });
  };
  useEffect(() => {
    const controller = new AbortController();
    setTrendLoading(true);
    const params = new URLSearchParams({ start, end });
    if (pharmacyId) params.set('pharmacyId', pharmacyId);
    fetch(`${import.meta.env.BASE_URL}api/hq/dashboard/trends?${params}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem(HQ_ACCESS_KEY)}` },
      signal: controller.signal,
    })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Unable to load trends.')))
      .then((result: TrendData) => setTrends(result))
      .catch(error => { if (error.name !== 'AbortError') setTrends(null); })
      .finally(() => { if (!controller.signal.aborted) setTrendLoading(false); });
    return () => controller.abort();
  }, [start, end, pharmacyId]);
  const selectRange = (value: '7' | '30' | '90' | 'custom') => {
    setRange(value);
    if (value !== 'custom') {
      setStart(new Date(Date.now() - (Number(value) - 1) * 86400_000).toISOString().slice(0, 10));
      setEnd(today);
    }
  };

  return (
    <HqLayout title="Command Centre">
      {isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}
      {t && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Orders (all time)" value={t.orders} hint={`${t.ordersToday} today`} icon={<Package />} />
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
                      {o.status === 'delivering' && o.fulfillmentType === 'delivery' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={confirmDelivery.isPending}
                          onClick={() => markDelivered(o.id)}
                          data-testid={`button-mark-delivered-dashboard-${o.id}`}
                        >
                          Mark as Delivered
                        </Button>
                      )}
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
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">Search and order trends</CardTitle>
              <div className="flex flex-wrap items-end gap-2">
                {(['7', '30', '90'] as const).map(days => <Button key={days} size="sm" variant={range === days ? 'default' : 'outline'} onClick={() => selectRange(days)}>Last {days} days</Button>)}
                <Button size="sm" variant={range === 'custom' ? 'default' : 'outline'} onClick={() => selectRange('custom')}>Custom</Button>
                {range === 'custom' && <>
                  <input className="rounded border bg-background px-2 py-1 text-sm" type="date" value={start} max={end} onChange={event => setStart(event.target.value)} />
                  <input className="rounded border bg-background px-2 py-1 text-sm" type="date" value={end} min={start} max={today} onChange={event => setEnd(event.target.value)} />
                </>}
                <select className="rounded border bg-background px-2 py-1 text-sm" value={pharmacyId} onChange={event => setPharmacyId(event.target.value)}>
                  <option value="">All pharmacies</option>
                  {(trends?.pharmacies ?? []).map(pharmacy => <option key={pharmacy.id} value={pharmacy.id}>{pharmacy.name}</option>)}
                </select>
              </div>
            </CardHeader>
            <CardContent>
              {trendLoading ? <p className="text-sm text-muted-foreground">Loading trends…</p> : trends ? <TrendChart searches={trends.searches} orders={trends.orders} /> : <EmptyState>No trend data available.</EmptyState>}
              {pharmacyId && <p className="mt-3 text-xs text-muted-foreground">Order data is filtered to the selected pharmacy. Search events are anonymous and are shown platform-wide.</p>}
            </CardContent>
          </Card>
        </>
      )}
    </HqLayout>
  );
}

function TrendChart({ searches, orders }: Pick<TrendData, 'searches' | 'orders'>) {
  const values = new Map<string, { searches: number; orders: number }>();
  for (const row of searches) values.set(row.date, { ...(values.get(row.date) ?? { searches: 0, orders: 0 }), searches: Number(row.count) });
  for (const row of orders) values.set(row.date, { ...(values.get(row.date) ?? { searches: 0, orders: 0 }), orders: Number(row.count) });
  const rows = [...values.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (!rows.length) return <EmptyState>No orders or searches in this period.</EmptyState>;
  const max = Math.max(...rows.flatMap(([, value]) => [value.searches, value.orders]), 1);
  return <div className="max-h-80 space-y-2 overflow-y-auto pr-2">
    <div className="flex gap-4 text-xs"><span className="text-primary">■ Searches</span><span className="text-emerald-600">■ Orders</span></div>
    {rows.map(([date, value]) => <div key={date} className="grid grid-cols-[5.5rem_1fr_3rem_1fr_3rem] items-center gap-2 text-xs">
      <span>{date}</span><div className="h-2 rounded bg-muted"><div className="h-full rounded bg-primary" style={{ width: `${value.searches / max * 100}%` }} /></div><strong>{value.searches}</strong>
      <div className="h-2 rounded bg-muted"><div className="h-full rounded bg-emerald-600" style={{ width: `${value.orders / max * 100}%` }} /></div><strong>{value.orders}</strong>
    </div>)}
  </div>;
}
