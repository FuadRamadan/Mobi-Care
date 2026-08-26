import { type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

export function formatLeones(n: number | null | undefined): string {
  return `Le ${(n ?? 0).toLocaleString()}`;
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_STYLES: Record<string, string> = {
  awaiting_payment: 'bg-gray-100 text-gray-700',
  paid: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-sky-100 text-sky-800',
  packaging: 'bg-amber-100 text-amber-800',
  ready: 'bg-violet-100 text-violet-800',
  assigned: 'bg-indigo-100 text-indigo-800',
  picked_up: 'bg-cyan-100 text-cyan-800',
  delivering: 'bg-teal-100 text-teal-800',
  delivered: 'bg-green-100 text-green-800',
  collected: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  open: 'bg-red-100 text-red-800',
  reviewed: 'bg-green-100 text-green-800',
  pending: 'bg-amber-100 text-amber-800',
  paid_settlement: 'bg-green-100 text-green-800',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="secondary" className={STATUS_STYLES[status] ?? ''}>
      {status.replaceAll('_', ' ')}
    </Badge>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
          <div className="font-display font-bold text-2xl text-dark-green mt-1 truncate">{value}</div>
          {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
        </div>
        {icon && <div className="text-primary/60 shrink-0">{icon}</div>}
      </CardContent>
    </Card>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="text-center text-muted-foreground text-sm py-12 border rounded-xl bg-card">
      {children}
    </div>
  );
}
