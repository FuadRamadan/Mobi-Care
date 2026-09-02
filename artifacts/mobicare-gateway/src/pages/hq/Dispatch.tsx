import { useState } from 'react';
import {
  useListDispatchOrders,
  useListCouriers,
  useAssignCourier,
  useUpdateCourierStatus,
  useMarkCashCollected,
  getListDispatchOrdersQueryKey,
  getGetHqDashboardQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import HqLayout from './HqLayout';
import { StatusBadge, formatLeones, formatDate, EmptyState } from './shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

export default function HqDispatch() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListDispatchOrders({
    query: {
      queryKey: getListDispatchOrdersQueryKey(),
      refetchInterval: 10_000,
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

  return (
    <HqLayout title="Dispatch">
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : orders.length === 0 ? (
        <EmptyState>No delivery orders in the dispatch pipeline.</EmptyState>
      ) : (
        <div className="grid gap-3">
          {orders.map((o) => (
            <Card key={o.id} data-testid={`card-dispatch-${o.id}`}>
              <CardContent className="p-4 flex flex-wrap items-center gap-4 justify-between">
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

                  {(o.status === 'assigned' || o.status === 'picked_up') && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={advance.isPending}
                      onClick={() => advance.mutate({ id: o.id, data: { status: 'delivering' } })}
                      data-testid={`button-delivering-${o.id}`}
                    >
                      Mark delivering
                    </Button>
                  )}

                  {o.status === 'delivering' && (
                    <span
                      className="text-xs text-muted-foreground max-w-48"
                      data-testid={`text-awaiting-customer-${o.id}`}
                    >
                      Awaiting customer receipt confirmation
                    </span>
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </HqLayout>
  );
}
