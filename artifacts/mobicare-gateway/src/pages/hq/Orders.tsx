import { useState } from 'react';
import {
  getListHqOrdersQueryKey,
  useListHqOrders,
} from '@workspace/api-client-react';
import HqLayout from './HqLayout';
import { StatusBadge, formatLeones, formatDate, EmptyState } from './shared';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { orderNumber } from '@/lib/orderNumber';

const STATUSES = [
  'all', 'awaiting_payment', 'paid', 'confirmed', 'packaging', 'ready',
  'assigned', 'picked_up', 'delivering', 'delivered', 'collected', 'cancelled',
];

export default function HqOrders() {
  const [status, setStatus] = useState('all');
  const params = status === 'all' ? undefined : { status };
  const { data, isLoading } = useListHqOrders(
    params,
    {
      query: {
        queryKey: getListHqOrdersQueryKey(params),
        refetchInterval: 5_000,
      },
    },
  );
  // Find an order from the number a patient or pharmacy quotes (with or
  // without the #), or by the patient's name or phone.
  const [search, setSearch] = useState('');
  const q = search.trim().replace(/^#/, '').toLowerCase();
  const orders = (data ?? []).filter((o) =>
    !q || orderNumber(o.id).toLowerCase().includes(q) || o.patientName.toLowerCase().includes(q) || (o.patientPhone ?? '').includes(q),
  );

  return (
    <HqLayout title="All Orders">
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Order number, patient or phone"
          className="w-72"
          data-testid="input-order-search"
        />
        <div className="w-56">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger data-testid="select-order-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'all' ? 'All statuses' : s.replaceAll('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : orders.length === 0 ? (
        <EmptyState>No orders match{q ? ` “${search.trim()}”` : ' this filter'}.</EmptyState>
      ) : (
        <div className="border rounded-xl bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Pharmacy</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Courier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id} data-testid={`row-order-${o.id}`}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">#{orderNumber(o.id)}</TableCell>
                  <TableCell>
                    <div className="font-medium">{o.patientName}</div>
                    <div className="text-xs text-muted-foreground">{o.patientPhone}</div>
                  </TableCell>
                  <TableCell>{o.pharmacyName ?? '—'}</TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                    {o.items.map((i) => `${i.drugName}${i.brand ? ` (${i.brand})` : ''} ×${i.quantity}`).join(', ') || '—'}
                  </TableCell>
                  <TableCell>{formatLeones(o.totalLeones)}</TableCell>
                  <TableCell className="capitalize">{o.fulfillmentType}</TableCell>
                  <TableCell>{o.courier?.name ?? '—'}</TableCell>
                  <TableCell><StatusBadge status={o.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(o.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </HqLayout>
  );
}
