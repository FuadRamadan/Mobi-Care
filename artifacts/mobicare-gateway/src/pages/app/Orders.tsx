import { Link, useLocation } from 'wouter';
import { ChevronRight, Truck, Store, X } from 'lucide-react';
import { usePatientListOrders, getPatientListOrdersQueryKey, useRemovePatientOrderFromHistory } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatLeones, formatDate, StatusBadge, EmptyState } from '@/pages/hq/shared';
import { useToast } from '@/hooks/use-toast';

const REMOVABLE_STATUSES = new Set(['delivered', 'collected', 'cancelled']);

export default function PatientOrders() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: orders, isLoading } = usePatientListOrders({
    query: { refetchInterval: 5_000, queryKey: getPatientListOrdersQueryKey() },
  });
  const removeFromHistory = useRemovePatientOrderFromHistory();
  const removeOrder = async (id: string) => {
    if (!window.confirm('Remove this completed order from your history? The order record will remain in MobiCare.')) return;
    try {
      await removeFromHistory.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getPatientListOrdersQueryKey() });
      toast({ title: 'Order removed from your history' });
    } catch (error) {
      toast({
        title: 'Could not remove order',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display font-bold text-2xl text-dark-green mb-1">Your orders</h1>
        <p className="text-sm text-muted-foreground">Track every order from payment to your hands.</p>
      </div>

      {isLoading && <EmptyState>Loading your orders…</EmptyState>}
      {orders && orders.length === 0 && (
        <EmptyState>
          No orders yet.{' '}
          <Link href="/app/search" className="text-primary font-medium">Search medicines</Link>{' '}
          to place your first one.
        </EmptyState>
      )}

      <div className="space-y-3">
        {orders?.map((order) => (
            <Card
              key={order.id}
              className="hover:border-primary/50 transition-colors cursor-pointer mb-3"
              data-testid={`card-order-${order.id}`}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/app/orders/${order.id}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') navigate(`/app/orders/${order.id}`);
              }}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  {order.fulfillmentType === 'delivery' ? <Truck className="w-4 h-4" /> : <Store className="w-4 h-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">
                      {order.items.map((i) => i.drugName).join(', ')}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {(order as any).pharmacy?.name ?? 'Pharmacy'} · {formatDate(order.createdAt)}
                  </div>
                </div>
                <div className="text-right shrink-0 flex flex-col items-end gap-1">
                  <StatusBadge status={order.status} />
                  <span className="text-sm font-display font-semibold text-dark-green">
                    {formatLeones(order.totalLeones)}
                  </span>
                </div>
                {REMOVABLE_STATUSES.has(order.status) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="Remove order from history"
                    disabled={removeFromHistory.isPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      void removeOrder(order.id);
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
        ))}
      </div>
    </div>
  );
}
