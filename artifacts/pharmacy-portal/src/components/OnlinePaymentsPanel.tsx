import {
  useGetPharmacyOnlineAnalytics,
  getGetPharmacyOnlineAnalyticsQueryKey,
} from "@workspace/api-client-react";
import { format, parseISO, isSameDay } from "date-fns";
import { Smartphone } from "lucide-react";
import { formatLeones } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const le = (minor: number) => formatLeones(minor / 100);

/**
 * Orders patients paid online through MobiCare. Shown at the pharmacy's own
 * prices: the patient's service fee is MobiCare's and never appears here.
 */
export function OnlinePaymentsPanel({ start, end }: { start: string; end: string }) {
  const params = { start, end };
  const { data } = useGetPharmacyOnlineAnalytics(params, {
    query: {
      queryKey: getGetPharmacyOnlineAnalyticsQueryKey(params),
      refetchInterval: 15_000,
    },
  });
  if (!data?.enabled) return null;

  const { today } = data;
  const days = [...data.daily]
    .reverse()
    .filter((d) => d.ordersCount > 0 || d.refundedOrders > 0 || isSameDay(parseISO(d.date), new Date()));

  return (
    <section className="bg-card border border-card-border rounded-xl p-4 sm:p-6 shadow-sm space-y-5" data-testid="online-payments-panel">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-md bg-primary/10 text-primary">
          <Smartphone className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Paid online through MobiCare</h3>
          <p className="text-sm text-muted-foreground">
            At your own prices. MobiCare keeps its 5% commission and sends you the rest.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Figure label="Online sales today" value={le(today.salesMinor)} note={`${today.ordersCount} paid order${today.ordersCount === 1 ? "" : "s"}`} />
        <Figure label="MobiCare commission (5%)" value={le(today.commissionMinor)} note="Taken before you are paid" />
        <Figure label="You receive today" value={le(today.receiveMinor)} note="Sales minus commission" strong />
        <Figure
          label="Waiting on orders"
          value={le(data.waitingMinor)}
          note={`Paid, not yet delivered or collected · ${le(data.completedMinor)} completed`}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Completed orders are paid out to you once MobiCare payouts start. Refunded orders are not counted.
      </p>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date paid</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Sales (your prices)</TableHead>
              <TableHead className="text-right">Commission 5%</TableHead>
              <TableHead className="text-right">You receive</TableHead>
              <TableHead className="text-right">Refunded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="tabular-nums">
            {days.map((day) => (
              <TableRow key={day.date}>
                <TableCell className="font-medium">{format(parseISO(day.date), "MMM d, yyyy")}</TableCell>
                <TableCell className="text-right">{day.ordersCount}</TableCell>
                <TableCell className="text-right">{le(day.salesMinor)}</TableCell>
                <TableCell className="text-right">{le(day.commissionMinor)}</TableCell>
                <TableCell className="text-right font-semibold">{le(day.receiveMinor)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{day.refundedOrders || "—"}</TableCell>
              </TableRow>
            ))}
            {days.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground h-20">
                  No online payments in this period.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function Figure({ label, value, note, strong }: { label: string; value: string; note: string; strong?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${strong ? "border-primary/40 bg-primary/5" : "border-card-border"}`}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl sm:text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
