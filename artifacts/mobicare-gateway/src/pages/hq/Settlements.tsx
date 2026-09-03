import { useState } from 'react';
import {
  useListSettlements,
  useGenerateSettlements,
  useMarkSettlementPaid,
  getListSettlementsQueryKey,
  getGetHqDashboardQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import HqLayout from './HqLayout';
import { EmptyState, StatusBadge, formatLeones, formatDate } from './shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

type Kind = 'pharmacy' | 'courier';

export default function HqSettlements() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const [period, setPeriod] = useState({ start: weekAgo, end: today });
  const { data, isLoading } = useListSettlements({
    start: period.start,
    end: period.end,
  });
  const settlements = data;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListSettlementsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetHqDashboardQueryKey() });
  };
  const onError = (err: unknown) =>
    toast({ title: 'Action failed', description: err instanceof Error ? err.message : 'Please try again', variant: 'destructive' });

  const generate = useGenerateSettlements({
    mutation: {
      onSuccess: (res) => {
        toast({ title: 'Settlements generated', description: res.message });
        refresh();
      },
      onError,
    },
  });
  const markPaid = useMarkSettlementPaid({ mutation: { onSuccess: refresh, onError } });

  const renderTable = (rows: NonNullable<typeof settlements>['pharmacy'], kind: Kind) =>
    rows.length === 0 ? (
      <EmptyState>No {kind} settlements yet.</EmptyState>
    ) : (
      <div className="border rounded-xl bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{kind === 'pharmacy' ? 'Pharmacy' : 'Courier'}</TableHead>
              <TableHead>Period</TableHead>
              <TableHead>{kind === 'pharmacy' ? 'Orders' : 'Deliveries'}</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.id} data-testid={`row-settlement-${s.id}`}>
                <TableCell className="font-medium">
                  {kind === 'pharmacy' ? s.pharmacyName ?? '—' : s.courierName ?? '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDate(s.periodStart)} → {formatDate(s.periodEnd)}
                </TableCell>
                <TableCell>{kind === 'pharmacy' ? s.orderCount ?? 0 : s.deliveryCount ?? 0}</TableCell>
                <TableCell>{formatLeones((s.amountMinor ?? s.amountLeones * 100) / 100)}</TableCell>
                <TableCell>
                  <StatusBadge status={s.status} />
                  {s.paidAt && <div className="text-[11px] text-muted-foreground mt-0.5">{formatDate(s.paidAt)}</div>}
                </TableCell>
                <TableCell className="text-right">
                  {s.status === 'pending' && (
                    <Button
                      size="sm"
                      disabled={markPaid.isPending}
                      onClick={() => markPaid.mutate({ id: s.id, data: { kind } })}
                      data-testid={`button-mark-paid-${s.id}`}
                    >
                      Mark paid
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );

  return (
    <HqLayout title="Settlements">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Generate settlements for a period</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>Period start</Label>
            <Input type="date" value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })} data-testid="input-period-start" />
          </div>
          <div className="space-y-1.5">
            <Label>Period end (inclusive)</Label>
            <Input type="date" value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })} data-testid="input-period-end" />
          </div>
          <Button
            disabled={generate.isPending}
            onClick={() =>
              generate.mutate({
                data: {
                  periodStart: period.start,
                  periodEnd: period.end,
                },
              })
            }
            data-testid="button-generate-settlements"
          >
            {generate.isPending ? 'Generating…' : 'Generate'}
          </Button>
          <p className="text-xs text-muted-foreground w-full">
            Aggregates completed orders into immutable pharmacy earnings and courier payouts. The selected end day is included.
          </p>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : settlements ? (
        <div className="space-y-8">
          <section>
            <h2 className="font-display font-semibold text-lg text-dark-green mb-3">Financial overview</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Total patient-paid revenue</p><p className="text-xl font-semibold">{formatLeones((settlements.metrics as typeof settlements.metrics & { patientPaidLeones: number }).patientPaidLeones)}</p><p className="text-xs text-muted-foreground">Completed orders in selected period</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Service-fee income</p><p className="text-xl font-semibold">{formatLeones(settlements.metrics.commissionIncomeMinor / 100)}</p><p className="text-xs text-muted-foreground">5% medicine service fee {formatLeones(settlements.metrics.medicineCommissionMinor / 100)}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Owed pharmacies</p><p className="text-xl font-semibold">{formatLeones(settlements.metrics.owedPharmacyMinor / 100)}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Owed couriers</p><p className="text-xl font-semibold">{formatLeones(settlements.metrics.owedCourierMinor / 100)}</p></CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Completed deliveries</p><p className="text-xl font-semibold">{settlements.metrics.completedDeliveries}</p></CardContent></Card>
            </div>
          </section>
          <section>
            <h2 className="font-display font-semibold text-lg text-dark-green mb-3">Pharmacy breakdown</h2>
            <div className="border rounded-xl bg-card overflow-x-auto">
              <Table><TableHeader><TableRow><TableHead>Pharmacy</TableHead><TableHead>Orders</TableHead><TableHead>Earnings</TableHead><TableHead>Service fee</TableHead></TableRow></TableHeader>
                <TableBody>{settlements.pharmacyBreakdown.map((row) => <TableRow key={row.pharmacyId}><TableCell>{row.pharmacyName ?? '—'}</TableCell><TableCell>{row.orderCount}</TableCell><TableCell>{formatLeones(row.pharmacyEarningsMinor / 100)}</TableCell><TableCell>{formatLeones(row.medicineCommissionMinor / 100)}</TableCell></TableRow>)}</TableBody>
              </Table>
            </div>
          </section>
          <section>
            <h2 className="font-display font-semibold text-lg text-dark-green mb-3">Pharmacy payouts</h2>
            {renderTable(settlements.pharmacy, 'pharmacy')}
          </section>
          <section>
            <h2 className="font-display font-semibold text-lg text-dark-green mb-3">Courier payouts</h2>
            {renderTable(settlements.courier, 'courier')}
          </section>
        </div>
      ) : null}
    </HqLayout>
  );
}
