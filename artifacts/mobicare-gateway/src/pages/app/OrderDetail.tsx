import { Link, useParams } from 'wouter';
import { ArrowLeft, Check, Truck, Store, Phone, FileText, PackageCheck } from 'lucide-react';
import {
  usePatientGetOrder,
  useConfirmPatientOrderReceipt,
  getPatientGetOrderQueryKey,
  getPatientListOrdersQueryKey,
  type PatientOrder,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { formatLeones, formatDate, StatusBadge, EmptyState } from '@/pages/hq/shared';

const DELIVERY_STEPS: { key: string; label: string; hint: string }[] = [
  { key: 'paid', label: 'Payment recorded', hint: 'Orange Money payment received' },
  { key: 'confirmed', label: 'Pharmacy confirmed', hint: 'The pharmacist accepted your order' },
  { key: 'packaging', label: 'Being prepared', hint: 'Your medicines are being packed' },
  { key: 'ready', label: 'Ready for dispatch', hint: 'Waiting for a rider' },
  { key: 'assigned', label: 'Rider assigned', hint: 'A courier is on the way to the pharmacy' },
  { key: 'picked_up', label: 'Picked up', hint: 'Your order left the pharmacy' },
  { key: 'delivering', label: 'On the way', hint: 'The rider is heading to you' },
  { key: 'delivered', label: 'Delivered', hint: 'Enjoy — get well soon!' },
];

const COLLECTION_STEPS: { key: string; label: string; hint: string }[] = [
  { key: 'paid', label: 'Payment recorded', hint: 'Orange Money payment received' },
  { key: 'confirmed', label: 'Pharmacy confirmed', hint: 'The pharmacist accepted your order' },
  { key: 'packaging', label: 'Being prepared', hint: 'Your medicines are being packed' },
  { key: 'ready', label: 'Ready for collection', hint: 'Bring your ID to the pharmacy' },
  { key: 'collected', label: 'Collected', hint: 'Picked up in person' },
];

const STATUS_ORDER = [
  'awaiting_payment', 'paid', 'confirmed', 'packaging', 'ready',
  'assigned', 'picked_up', 'delivering', 'delivered', 'collected',
];

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: order, isLoading, error } = usePatientGetOrder(id!, {
    query: { refetchInterval: 10_000, queryKey: getPatientGetOrderQueryKey(id!) },
  });
  const confirmReceipt = useConfirmPatientOrderReceipt({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData(getPatientGetOrderQueryKey(id!), updated);
        queryClient.invalidateQueries({ queryKey: getPatientListOrdersQueryKey() });
        toast({
          title: 'Receipt confirmed',
          description: 'Your order is now marked as delivered.',
        });
      },
      onError: (err) => {
        toast({
          title: 'Could not confirm receipt',
          description: err instanceof Error ? err.message : 'Please refresh and try again.',
          variant: 'destructive',
        });
      },
    },
  });

  if (isLoading) return <EmptyState>Loading order…</EmptyState>;
  if (error || !order) return <EmptyState>Order not found.</EmptyState>;

  const o = order as PatientOrder & {
    pharmacy?: { name: string; address?: string | null; phone?: string | null } | null;
    courier?: { name: string; phone?: string | null } | null;
    prescription?: { status: string; rejectReason?: string | null } | null;
    deliveryAddress?: string | null;
  };

  const steps = o.fulfillmentType === 'delivery' ? DELIVERY_STEPS : COLLECTION_STEPS;
  const statusIdx = STATUS_ORDER.indexOf(o.status);
  const cancelled = o.status === 'cancelled';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/app/orders" className="p-2 -ml-2 rounded-full hover:bg-secondary" aria-label="Back">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="font-display font-bold text-xl text-dark-green truncate">
            Order · {formatLeones(o.totalLeones)}
          </h1>
          <p className="text-xs text-muted-foreground">Placed {formatDate(o.createdAt)}</p>
        </div>
        <div className="ml-auto"><StatusBadge status={o.status} /></div>
      </div>

      {/* Timeline */}
      <Card>
        <CardContent className="p-4">
          {cancelled ? (
            <p className="text-sm text-destructive">This order was cancelled.</p>
          ) : (
            <ol className="space-y-0">
              {steps.map((step, i) => {
                const stepIdx = STATUS_ORDER.indexOf(step.key);
                const done = statusIdx >= stepIdx;
                const current = o.status === step.key;
                const last = i === steps.length - 1;
                return (
                  <li key={step.key} className="flex gap-3" data-testid={`step-${step.key}`}>
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border-2 ${
                          done
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'bg-card border-muted text-transparent'
                        } ${current ? 'ring-4 ring-primary/20' : ''}`}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </div>
                      {!last && <div className={`w-0.5 flex-1 min-h-6 ${done ? 'bg-primary' : 'bg-muted'}`} />}
                    </div>
                    <div className={`pb-5 ${last ? 'pb-0' : ''}`}>
                      <div className={`text-sm font-medium ${done ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {step.label}
                      </div>
                      {(current || (done && last)) && (
                        <div className="text-xs text-muted-foreground mt-0.5">{step.hint}</div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      {o.fulfillmentType === 'delivery' && o.status === 'delivering' && (
        <Card className="border-primary/40 bg-primary/5" data-testid="card-confirm-receipt">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex gap-3 flex-1">
              <PackageCheck className="w-6 h-6 text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-dark-green">Have you received your order?</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Confirm only after the medicines are in your hands. This will mark the order as delivered.
                </p>
              </div>
            </div>
            <Button
              className="shrink-0"
              disabled={confirmReceipt.isPending}
              onClick={() => {
                if (window.confirm('Confirm that you have received this order? This cannot be undone.')) {
                  confirmReceipt.mutate({ id: o.id });
                }
              }}
              data-testid="button-confirm-receipt"
            >
              {confirmReceipt.isPending ? 'Confirming…' : 'Confirm Delivery'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Prescription status */}
      {o.prescription && (
        <Card>
          <CardContent className="p-4 flex items-start gap-3">
            <FileText className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div className="text-sm">
              <div className="font-medium mb-0.5">Prescription review</div>
              {o.prescription.status === 'pending' && (
                <p className="text-muted-foreground text-xs">A licensed pharmacist is reviewing your prescription.</p>
              )}
              {o.prescription.status === 'approved' && (
                <p className="text-green-700 text-xs">Approved — your medicines are cleared to dispense.</p>
              )}
              {o.prescription.status === 'rejected' && (
                <p className="text-destructive text-xs">
                  Rejected{o.prescription.rejectReason ? ` — ${String(o.prescription.rejectReason).replaceAll('_', ' ')}` : ''}.
                  The pharmacy will contact you.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fulfilment info */}
      <Card>
        <CardContent className="p-4 space-y-3 text-sm">
          <div className="flex items-start gap-3">
            {o.fulfillmentType === 'delivery' ? (
              <Truck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            ) : (
              <Store className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            )}
            <div>
              <div className="font-medium">
                {o.fulfillmentType === 'delivery' ? 'Delivery' : 'Collection'} · {o.pharmacy?.name ?? 'Pharmacy'}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {o.fulfillmentType === 'delivery'
                  ? (o.deliveryAddress ?? 'Delivery address on file')
                  : (o.pharmacy?.address ?? 'Collect at the pharmacy — bring your ID')}
              </div>
            </div>
          </div>
          {o.courier && (
            <div className="flex items-center gap-3 border-t pt-3">
              {o.courier.photoUrl ? (
                <img src={o.courier.photoUrl} alt="" className="h-9 w-9 rounded-full object-cover shrink-0" />
              ) : (
                <Phone className="w-4 h-4 text-primary shrink-0" />
              )}
              <div className="text-xs">
                Rider: <span className="font-medium">{o.courier.name}</span>
                {o.courier.phone ? ` · ${o.courier.phone}` : ''}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Items */}
      <Card>
        <CardContent className="p-0 divide-y">
          {o.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between p-4 text-sm">
              <div>
                <div className="font-medium">{item.drugName}</div>
                <div className="text-xs text-muted-foreground">
                  {item.quantity} × {formatLeones(item.unitPriceLeones)}
                </div>
              </div>
              <div className="font-display font-semibold text-dark-green">
                {formatLeones(item.quantity * item.unitPriceLeones)}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between p-4">
            <span className="font-medium">Total paid</span>
            <span className="font-display font-bold text-lg text-dark-green">{formatLeones(o.totalLeones)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
