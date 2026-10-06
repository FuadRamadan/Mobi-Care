import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetHqPayouts,
  getGetHqPayoutsQueryKey,
  useApproveHqCashout,
  useRejectHqCashout,
  useRetryHqTransfer,
  type HqCashout,
} from '@workspace/api-client-react';
import { EmptyState, formatLeones, formatDate } from './shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

const le = (minor: number) => formatLeones(minor / 100);

const STATUS: Record<string, { label: string; tone: string }> = {
  awaiting_approval: { label: 'Waiting for approval', tone: 'bg-amber-100 text-amber-800' },
  sending: { label: 'Sending', tone: 'bg-sky-100 text-sky-800' },
  pending: { label: 'Sending', tone: 'bg-sky-100 text-sky-800' },
  processing: { label: 'Sending', tone: 'bg-sky-100 text-sky-800' },
  completed: { label: 'Sent', tone: 'bg-emerald-100 text-emerald-800' },
  failed: { label: 'Failed', tone: 'bg-red-100 text-red-800' },
  rejected: { label: 'Rejected', tone: 'bg-red-100 text-red-800' },
  cancelled: { label: 'Cancelled by pharmacy', tone: 'bg-muted text-muted-foreground' },
};

function apiMessage(err: unknown): string {
  const data = (err as { data?: { error?: string } })?.data;
  return data?.error ?? (err instanceof Error ? err.message : 'Please try again');
}

/**
 * HQ's side of pharmacy payouts (Monime phase 2): cash-outs to approve,
 * order money that couldn't be released, every pharmacy's balance, and
 * recent cash-outs.
 */
