import { useMemo, useState } from 'react';
import { useGetHqOnlinePayments, getGetHqOnlinePaymentsQueryKey } from '@workspace/api-client-react';
import HqLayout from './HqLayout';
import SettlementPayouts from './SettlementPayouts';
import { SalesHistory } from './SalesHistory';
import { TrendChart, TREND_GREEN, TREND_VIOLET } from '@/components/TrendChart';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, formatLeones, formatDate } from './shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const le = (minor: number) => formatLeones(minor / 100);
const PROVIDERS: Record<string, string> = { m17: 'Orange Money', m18: 'AfriMoney' };

/**
 * HQ Settlements. Every order is paid through Monime into MobiCare's Holding
 * account. "Figures": per day, what patients paid and MobiCare's share
 * (commission, delivery, any service fee, less Monime's fee), which stays in
 * Holding; money waiting on orders; refunds to pay. "Payouts": pharmacy
 * balances, cash-outs to approve, and money that couldn't be released.
 * These are MobiCare's own records; checking them against Monime's balances
 * comes with reconciliation.
 */
/** Freetown is on UTC all year, so the UTC date is the business date. */
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86400_000));
const PRESETS = [
  { key: 'today', label: 'Today', range: () => ({ start: daysAgo(0), end: daysAgo(0) }) },
  { key: '7', label: 'Last 7 days', range: () => ({ start: daysAgo(6), end: daysAgo(0) }) },
  { key: '30', label: 'Last 30 days', range: () => ({ start: daysAgo(29), end: daysAgo(0) }) },
  { key: 'month', label: 'This month', range: () => ({ start: `${daysAgo(0).slice(0, 7)}-01`, end: daysAgo(0) }) },
  {
    key: 'last-month',
    label: 'Last month',
    range: () => {
      const now = new Date();
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
      return { start: isoDay(first), end: isoDay(last) };
    },
  },
] as const;

