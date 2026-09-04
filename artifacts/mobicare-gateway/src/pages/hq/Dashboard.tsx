import { getGetHqDashboardQueryKey, useGetHqDashboard, useConfirmDeliveryByHq, useGetHqInsights, getGetHqInsightsQueryKey, useListHqPharmacies } from '@workspace/api-client-react';
import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
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
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

export default function HqDashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const [start, setStart] = useState(weekAgo);
  const [end, setEnd] = useState(today);
  const [pharmacyId, setPharmacyId] = useState<string>('all');
  const { data: pharmacies } = useListHqPharmacies();

  const params = { start, end, interval: 'day' as const, ...(pharmacyId !== 'all' ? { pharmacyId } : {}) };
  const { data: insights } = useGetHqInsights(params, { query: { enabled: true, queryKey: getGetHqInsightsQueryKey(params) } });

  const zeroFill = (data: Array<{period: string; count?: number; revenue?: number}> | undefined, startStr: string, endStr: string) => {
    if (!data) return [];
    const map = new Map(data.map(d => [d.period, d]));
    const result = [];
    let curr = new Date(startStr);
    const endDt = new Date(endStr);
    while (curr <= endDt) {
      const p = curr.toISOString().slice(0, 10);
      result.push(map.get(p) || { period: p, count: 0, revenue: 0 });
      curr.setDate(curr.getDate() + 1);
    }
    return result;
  };

  const queryClient = useQueryClient();
  const { toast } = useToast();
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

  return (
    <HqLayout title="Command Centre">
      {isLoading && <div className="text-muted-foreground text-sm">Loading…</div>}
      {t && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Orders (all time)" value={t.orders} hint={`${t.ordersToday} today`} icon={<Package />} />
            <StatCard label="Searches (range)" value={insights?.totals?.totalSearches ?? 0} hint="Selected period" icon={<Package />} />
            <StatCard label="Commission today" value={formatLeones((insights?.totals?.commissionToday as number) ?? 0)} hint="Earned today" icon={<Banknote />} />
            <StatCard label="Pharmacies" value={t.activePharmacies} hint={`${t.pharmacies} total`} icon={<Building2 />} />
            <StatCard label="Couriers" value={t.activeCouriers} hint={`${t.couriers} total`} icon={<Bike />} />
            <StatCard label="Awaiting dispatch" value={t.awaitingDispatch} icon={<Truck />} />
            <StatCard label="Open flags" value={t.openFlags} icon={<Flag />} />
            <StatCard label="Held drugs" value={t.heldDrugs} icon={<PauseCircle />} />
          </div>

          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Trends</h2>
            <div className="flex gap-2">
              <Select value={pharmacyId} onValueChange={setPharmacyId}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All pharmacies" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All pharmacies</SelectItem>
                  {pharmacies?.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-auto" />
                <span className="text-muted-foreground">-</span>
                <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-auto" />
              </div>
              <Select value={
                (start === new Date(Date.now() - 6 * 86400000).toISOString().slice(0,10) && end === today) ? '7' :
                (start === new Date(Date.now() - 29 * 86400000).toISOString().slice(0,10) && end === today) ? '30' :
                (start === new Date(Date.now() - 89 * 86400000).toISOString().slice(0,10) && end === today) ? '90' :
                'custom'
              } onValueChange={(v) => {
                const now = new Date();
                const toStr = (d: Date) => d.toISOString().slice(0, 10);
                if (v === '7') { setStart(toStr(new Date(now.getTime() - 6 * 86400000))); setEnd(toStr(now)); }
                else if (v === '30') { setStart(toStr(new Date(now.getTime() - 29 * 86400000))); setEnd(toStr(now)); }
                else if (v === '90') { setStart(toStr(new Date(now.getTime() - 89 * 86400000))); setEnd(toStr(now)); }
              }}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Custom" />
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
          <div className="grid md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Searches</CardTitle></CardHeader>
              <CardContent className="h-48 flex items-end gap-1 px-4">
                {zeroFill(insights?.trends?.searches as unknown as {period: string; count?: number; revenue?: number}[], start, end).map((t, i) => (
                  <div key={i} className="flex-1 bg-primary/20 hover:bg-primary transition-colors rounded-t" style={{ height: `${Math.max(4, ((t.count || 0) / Math.max(1, ...zeroFill(insights?.trends?.searches as unknown as {period: string; count?: number; revenue?: number}[], start, end).map((x) => x.count || 0))) * 100)}%` }} title={`${t.period}: ${t.count}`} />
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Orders</CardTitle></CardHeader>
              <CardContent className="h-48 flex items-end gap-1 px-4">
                {zeroFill(insights?.trends?.orders as unknown as {period: string; count?: number; revenue?: number}[], start, end).map((t, i) => (
                  <div key={i} className="flex-1 bg-primary/40 hover:bg-primary transition-colors rounded-t" style={{ height: `${Math.max(4, ((t.count || 0) / Math.max(1, ...zeroFill(insights?.trends?.orders as unknown as {period: string; count?: number; revenue?: number}[], start, end).map((x) => x.count || 0))) * 100)}%` }} title={`${t.period}: ${t.count}`} />
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Commission</CardTitle></CardHeader>
              <CardContent className="h-48 flex items-end gap-1 px-4">
                {zeroFill(insights?.trends?.commission as unknown as {period: string; count?: number; revenue?: number}[], start, end).map((t, i) => (
                  <div key={i} className="flex-1 bg-green-500/40 hover:bg-green-500 transition-colors rounded-t" style={{ height: `${Math.max(4, (Number(t.revenue ?? 0) / Math.max(1, ...zeroFill(insights?.trends?.commission as unknown as {period: string; count?: number; revenue?: number}[], start, end).map((x) => Number(x.revenue ?? 0)))) * 100)}%` }} title={`${t.period}: ${formatLeones(Number(t.revenue ?? 0))}`} />
                ))}
              </CardContent>
            </Card>
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
        </>
      )}
    </HqLayout>
  );
}
