import { Link } from 'wouter';
import { ChevronRight, Truck, Store } from 'lucide-react';
import { usePatientListOrders, getPatientListOrdersQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { formatLeones, formatDate, StatusBadge, EmptyState } from '@/pages/hq/shared';

export default function PatientOrders() {
  const { data: orders, isLoading } = usePatientListOrders({
    query: { refetchInterval: 15_000, queryKey: getPatientListOrdersQueryKey() },
  });

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
          <Link key={order.id} href={`/app/orders/${order.id}`}>
            <Card className="hover:border-primary/50 transition-colors cursor-pointer mb-3" data-testid={`card-order-${order.id}`}>
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
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
