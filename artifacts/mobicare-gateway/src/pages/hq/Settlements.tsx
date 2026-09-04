import { useState } from 'react';
import {
  useListSettlements,
  useGenerateSettlements,
  useRecordCommissionSettlementPayment,
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


type SettlementRecord = {
  id: string;
  pharmacyId: string;
  pharmacyName: string | null;
  settlementDate: string;
  ordersCount: number;
  grossCollectedMinor: number;
  drugAmountTotalMinor: number;
  commissionDueMinor: number;
  amountPaidMinor: number;
  balanceMinor: number;
  status: 'unpaid' | 'partially_paid' | 'paid';
  paidAt: string | null;
  paymentReference: string | null;
};
type SettlementsResponseData = {
  settlements: SettlementRecord[];
  metrics: {
    commissionEarnedMinor: number;
    commissionCollectedMinor: number;
    commissionOutstandingMinor: number;
    allTimeCommissionEarnedMinor: number;
  };
  rankings: {
    byOwed: { pharmacyId: string; pharmacyName: string | null; outstanding: number }[];
    byGenerated: { pharmacyId: string; pharmacyName: string | null; amountMinor: number }[];
  };
};


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
  const settlements = data as unknown as SettlementsResponseData;

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
  const recordPayment = useRecordCommissionSettlementPayment({ mutation: { onSuccess: refresh, onError } });



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
            <h2 className="font-display font-semibold text-lg text-dark-green mb-3">Financial overview (Range vs All-Time)</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Commission Earned</p>
                <div className="flex justify-between items-end mt-2"><p className="text-xl font-semibold">{formatLeones((settlements.metrics.commissionEarnedMinor ?? 0) / 100)} range</p><p className="text-sm text-muted-foreground">{formatLeones((settlements.metrics.allTimeCommissionEarnedMinor ?? 0) / 100)} all-time</p></div>
              </CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Commission Collected</p>
                <div className="flex justify-between items-end mt-2"><p className="text-xl font-semibold">{formatLeones((settlements.metrics.commissionCollectedMinor ?? 0) / 100)} range</p></div>
              </CardContent></Card>
              <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Commission Outstanding</p>
                <div className="flex justify-between items-end mt-2"><p className="text-xl font-semibold">{formatLeones((settlements.metrics.commissionOutstandingMinor ?? 0) / 100)} range</p></div>
              </CardContent></Card>
            </div>
          </section>

          <div className="grid gap-6 md:grid-cols-2">
            <section>
              <h2 className="font-display font-semibold text-lg text-dark-green mb-3">Top pharmacies (Owed to MobiCare)</h2>
              <div className="border rounded-xl bg-card overflow-x-auto">
                <Table><TableHeader><TableRow><TableHead>Pharmacy</TableHead><TableHead className="text-right">Outstanding</TableHead></TableRow></TableHeader>
                  <TableBody>{settlements.rankings.byOwed.map(row => <TableRow key={row.pharmacyId}><TableCell>{row.pharmacyName ?? '—'}</TableCell><TableCell className="text-right font-medium">{formatLeones(row.outstanding / 100)}</TableCell></TableRow>)}</TableBody>
                </Table>
              </div>
            </section>
            <section>
              <h2 className="font-display font-semibold text-lg text-dark-green mb-3">Top pharmacies (Commission Generated)</h2>
              <div className="border rounded-xl bg-card overflow-x-auto">
                <Table><TableHeader><TableRow><TableHead>Pharmacy</TableHead><TableHead className="text-right">Generated</TableHead></TableRow></TableHeader>
                  <TableBody>{settlements.rankings.byGenerated.map(row => <TableRow key={row.pharmacyId}><TableCell>{row.pharmacyName ?? '—'}</TableCell><TableCell className="text-right font-medium">{formatLeones(row.amountMinor / 100)}</TableCell></TableRow>)}</TableBody>
                </Table>
              </div>
            </section>
          </div>

          <section>
            <h2 className="font-display font-semibold text-lg text-dark-green mb-3">Settlement Records</h2>
            <div className="border rounded-xl bg-card overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Pharmacy</TableHead>
                    <TableHead>Orders</TableHead>
                    <TableHead>Gross (Patient)</TableHead>
                    <TableHead>Pharmacy Earned</TableHead>
                    <TableHead>Commission Due</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settlements.settlements.map((s) => (
                    <TableRow key={s.id} data-testid={`row-settlement-${s.id}`}>
                      <TableCell className="font-medium whitespace-nowrap">{formatDate(s.settlementDate)}</TableCell>
                      <TableCell>{s.pharmacyName ?? '—'}</TableCell>
                      <TableCell>{s.ordersCount ?? 0}</TableCell>
                      <TableCell>{formatLeones((s.grossCollectedMinor ?? 0) / 100)}</TableCell>
                      <TableCell>{formatLeones((s.drugAmountTotalMinor ?? 0) / 100)}</TableCell>
                      <TableCell className="font-medium">{formatLeones((s.commissionDueMinor ?? 0) / 100)}</TableCell>
                      <TableCell className={`font-medium ${s.balanceMinor > 0 ? 'text-destructive' : 'text-green-600'}`}>{formatLeones((s.balanceMinor ?? 0) / 100)}</TableCell>
                      <TableCell>
                        <StatusBadge status={s.status} />
                        {s.paidAt && <div className="text-[11px] text-muted-foreground mt-0.5">{formatDate(s.paidAt)}</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.status !== 'paid' && (
                          <Button
                            size="sm"
                            disabled={recordPayment.isPending}
                            onClick={() => recordPayment.mutate({ id: s.id, data: { amountMinor: s.balanceMinor, paymentReference: 'MANUAL', paidAt: new Date().toISOString() } })}
                            data-testid={`button-mark-paid-${s.id}`}
                          >
                            Record payment
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      ) : null}
    </HqLayout>
  );
}
