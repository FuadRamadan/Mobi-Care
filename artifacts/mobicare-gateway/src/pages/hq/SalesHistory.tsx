import { useEffect, useState } from 'react';
import {
  getHqSalesHistory,
  useGetHqSalesHistory,
  getGetHqSalesHistoryQueryKey,
  useListHqPharmacies,
  type HqSale,
} from '@workspace/api-client-react';
import { Download, Search } from 'lucide-react';
import { EmptyState, formatLeones, formatDate } from './shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

const le = (minor: number) => `${minor < 0 ? '−' : ''}${formatLeones(Math.abs(minor) / 100)}`;
const PAGE = 50;

const STATE: Record<HqSale['state'], { label: string; tone: string }> = {
  waiting: { label: 'Waiting on order', tone: 'bg-sky-100 text-sky-800' },
  completed: { label: 'Completed', tone: 'bg-emerald-100 text-emerald-800' },
  paid_to_pharmacy: { label: 'Pharmacy paid', tone: 'bg-emerald-100 text-emerald-800' },
  refunded: { label: 'Refunded', tone: 'bg-red-100 text-red-800' },
};

/**
 * Every order paid through Monime in the chosen dates, newest first, with the
 * pharmacy, what was sold and what it brought MobiCare. Filter by pharmacy or
 * search an order number, patient or pharmacy; download as a spreadsheet (CSV).
 */
export function SalesHistory({ start, end }: { start: string; end: string }) {
  const { toast } = useToast();
  const [pharmacyId, setPharmacyId] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const { data: pharmacies } = useListHqPharmacies();

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const t = setTimeout(() => setQ(searchText.trim()), 350);
    return () => clearTimeout(t);
  }, [searchText]);
  useEffect(() => setPage(0), [start, end, pharmacyId, q]);

  const params = {
    start,
    end,
    ...(pharmacyId !== 'all' ? { pharmacyId } : {}),
    ...(q ? { q } : {}),
    limit: PAGE,
    offset: page * PAGE,
  };
  const { data, isLoading, isFetching } = useGetHqSalesHistory(params, {
    query: { queryKey: getGetHqSalesHistoryQueryKey(params), placeholderData: (previous) => previous },
  });

  const download = async () => {
    setDownloading(true);
    try {
      const all = await getHqSalesHistory({ ...params, limit: 5_000, offset: 0 });
      const header = ['Date paid', 'Order', 'Pharmacy', 'Patient', 'Type', 'Patient paid', 'Sales (pharmacy prices)', 'Commission 5%', 'Delivery fee', 'Service fee', 'Monime fee', 'MobiCare revenue', 'Pharmacy receives', 'Status'];
      const cell = (v: string | number) => {
        const text = String(v);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const leones = (minor: number) => (minor / 100).toFixed(2);
      const lines = all.orders.map((o) => [
        o.paidAt.slice(0, 16).replace('T', ' '), o.orderId.slice(0, 8).toUpperCase(), o.pharmacyName, o.patientName, o.fulfillmentType,
        leones(o.paidMinor), leones(o.salesMinor), leones(o.commissionMinor), leones(o.deliveryFeeMinor), leones(o.serviceFeeMinor),
        leones(o.monimeFeeMinor), leones(o.revenueMinor), leones(o.pharmacyReceivesMinor), STATE[o.state].label,
      ].map(cell).join(','));
      const csv = [header.join(','), ...lines].join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `mobicare-sales_${start}_to_${end}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      if (all.total > all.orders.length) {
        toast({ title: 'Download shortened', description: `The first ${all.orders.length} of ${all.total} orders. Choose fewer days for the rest.` });
      }
    } catch {
      toast({ title: 'Download failed', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="font-display font-semibold text-lg text-dark-green">Sales history</h2>
          <p className="text-sm text-muted-foreground">Every paid order in these dates, newest first, with what it brought MobiCare.</p>
        </div>
        <Button variant="outline" size="sm" onClick={download} disabled={downloading || !data?.total} className="gap-2">
          <Download className="w-4 h-4" /> {downloading ? 'Preparing…' : 'Download (CSV)'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <Select value={pharmacyId} onValueChange={setPharmacyId}>
          <SelectTrigger className="w-[220px]" aria-label="Pharmacy">
            <SelectValue placeholder="All pharmacies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All pharmacies</SelectItem>
            {(pharmacies ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8 w-[260px]"
            placeholder="Order number, patient or pharmacy"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            aria-label="Search sales"
          />
        </div>
      </div>

      {data && data.total > 0 && (
        <p className="text-sm text-muted-foreground mb-2 tabular-nums">
          {data.totals.orders} order{data.totals.orders === 1 ? '' : 's'}
          {data.totals.refundedOrders > 0 ? ` (${data.totals.refundedOrders} refunded)` : ''} · sales {le(data.totals.salesMinor)} ·
          MobiCare revenue <span className="font-semibold text-foreground">{le(data.totals.revenueMinor)}</span>
        </p>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : !data || data.total === 0 ? (
        <EmptyState>No paid orders match these dates{q || pharmacyId !== 'all' ? ' and filters' : ''}.</EmptyState>
      ) : (
        <>
          <div className={`border rounded-xl bg-card overflow-x-auto ${isFetching ? 'opacity-60 transition-opacity' : ''}`}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paid</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Pharmacy</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead className="text-right">Sales</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Delivery</TableHead>
                  <TableHead className="text-right">Monime fee</TableHead>
                  <TableHead className="text-right">MobiCare revenue</TableHead>
                  <TableHead className="text-right">Pharmacy gets</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="tabular-nums [&_td]:whitespace-nowrap">
                {data.orders.map((o) => (
                  <TableRow key={o.orderId}>
                    <TableCell className="whitespace-nowrap">{formatDate(o.paidAt)}</TableCell>
                    <TableCell className="font-mono text-xs">#{o.orderId.slice(0, 8).toUpperCase()}</TableCell>
                    <TableCell className="whitespace-nowrap">{o.pharmacyName}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {o.patientName || '—'}
                      <div className="text-[11px] text-muted-foreground capitalize">{o.fulfillmentType}</div>
                    </TableCell>
                    <TableCell className="text-right">{le(o.salesMinor)}</TableCell>
                    <TableCell className="text-right">{le(o.commissionMinor)}</TableCell>
                    <TableCell className="text-right">{o.deliveryFeeMinor ? le(o.deliveryFeeMinor) : '—'}</TableCell>
                    <TableCell className="text-right text-muted-foreground">−{le(o.monimeFeeMinor)}</TableCell>
                    <TableCell className="text-right font-semibold">{le(o.revenueMinor)}</TableCell>
                    <TableCell className="text-right">{le(o.pharmacyReceivesMinor)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATE[o.state].tone}`}>
                        {STATE[o.state].label}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 mt-3 text-sm">
              <span className="text-muted-foreground tabular-nums">Page {page + 1} of {pages}</span>
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
