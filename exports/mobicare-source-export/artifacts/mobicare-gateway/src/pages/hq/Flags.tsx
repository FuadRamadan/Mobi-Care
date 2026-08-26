import { useState } from 'react';
import {
  useListFlags,
  useReviewFlag,
  getListFlagsQueryKey,
  getGetHqDashboardQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import HqLayout from './HqLayout';
import { EmptyState, StatusBadge, formatDate, formatLeones } from './shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';

const TYPE_LABEL: Record<string, string> = {
  velocity: 'Order velocity',
  duplicate: 'Possible duplicate',
  payment_anomaly: 'Payment anomaly',
};

export default function HqFlags() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<'open' | 'reviewed'>('open');
  const { data, isLoading } = useListFlags({ status: tab });
  const flags = data ?? [];

  const [notes, setNotes] = useState<Record<string, string>>({});

  const review = useReviewFlag({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFlagsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetHqDashboardQueryKey() });
      },
      onError: (err) =>
        toast({ title: 'Review failed', description: err instanceof Error ? err.message : 'Please try again', variant: 'destructive' }),
    },
  });

  return (
    <HqLayout title="Flags Queue">
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'open' | 'reviewed')} className="mb-4">
        <TabsList>
          <TabsTrigger value="open" data-testid="tab-open-flags">Open</TabsTrigger>
          <TabsTrigger value="reviewed" data-testid="tab-reviewed-flags">Reviewed</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : flags.length === 0 ? (
        <EmptyState>{tab === 'open' ? 'No open flags — all clear.' : 'No reviewed flags yet.'}</EmptyState>
      ) : (
        <div className="grid gap-3">
          {flags.map((f) => (
            <Card key={f.id} data-testid={`card-flag-${f.id}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="bg-red-100 text-red-800">
                      {TYPE_LABEL[f.type] ?? f.type}
                    </Badge>
                    <StatusBadge status={f.status} />
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDate(f.createdAt)}</span>
                </div>
                <p className="text-sm">{f.reason}</p>
                <div className="text-xs text-muted-foreground">
                  Order: {f.patientName ?? '—'} ({f.patientPhone ?? '—'}) · {f.pharmacyName ?? '—'} ·{' '}
                  {formatLeones(f.orderTotalLeones)} · status: {f.orderStatus ?? '—'}
                </div>

                {f.status === 'open' ? (
                  <div className="flex gap-2 items-start">
                    <Textarea
                      placeholder="Review note (required)"
                      rows={1}
                      value={notes[f.id] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [f.id]: e.target.value }))}
                      data-testid={`input-review-note-${f.id}`}
                    />
                    <Button
                      size="sm"
                      disabled={!notes[f.id]?.trim() || review.isPending}
                      onClick={() => review.mutate({ id: f.id, data: { note: notes[f.id]!.trim() } })}
                      data-testid={`button-review-${f.id}`}
                    >
                      Mark reviewed
                    </Button>
                  </div>
                ) : (
                  f.reviewNote && (
                    <div className="text-sm bg-muted rounded-lg px-3 py-2">
                      <span className="text-muted-foreground">Note:</span> {f.reviewNote}
                    </div>
                  )
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </HqLayout>
  );
}