export default function SettlementPayouts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading, error } = useGetHqPayouts({
    query: { queryKey: getGetHqPayoutsQueryKey(), refetchInterval: 10_000 },
  });
  const [rejecting, setRejecting] = useState<HqCashout | null>(null);
  const [reason, setReason] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetHqPayoutsQueryKey() });
  const onError = (err: unknown) => toast({ title: 'Not done', description: apiMessage(err), variant: 'destructive' });
  const approve = useApproveHqCashout({
    mutation: {
      onSuccess: (c) => {
        toast({ title: 'Approved', description: `${le(c.amountMinor)} is on its way to ${c.network} ${c.maskedNumber}.` });
        refresh();
      },
      onError,
    },
  });
  const reject = useRejectHqCashout({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Rejected', description: 'The pharmacy has been told, and the money stays in its balance.' });
        setRejecting(null);
        setReason('');
        refresh();
      },
      onError,
    },
  });
  const retry = useRetryHqTransfer({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Sent again', description: 'The release was sent to Monime again.' });
        refresh();
      },
      onError,
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (error || !data) return <EmptyState>Couldn't load payouts. Try again in a moment.</EmptyState>;

  const owed = data.pharmacies.reduce((sum, p) => sum + p.availableMinor + p.releasingMinor, 0);

  return (
    <div className="space-y-8">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Summary label="Holding (in Monime)" value={data.monimeBalances.holdingMinor === null ? 'Unavailable' : le(data.monimeBalances.holdingMinor)} note="All money in MobiCare's Monime account" />
        <Summary label="MobiCare's share in Holding" value={le(data.monimeBalances.mobicareShareMinor)} note="Commission + delivery from completed orders, less Monime's fees" />
        <Summary label="Owed to pharmacies" value={le(owed)} note="Their balances, not yet cashed out" />
        <Summary
          label="Needs you"
          value={String(data.awaitingApproval.length + data.releaseProblems.length)}
          note={`${data.awaitingApproval.length} to approve · ${data.releaseProblems.length} not released`}
          alert={data.awaitingApproval.length + data.releaseProblems.length > 0}
        />
      </div>

      <section>
        <h2 className="font-display font-semibold text-lg text-dark-green mb-1">Cash-outs to approve</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Cash-outs above {le(data.approvalThresholdMinor)} wait for someone with the settlements permission. The money only goes to the pharmacy's registered number.
        </p>
        {data.awaitingApproval.length === 0 ? (
          <EmptyState>Nothing waiting for approval.</EmptyState>
        ) : (
          <div className="border rounded-xl bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pharmacy</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Fee (on top)</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody className="tabular-nums">
                {data.awaitingApproval.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.pharmacyName}</TableCell>
                    <TableCell className="text-right font-semibold">{le(c.amountMinor)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{le(c.feeMinor)}</TableCell>
                    <TableCell className="whitespace-nowrap">{c.network} {c.maskedNumber}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(c.createdAt)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap space-x-2">
                      <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate({ id: c.id })}>
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRejecting(c)}>
                        Reject
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display font-semibold text-lg text-dark-green mb-1">Money not released</h2>
        <p className="text-sm text-muted-foreground mb-3">
          A completed order's money could not move out of Holding. If it says <code>fund_insufficient</code>, top up Holding in Monime first, then retry.
        </p>
        {data.releaseProblems.length === 0 ? (
          <EmptyState>Every completed order's money has been released.</EmptyState>
        ) : (
          <div className="border rounded-xl bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Pharmacy</TableHead>
                  <TableHead>Share</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody className="tabular-nums">
                {data.releaseProblems.map((r) => (
                  <TableRow key={r.transferId}>
                    <TableCell className="font-mono text-xs">#{r.orderId.slice(0, 8).toUpperCase()}</TableCell>
                    <TableCell>{r.pharmacyName}</TableCell>
                    <TableCell>{r.kind === 'pharmacy_share' ? "Pharmacy's share" : "MobiCare's share"}</TableCell>
                    <TableCell className="text-right font-semibold">{le(r.amountMinor)}</TableCell>
                    <TableCell className="text-sm">{r.failureCode ?? 'unknown'}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate({ id: r.transferId })}>
                        Retry
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display font-semibold text-lg text-dark-green mb-3">Pharmacy balances</h2>
        {data.pharmacies.length === 0 ? (
          <EmptyState>No pharmacy has online-paid orders yet.</EmptyState>
        ) : (
          <div className="border rounded-xl bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pharmacy</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">On its way</TableHead>
                  <TableHead className="text-right">Waiting on orders</TableHead>
                  <TableHead className="text-right">Paid out</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="tabular-nums">
                {data.pharmacies.map((p) => (
                  <TableRow key={p.pharmacyId}>
                    <TableCell className="font-medium">{p.pharmacyName}</TableCell>
                    <TableCell className="text-right font-semibold">{le(p.availableMinor)}</TableCell>
                    <TableCell className="text-right">{le(p.releasingMinor)}</TableCell>
                    <TableCell className="text-right">{le(p.waitingMinor)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{le(p.paidOutMinor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display font-semibold text-lg text-dark-green mb-3">Recent cash-outs</h2>
        {data.recentCashouts.length === 0 ? (
          <EmptyState>No cash-outs yet.</EmptyState>
        ) : (
          <div className="border rounded-xl bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Requested</TableHead>
                  <TableHead>Pharmacy</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Fee</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="tabular-nums">
                {data.recentCashouts.map((c) => {
                  const status = STATUS[c.status] ?? { label: c.status, tone: 'bg-muted text-muted-foreground' };
                  const note =
                    c.status === 'failed' ? c.failureCode : c.status === 'rejected' ? c.rejectionReason : c.approvedByName ? `Approved by ${c.approvedByName}` : null;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(c.createdAt)}</TableCell>
                      <TableCell>{c.pharmacyName}</TableCell>
                      <TableCell className="text-right font-medium">{le(c.amountMinor)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{le(c.feeMinor)}</TableCell>
                      <TableCell className="whitespace-nowrap">{c.network} {c.maskedNumber}</TableCell>
                      <TableCell>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${status.tone}`}>{status.label}</span>
                        {note && <p className="text-xs text-muted-foreground mt-1">{note}</p>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this cash-out?</DialogTitle>
            <DialogDescription>
              {rejecting && `${rejecting.pharmacyName}: ${le(rejecting.amountMinor)} to ${rejecting.network} ${rejecting.maskedNumber}. `}
              The money stays in the pharmacy's balance. The pharmacy sees your reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Please split this into two smaller cash-outs" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Keep it</Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || reject.isPending}
              onClick={() => rejecting && reject.mutate({ id: rejecting.id, data: { reason: reason.trim() } })}
            >
              Reject cash-out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Summary({ label, value, note, alert }: { label: string; value: string; note: string; alert?: boolean }) {
  return (
    <Card className={alert ? 'border-amber-400/60 bg-amber-50' : undefined}>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold mt-2 tabular-nums">{value}</p>
        <p className={`text-xs mt-1 ${alert ? 'text-amber-800 font-medium' : 'text-muted-foreground'}`}>{note}</p>
      </CardContent>
    </Card>
  );
}
