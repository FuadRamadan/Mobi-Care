import { useState } from 'react';
import { useListAuditLog } from '@workspace/api-client-react';
import HqLayout from './HqLayout';
import { EmptyState, formatDate } from './shared';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ENTITY_TYPES = ['all', 'order', 'pharmacy', 'drug', 'courier', 'flag', 'settlement', 'inventory', 'prescription', 'hq_staff'];

const ACTOR_STYLES: Record<string, string> = {
  hq: 'bg-emerald-100 text-emerald-800',
  pharmacy: 'bg-blue-100 text-blue-800',
  system: 'bg-gray-100 text-gray-700',
};

export default function HqAudit() {
  const [entityType, setEntityType] = useState('all');
  const { data, isLoading } = useListAuditLog(
    entityType === 'all' ? { limit: 200 } : { entityType, limit: 200 },
  );
  const entries = data ?? [];

  return (
    <HqLayout title="Audit Log">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="w-56">
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger data-testid="select-audit-entity"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ENTITY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t === 'all' ? 'All entities' : t.replaceAll('_', ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          Append-only — entries can never be edited or deleted.
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : entries.length === 0 ? (
        <EmptyState>No audit entries for this filter.</EmptyState>
      ) : (
        <div className="border rounded-xl bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id} data-testid={`row-audit-${e.id}`}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(e.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={ACTOR_STYLES[e.actorType] ?? ''}>{e.actorType}</Badge>
                    <div className="text-xs text-muted-foreground mt-0.5">{e.actorName ?? '—'}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.action}</TableCell>
                  <TableCell className="text-xs">
                    {e.entityType}
                    {e.entityId && <div className="text-muted-foreground font-mono truncate max-w-[120px]">{e.entityId}</div>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[320px] truncate">
                    {e.details ? JSON.stringify(e.details) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </HqLayout>
  );
}