export default function HqSettlements() {
  const [preset, setPreset] = useState<string>('30');
  const [period, setPeriod] = useState(PRESETS[2].range());
  const { data, isLoading, isFetching, error } = useGetHqOnlinePayments(period, {
    query: { queryKey: getGetHqOnlinePaymentsQueryKey(period), refetchInterval: 15_000, placeholderData: (previous) => previous },
  });

  const days = (data?.daily ?? []).filter((d) => d.ordersPaid > 0 || d.date === data?.today).reverse();
  const totals = (data?.daily ?? []).reduce(
    (t, d) => ({
      collected: t.collected + d.collectedMinor,
      sales: t.sales + d.salesMinor,
      orders: t.orders + d.ordersPaid,
      fees: t.fees + d.serviceFeesMinor,
      commission: t.commission + d.commissionMinor,
      delivery: t.delivery + d.deliveryFeesMinor,
      monime: t.monime + d.monimeFeesMinor,
      refunds: t.refunds + d.refundsMinor,
      net: t.net + d.netMinor,
    }),
    { collected: 0, sales: 0, orders: 0, fees: 0, commission: 0, delivery: 0, monime: 0, refunds: 0, net: 0 },
  );
  const chartDays = useMemo(
    () => (data?.daily ?? []).map((d) => ({
      date: d.date,
      orders: d.ordersPaid,
      details: [
        { label: 'Commission', minor: d.commissionMinor },
        { label: 'Delivery', minor: d.deliveryFeesMinor },
        ...(d.serviceFeesMinor ? [{ label: 'Service fee', minor: d.serviceFeesMinor }] : []),
        { label: 'Monime fees', minor: -d.monimeFeesMinor },
      ],
    })),
    [data],
  );
  const chartSeries = useMemo(
    () => [
      { key: 'sales', label: 'Sales (pharmacy prices)', color: TREND_GREEN, values: (data?.daily ?? []).map((d) => d.salesMinor) },
      { key: 'revenue', label: 'MobiCare revenue', color: TREND_VIOLET, values: (data?.daily ?? []).map((d) => d.netMinor) },
    ],
    [data],
  );
  const refundsToPay = data?.refunds ?? [];
  const refundsToPayMinor = refundsToPay.reduce((sum, r) => sum + r.amountMinor, 0);

  const initialTab = new URLSearchParams(window.location.search).get('tab') === 'payouts' ? 'payouts' : 'figures';

  return (
    <HqLayout title="Settlements">
      <Tabs defaultValue={initialTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="figures">Figures</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
        </TabsList>
        <TabsContent value="payouts">
          <SettlementPayouts />
        </TabsContent>
        <TabsContent value="figures">
      <div className="flex flex-wrap items-end gap-2 mb-6" data-testid="settlement-dates">
        {PRESETS.map((p) => (
          <Button
            key={p.key}
            size="sm"
            variant={preset === p.key ? 'default' : 'outline'}
            onClick={() => { setPreset(p.key); setPeriod(p.range()); }}
          >
            {p.label}
          </Button>
        ))}
        <div className="flex items-end gap-2 ml-0 sm:ml-2">
          <div className="space-y-1">
            <Label htmlFor="online-start" className="text-xs">From</Label>
            <Input id="online-start" type="date" className="h-9" value={period.start} max={period.end}
              onChange={(e) => { if (e.target.value) { setPreset('custom'); setPeriod({ ...period, start: e.target.value }); } }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="online-end" className="text-xs">To</Label>
            <Input id="online-end" type="date" className="h-9" value={period.end} min={period.start}
              onChange={(e) => { if (e.target.value) { setPreset('custom'); setPeriod({ ...period, end: e.target.value }); } }} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground basis-full">
          Counted on the day the payment was confirmed (Freetown time). Up to 92 days at a time.
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : error || !data ? (
        <EmptyState>Couldn't load these figures. Check the dates (up to 92 days) and try again.</EmptyState>
      ) : !data.enabled ? (
        <EmptyState>Online payments are not switched on yet. Figures appear here once patients pay through Monime.</EmptyState>
      ) : (
        <div className="space-y-8">
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
            <Summary label="MobiCare revenue" value={le(totals.net)} strong
              note={`Commission ${le(totals.commission)} + delivery ${le(totals.delivery)}${totals.fees ? ` + service fee ${le(totals.fees)}` : ''} − Monime ${le(totals.monime)}`} />
            <Summary label="Sales" value={le(totals.sales)} note="Medicines at the pharmacies' prices" />
            <Summary label="Orders paid" value={String(totals.orders)} note={totals.refunds ? `Refunds ${le(totals.refunds)}` : 'In these dates'} />
            <Summary label="Waiting on orders" value={le(data.waitingOnOrdersMinor)}
              note="Paid, not yet delivered or collected (any date)" />
            <Summary label="Refunds to pay" value={le(refundsToPayMinor)}
              note={`${refundsToPay.length} order${refundsToPay.length === 1 ? '' : 's'}`} alert={refundsToPay.length > 0} />
          </div>

          <section className="border rounded-xl bg-card p-4 sm:p-6">
            <h2 className="font-display font-semibold text-lg text-dark-green">Sales and revenue</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Per day: sales at the pharmacies' prices, and MobiCare's revenue from them. Tap a day for the orders and the breakdown.
            </p>
            <div className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
              <TrendChart days={chartDays} series={chartSeries} label="Daily sales and MobiCare revenue" />
            </div>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-dark-green mb-3">By day</h2>
            <div className="border rounded-xl bg-card overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date paid</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                    <TableHead className="text-right">Service fee</TableHead>
                    <TableHead className="text-right">Commission 5%</TableHead>
                    <TableHead className="text-right">Delivery</TableHead>
                    <TableHead className="text-right">Monime fees</TableHead>
                    <TableHead className="text-right">Refunds</TableHead>
                    <TableHead className="text-right">MobiCare revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="tabular-nums">
                  {days.map((d) => (
                    <TableRow key={d.date}>
                      <TableCell className="font-medium whitespace-nowrap">{d.date}</TableCell>
                      <TableCell className="text-right">{d.ordersPaid}</TableCell>
                      <TableCell className="text-right">{le(d.collectedMinor)}</TableCell>
                      <TableCell className="text-right">{le(d.serviceFeesMinor)}</TableCell>
                      <TableCell className="text-right">{le(d.commissionMinor)}</TableCell>
                      <TableCell className="text-right">{le(d.deliveryFeesMinor)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">−{le(d.monimeFeesMinor)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {d.refundsCount ? `${d.refundsCount} · ${le(d.refundsMinor)}` : '—'}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{le(d.netMinor)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/40 font-semibold">
                    <TableCell>Period total</TableCell>
                    <TableCell className="text-right">{data.daily.reduce((n, d) => n + d.ordersPaid, 0)}</TableCell>
                    <TableCell className="text-right">{le(totals.collected)}</TableCell>
                    <TableCell className="text-right">{le(totals.fees)}</TableCell>
                    <TableCell className="text-right">{le(totals.commission)}</TableCell>
                    <TableCell className="text-right">{le(totals.delivery)}</TableCell>
                    <TableCell className="text-right">−{le(totals.monime)}</TableCell>
                    <TableCell className="text-right">{le(totals.refunds)}</TableCell>
                    <TableCell className="text-right">{le(totals.net)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              MobiCare revenue (commission + delivery + any service fee, less Monime's fees) stays in the Holding account until an admin decides what to do with it. It leaves out refunded orders; Collected includes them, since the money came in before it goes back.
            </p>
          </section>

          <SalesHistory start={period.start} end={period.end} />

          <section>
            <h2 className="font-display font-semibold text-lg text-dark-green mb-1">Refunds to pay by hand</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Paid orders that were cancelled, or payments that arrived after the order could no longer go ahead.
              Automatic mobile money refunds come with a later update; until then, pay these from HQ.
            </p>
            {refundsToPay.length === 0 ? (
              <EmptyState>No refunds waiting.</EmptyState>
            ) : (
              <div className="border rounded-xl bg-card overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Pharmacy</TableHead>
                      <TableHead>Paid</TableHead>
                      <TableHead>Paid with</TableHead>
                      <TableHead>Why</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {refundsToPay.map((r) => (
                      <TableRow key={r.orderId}>
                        <TableCell className="font-mono text-xs">{r.orderId.slice(0, 8)}</TableCell>
                        <TableCell>{r.patientName || '—'}</TableCell>
                        <TableCell>{r.pharmacyName ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(r.paidAt)}</TableCell>
                        <TableCell>{paidWith(r.payerChannel, r.payerProvider)}</TableCell>
                        <TableCell className="text-sm">{r.reason}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{le(r.amountMinor)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </div>
      )}
        </TabsContent>
      </Tabs>
    </HqLayout>
  );
}

function paidWith(channel: string | null, provider: string | null): string {
  if (provider && PROVIDERS[provider]) return PROVIDERS[provider];
  if (channel === 'momo') return 'Mobile money';
  if (channel === 'card') return 'Card';
  if (channel === 'bank') return 'Bank';
  return channel ?? '—';
}

function Summary({ label, value, note, alert, strong }: { label: string; value: string; note: string; alert?: boolean; strong?: boolean }) {
  return (
    <Card className={alert ? 'border-destructive/50 bg-destructive/5' : strong ? 'border-primary/40 bg-primary/5' : undefined}>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold mt-2 tabular-nums">{value}</p>
        <p className={`text-xs mt-1 ${alert ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>{note}</p>
      </CardContent>
    </Card>
  );
}
