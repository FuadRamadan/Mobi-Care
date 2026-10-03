import { useState } from 'react';
import { Copy, MapPin, Phone, Store } from 'lucide-react';
import {
  useListDispatchOrders,
  useListCouriers,
  useAssignCourier,
  useUpdateCourierStatus,
  useMarkCashCollected,
  useConfirmDeliveryByHq,
  getListDispatchOrdersQueryKey,
  getGetHqDashboardQueryKey,
  type HqOrder,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import HqLayout from './HqLayout';
import { StatusBadge, formatLeones, formatDate, EmptyState } from './shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

/** Google Maps link to the patient's delivery pin, when they dropped one. */
function mapLink(o: HqOrder): string | null {
  const lat = Number(o.deliveryLatitude);
  const lng = Number(o.deliveryLongitude);
  if (o.deliveryLatitude == null || o.deliveryLongitude == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** Everything the courier needs, as one message HQ can paste into WhatsApp or SMS. */
function courierBriefing(o: HqOrder): string {
  const map = mapLink(o);
  return [
    `MobiCare delivery for ${o.patientName}`,
    `Collect from: ${[o.pharmacyName, o.pharmacyAddress].filter(Boolean).join(', ') || '—'}${o.pharmacyPhone ? ` (${o.pharmacyPhone})` : ''}`,
    `Deliver to: ${o.deliveryAddress?.trim() || 'no directions given'}${o.deliveryZoneName ? ` — ${o.deliveryZoneName}` : ''}`,
    `Patient phone: ${o.patientPhone}`,
    map ? `Map: ${map}` : null,
  ].filter(Boolean).join('\n');
}

function DeliveryDetails({ order: o, onCopy }: { order: HqOrder; onCopy: () => void }) {
  const map = mapLink(o);
  return (
    <div className="grid gap-3 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-2" data-testid={`delivery-details-${o.id}`}>
      <div className="space-y-1 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deliver to</p>
        <p className="flex items-start gap-1.5">
          <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
          <span className="break-words">
            {o.deliveryAddress?.trim() || <span className="text-muted-foreground">No directions given</span>}
            {o.deliveryZoneName && <span className="text-muted-foreground"> · {o.deliveryZoneName}</span>}
          </span>
        </p>
        <p className="flex items-center gap-1.5">
          <Phone className="w-4 h-4 shrink-0 text-primary" />
          <a href={`tel:${o.patientPhone}`} className="font-medium hover:underline" data-testid={`link-patient-phone-${o.id}`}>{o.patientPhone}</a>
        </p>
        {map && (
          <a href={map} target="_blank" rel="noreferrer" className="inline-block text-primary font-medium hover:underline" data-testid={`link-map-${o.id}`}>
            Open the patient's pin in Google Maps
          </a>
        )}
      </div>
      <div className="space-y-1 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Collect from</p>
        <p className="flex items-start gap-1.5">
          <Store className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
          <span className="break-words">
            {o.pharmacyName ?? '—'}
            {o.pharmacyAddress && <span className="text-muted-foreground"> · {o.pharmacyAddress}</span>}
          </span>
        </p>
        {o.pharmacyPhone && (
          <p className="flex items-center gap-1.5">
            <Phone className="w-4 h-4 shrink-0 text-primary" />
            <a href={`tel:${o.pharmacyPhone}`} className="hover:underline">{o.pharmacyPhone}</a>
          </p>
        )}
        <Button size="sm" variant="outline" className="mt-1" onClick={onCopy} data-testid={`button-copy-briefing-${o.id}`}>
          <Copy className="w-3.5 h-3.5 mr-1.5" />
          Copy details for courier
        </Button>
      </div>
    </div>
  );
}

export default function HqDispatch() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListDispatchOrders({
    query: {
      queryKey: getListDispatchOrdersQueryKey(),
      refetchInterval: 5_000,
    },
  });
  const { data: couriersData } = useListCouriers();
  const orders = data ?? [];
  const couriers = (couriersData ?? []).filter((c) => c.isActive);

  const [selection, setSelection] = useState<Record<string, string>>({});

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListDispatchOrdersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetHqDashboardQueryKey() });
  };
  const onError = (err: unknown) =>
    toast({
      title: 'Action failed',
      description: err instanceof Error ? err.message : 'Please try again',
      variant: 'destructive',
    });

  const assign = useAssignCourier({ mutation: { onSuccess: refresh, onError } });
  const advance = useUpdateCourierStatus({ mutation: { onSuccess: refresh, onError } });
  const cash = useMarkCashCollected({ mutation: { onSuccess: refresh, onError } });
  const confirmDelivery = useConfirmDeliveryByHq({ mutation: { onSuccess: refresh, onError } });
  const markDelivered = (orderId: string) => {
    if (!window.confirm('Mark this order as delivered? Use this only when the patient has received the order but cannot confirm delivery.')) return;
    confirmDelivery.mutate({ id: orderId });
  };
  const copyBriefing = async (o: HqOrder) => {
    try {
      await navigator.clipboard.writeText(courierBriefing(o));
      toast({ title: 'Copied', description: 'Paste it into WhatsApp or SMS for the courier.' });
    } catch {
      toast({ title: 'Could not copy', description: 'Select the details and copy them by hand.', variant: 'destructive' });
    }
  };
  return (
    <HqLayout title="Dispatch">
      <p className="text-sm text-muted-foreground mb-4">
        Assign an active courier as soon as a pharmacy marks a delivery order as packaged.
      </p>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : orders.length === 0 ? (
        <EmptyState>No delivery orders in the dispatch pipeline.</EmptyState>
      ) : (
        <div className="grid gap-3">
          {orders.map((o) => (
            <Card key={o.id} data-testid={`card-dispatch-${o.id}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-4 justify-between">
                <div className="min-w-0">
                  <div className="font-medium">
                    {o.patientName}
                    <span className="text-muted-foreground font-normal"> · {o.pharmacyName ?? '—'}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {formatLeones(o.totalLeones)} · {o.paymentMethod.replaceAll('_', ' ')} · {formatDate(o.createdAt)}
                    {o.courier && <> · Courier: <span className="font-medium">{o.courier.name}</span></>}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={o.status} />

                  {o.status === 'ready' && (
                    <>
                      <div className="w-44">
                        <Select
                          value={selection[o.id] ?? ''}
                          onValueChange={(v) => setSelection((s) => ({ ...s, [o.id]: v }))}
                        >
                          <SelectTrigger data-testid={`select-courier-${o.id}`}>
                            <SelectValue placeholder="Choose courier" />
                          </SelectTrigger>
                          <SelectContent>
                            {couriers.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name} ({c.activeDeliveries ?? 0} active)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        size="sm"
                        disabled={!selection[o.id] || assign.isPending}
                        onClick={() => assign.mutate({ id: o.id, data: { courierId: selection[o.id]! } })}
                        data-testid={`button-assign-${o.id}`}
                      >
                        Assign
                      </Button>
                    </>
                  )}

                   {o.status === 'assigned' && (
                     <span
                       className="text-xs text-muted-foreground max-w-56"
                       data-testid={`text-awaiting-pharmacy-collection-${o.id}`}
                     >
                       Waiting for the pharmacy to mark this order as collected
                     </span>
                   )}

                   {o.status === 'picked_up' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={advance.isPending}
                      onClick={() => advance.mutate({ id: o.id, data: { status: 'delivering' } })}
                      data-testid={`button-delivering-${o.id}`}
                    >
                       Mark as Delivering
                    </Button>
                  )}

                  {o.status === 'delivering' && (
                     <>
                       <span
                         className="text-xs text-muted-foreground max-w-48"
                         data-testid={`text-awaiting-customer-${o.id}`}
                       >
                         Awaiting patient delivery confirmation
                       </span>
                       <Button
                         size="sm"
                         variant="outline"
                         disabled={confirmDelivery.isPending}
                         onClick={() => markDelivered(o.id)}
                         data-testid={`button-mark-delivered-hq-${o.id}`}
                       >
                         Mark as Delivered
                       </Button>
                     </>
                  )}

                  {o.status === 'delivered' && !o.cashCollected && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={cash.isPending}
                      onClick={() => cash.mutate({ id: o.id })}
                      data-testid={`button-cash-${o.id}`}
                    >
                      Cash collected
                    </Button>
                  )}
                </div>
                </div>
                <DeliveryDetails order={o} onCopy={() => void copyBriefing(o)} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </HqLayout>
  );
}
