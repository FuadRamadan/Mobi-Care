import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPharmacyPayouts,
  getGetPharmacyPayoutsQueryKey,
  useRequestPharmacyCashout,
  useCancelPharmacyCashout,
  type PharmacyCashout,
  type PayoutDestination,
  type PharmacyPayouts,
} from "@workspace/api-client-react";
import { Wallet, Clock, Hourglass, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { formatLeones, formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const le = (minor: number) => formatLeones(minor / 100);

/** Monime's fee estimate, matching the server: basis points, rounded up. */
const feeFor = (amountMinor: number, basisPoints: number) => Math.ceil((amountMinor * basisPoints) / 10_000);

const STATUS: Record<string, { label: string; tone: string }> = {
  awaiting_approval: { label: "Waiting for HQ approval", tone: "bg-amber-100 text-amber-800" },
  sending: { label: "Sending", tone: "bg-sky-100 text-sky-800" },
  pending: { label: "Sending", tone: "bg-sky-100 text-sky-800" },
  processing: { label: "Sending", tone: "bg-sky-100 text-sky-800" },
  completed: { label: "Sent", tone: "bg-emerald-100 text-emerald-800" },
  failed: { label: "Did not go through", tone: "bg-red-100 text-red-800" },
  rejected: { label: "Not approved", tone: "bg-red-100 text-red-800" },
  cancelled: { label: "Cancelled", tone: "bg-muted text-muted-foreground" },
};

function apiMessage(err: unknown): string {
  const data = (err as { data?: { error?: string } })?.data;
  return data?.error ?? (err instanceof Error ? err.message : "Something went wrong. Try again.");
}

export default function Payouts() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetPharmacyPayouts({
    query: { queryKey: getGetPharmacyPayoutsQueryKey(), refetchInterval: 10_000 },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetPharmacyPayoutsQueryKey() });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Payouts</h1>
        <div className="h-40 bg-card rounded-xl border border-card-border animate-pulse" />
      </div>
    );
  }
  if (!data) return null;

  if (!data.enabled) {
    return (
      <div className="space-y-4 max-w-2xl">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Payouts</h1>
        <p className="text-muted-foreground">
          Payouts start when patients pay online through MobiCare. Until then, patients pay you directly and nothing
          appears here.
        </p>
      </div>
    );
  }

  const { balance } = data;
  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Payouts</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Money from orders paid online through MobiCare: your prices, less MobiCare's 5% commission.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Figure icon={Wallet} label="Available to cash out" value={le(balance.availableMinor)} note="Released to you" strong />
        <Figure icon={Clock} label="On its way" value={le(balance.releasingMinor)} note="Completed orders, arriving shortly" />
        <Figure icon={Hourglass} label="Waiting on orders" value={le(balance.waitingMinor)} note="Paid, not yet delivered or collected" />
        <Figure icon={Send} label="Paid out so far" value={le(balance.paidOutMinor)} note={balance.cashingOutMinor > 0 ? `${le(balance.cashingOutMinor)} being sent now` : "To your mobile money"} />
      </div>

      <CashoutForm data={data} onDone={refresh} />

      <section className="bg-card border border-card-border rounded-xl p-4 sm:p-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-4">Cash-outs</h2>
        <CashoutTable cashouts={data.cashouts} onChanged={refresh} />
      </section>

      <section className="bg-card border border-card-border rounded-xl p-4 sm:p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Money released from orders</h2>
        <p className="text-sm text-muted-foreground mb-4">Your share of each order, added to your balance once it is delivered or collected.</p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Released</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {data.releases.map((r) => (
                <TableRow key={r.orderId}>
                  <TableCell className="font-mono text-xs">#{r.orderId.slice(0, 8).toUpperCase()}</TableCell>
                  <TableCell className="text-right font-medium">{le(r.amountMinor)}</TableCell>
                  <TableCell>
                    <Pill tone={r.status === "released" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800"}>
                      {r.status === "released" ? "In your balance" : r.status === "releasing" ? "On its way" : "Nothing to release"}
                    </Pill>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{r.releasedAt ? formatDateTime(r.releasedAt) : "—"}</TableCell>
                </TableRow>
              ))}
              {data.releases.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground h-16">Nothing released yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function CashoutForm({ data, onDone }: { data: PharmacyPayouts; onDone: () => void }) {
  const usable = data.destinations.filter((d) => d.usable);
  const [provider, setProvider] = useState<PayoutDestination["provider"] | null>(usable[0]?.provider ?? null);
  const [amount, setAmount] = useState("");
  const request = useRequestPharmacyCashout({
    mutation: {
      onSuccess: (cashout) => {
        toast.success(
          cashout.status === "awaiting_approval"
            ? "Cash-out requested. HQ approves cash-outs above Le 2,000 before they are sent."
            : `Cash-out of ${le(cashout.amountMinor)} is on its way to ${cashout.network} ${cashout.maskedNumber}.`,
        );
        setAmount("");
        onDone();
      },
      onError: (err) => toast.error(apiMessage(err)),
    },
  });

  const amountMinor = useMemo(() => {
    const value = Number(amount);
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : 0;
  }, [amount]);
  const fee = feeFor(amountMinor, data.feeBasisPoints);
  const tooMuch = amountMinor + fee > data.balance.availableMinor;
  const tooLittle = amountMinor > 0 && amountMinor < data.minCashoutMinor;
  const needsApproval = amountMinor > data.approvalThresholdMinor;
  // One cash-out at a time, so two requests can never spend the same money.
  const open = data.cashouts.find((c) => ["awaiting_approval", "sending", "pending", "processing"].includes(c.status));
  const canSubmit = data.canCashOut && !open && provider && amountMinor > 0 && !tooMuch && !tooLittle && !request.isPending;

  return (
    <section className="bg-card border border-card-border rounded-xl p-4 sm:p-6 shadow-sm space-y-5" data-testid="cashout-form">
      <div>
        <h2 className="text-lg font-semibold">Cash out</h2>
        <p className="text-sm text-muted-foreground">
          Money goes only to the payout numbers HQ registered for you. To change a number, contact HQ.
        </p>
      </div>

      {open && (
        <p className="text-sm rounded-lg border border-sky-200 bg-sky-50 text-sky-900 px-3 py-2" data-testid="cashout-open">
          {open.status === "awaiting_approval"
            ? `Your cash-out of ${le(open.amountMinor)} is waiting for HQ approval. You can request another once it is finished.`
            : `Your cash-out of ${le(open.amountMinor)} is being sent. You can request another once it is finished.`}
        </p>
      )}

      <div className="space-y-2">
        <Label>Send to</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.destinations.map((d) => (
            <button
              key={d.provider}
              type="button"
              disabled={!d.usable}
              onClick={() => setProvider(d.provider)}
              className={`text-left rounded-lg border p-3 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                provider === d.provider && d.usable ? "border-primary bg-primary/5" : "border-card-border"
              } ${d.usable ? "hover:border-primary/60" : "opacity-70 cursor-not-allowed"}`}
              aria-pressed={provider === d.provider}
            >
              <div className="font-medium">{d.network}</div>
              <div className="text-sm tabular-nums text-muted-foreground">{d.maskedNumber ?? "No number registered"}</div>
              {!d.usable && <div className="text-xs mt-1 text-amber-700">{destinationProblem(d)}</div>}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 max-w-sm">
        <Label htmlFor="cashout-amount">Amount (Le)</Label>
        <div className="flex gap-2">
          <Input
            id="cashout-amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          />
          <Button
            type="button"
            variant="outline"
            disabled={data.balance.maxCashoutMinor <= 0}
            onClick={() => setAmount((data.balance.maxCashoutMinor / 100).toFixed(2))}
          >
            Everything
          </Button>
        </div>
      </div>

      {amountMinor > 0 && (
        <dl className="max-w-sm text-sm space-y-1 tabular-nums" data-testid="cashout-summary">
          <Row label="You receive" value={le(amountMinor)} strong />
          <Row label={`Monime's fee (${data.feeBasisPoints / 100}%)`} value={le(fee)} />
          <Row label="Taken from your balance" value={le(amountMinor + fee)} />
        </dl>
      )}
      {tooMuch && <p className="text-sm text-destructive">More than you can cash out. The most is {le(data.balance.maxCashoutMinor)}, because Monime's fee comes on top.</p>}
      {tooLittle && <p className="text-sm text-destructive">The smallest cash-out is {le(data.minCashoutMinor)}.</p>}
      {needsApproval && !tooMuch && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" /> Above {le(data.approvalThresholdMinor)}, HQ approves the cash-out before it is sent.
        </p>
      )}
      {!data.canCashOut && <p className="text-sm text-muted-foreground">Cash-outs are paused while online payments are switched off.</p>}

      <Button
        disabled={!canSubmit}
        onClick={() => provider && request.mutate({ data: { amountMinor, provider } })}
      >
        {request.isPending ? "Sending…" : needsApproval ? "Request cash-out" : "Cash out"}
      </Button>
    </section>
  );
}

function destinationProblem(d: PayoutDestination): string {
  if (d.problem === "on_hold" && d.availableAt) return `Number changed recently. Available from ${formatDateTime(d.availableAt)}.`;
  if (d.problem === "invalid_number") return "The registered number isn't valid. Contact HQ.";
  return "No number registered. Contact HQ to add one.";
}

function CashoutTable({ cashouts, onChanged }: { cashouts: PharmacyCashout[]; onChanged: () => void }) {
  const cancel = useCancelPharmacyCashout({
    mutation: {
      onSuccess: () => {
        toast.success("Cash-out cancelled. The money stays in your balance.");
        onChanged();
      },
      onError: (err) => toast.error(apiMessage(err)),
    },
  });
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Requested</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Fee</TableHead>
            <TableHead>To</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody className="tabular-nums">
          {cashouts.map((c) => {
            const status = STATUS[c.status] ?? { label: c.status, tone: "bg-muted text-muted-foreground" };
            const note = c.failureReason ?? (c.rejectionReason ? `HQ: ${c.rejectionReason}` : null);
            return (
              <TableRow key={c.id}>
                <TableCell className="whitespace-nowrap">{formatDateTime(c.createdAt)}</TableCell>
                <TableCell className="text-right font-medium">{le(c.amountMinor)}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {le(c.feeMinor)}
                  {c.feeIsEstimate && c.status !== "rejected" && c.status !== "cancelled" ? "*" : ""}
                </TableCell>
                <TableCell className="whitespace-nowrap">{c.network} {c.maskedNumber}</TableCell>
                <TableCell className="min-w-48">
                  <Pill tone={status.tone}>{status.label}</Pill>
                  {note && <p className="text-xs text-muted-foreground mt-1 max-w-xs whitespace-normal">{note}</p>}
                </TableCell>
                <TableCell className="text-right">
                  {c.status === "awaiting_approval" && (
                    <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate({ id: c.id })}>
                      Cancel
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {cashouts.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground h-16">No cash-outs yet.</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {cashouts.some((c) => c.feeIsEstimate) && (
        <p className="text-xs text-muted-foreground mt-2">* Estimated until Monime confirms the fee.</p>
      )}
    </div>
  );
}

function Figure({ icon: Icon, label, value, note, strong }: { icon: typeof Wallet; label: string; value: string; note: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 sm:p-5 ${strong ? "border-primary/40 bg-primary/5" : "border-card-border bg-card"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs sm:text-sm font-medium text-muted-foreground">{label}</p>
        <Icon className="w-4 h-4 text-primary shrink-0" />
      </div>
      <p className="mt-2 text-xl sm:text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 ${strong ? "font-semibold" : "text-muted-foreground"}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${tone}`}>{children}</span>;
}
