import { useState } from 'react';
import {
  getGetHqSecurityActivityQueryKey,
  useGetHqSecurityActivity,
  type HqSecurityEvent,
} from '@workspace/api-client-react';
import { Activity, AlertTriangle, Ban, KeyRound, ServerCrash, ShieldAlert } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatDate } from './shared';

const KIND: Record<HqSecurityEvent['kind'], { label: string; tone: string }> = {
  failed_sign_in: { label: 'Wrong password', tone: 'bg-amber-100 text-amber-800' },
  sign_in_blocked: { label: 'Blocked: too many tries', tone: 'bg-red-100 text-red-800' },
  csp_violation: { label: 'Blocked content', tone: 'bg-violet-100 text-violet-800' },
  server_error: { label: 'Server error', tone: 'bg-slate-200 text-slate-800' },
};

const ROLE: Record<string, string> = { patient: 'Patient', pharmacy: 'Pharmacy', hq: 'HQ' };

function detail(event: HqSecurityEvent): string {
  const d = (event.details ?? {}) as Record<string, unknown>;
  if (event.kind === 'csp_violation') return `${String(d.blocked || 'something')} (${String(d.directive || 'policy')})`;
  if (event.kind === 'failed_sign_in') {
    if (d.reason === 'no such account') return 'No account with this name or number';
    if (d.reason === 'wrong reset code') return 'Wrong password-reset code';
    if (d.reason === 'wrong current password') return 'Wrong current password when changing it';
    return 'Sign-in';
  }
  if (event.kind === 'server_error') return `${String(d.method ?? '')} ${event.path ?? ''}`.trim();
  return event.path ?? '';
}

/**
 * What the security monitor saw: failed sign-ins, guessing that was blocked,
 * content browsers refused to load, and server errors, with the alerts sent.
 */
export function SecurityActivity() {
  const [days, setDays] = useState('7');
  const params = { days: Number(days) };
  const { data, isLoading } = useGetHqSecurityActivity(params, {
    query: { queryKey: getGetHqSecurityActivityQueryKey(params), refetchInterval: 30_000 },
  });

  const tiles = [
    { label: 'Wrong passwords', value: data?.totals.failedSignIns, icon: KeyRound, warn: 20 },
    { label: 'Blocked for too many tries', value: data?.totals.signInsBlocked, icon: Ban, warn: 1 },
    { label: 'Blocked content', value: data?.totals.contentBlocked, icon: ShieldAlert, warn: 1 },
    { label: 'Server errors', value: data?.totals.serverErrors, icon: ServerCrash, warn: 1 },
  ];

  return (
    <section id="security" className="space-y-4 scroll-mt-6" data-testid="section-security-activity">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" /> Security activity
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Wrong passwords, sign-ins blocked for too many tries, content browsers refused to load, and server errors.
            You get an alert when these rise. Kept for 90 days.
          </p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40" aria-label="Period"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last 24 hours</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map(({ label, value, icon: Icon, warn }) => {
          const raised = (value ?? 0) >= warn;
          return (
            <div key={label} className={cn('rounded-xl border bg-card p-4', raised && 'border-amber-300 bg-amber-50/60')}>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                {label}
                <Icon className={cn('w-4 h-4', raised ? 'text-amber-600' : 'text-muted-foreground')} />
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{isLoading ? '…' : value ?? 0}</div>
            </div>
          );
        })}
      </div>

      {!!data?.alerts.length && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 divide-y divide-amber-200" data-testid="security-alerts">
          {data.alerts.map((alert) => (
            <div key={alert.id} className="p-3 flex gap-3 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
              <div>
                <div className="font-medium">{alert.title} <span className="font-normal text-muted-foreground">· {formatDate(alert.createdAt)}</span></div>
                <div className="text-muted-foreground">{alert.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border bg-card">
          <div className="px-4 py-3 border-b text-sm font-medium">Accounts with the most wrong passwords</div>
          {data?.topAccounts.length ? (
            <ul className="divide-y text-sm">
              {data.topAccounts.map((a) => (
                <li key={`${a.role}-${a.identifier}`} className="px-4 py-2 flex justify-between gap-3">
                  <span>{a.identifier} <span className="text-muted-foreground">· {ROLE[a.role ?? ''] ?? 'Unknown'}</span></span>
                  <span className="tabular-nums whitespace-nowrap">{a.count} · <span className="text-muted-foreground">{formatDate(a.lastAt)}</span></span>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-3 text-sm text-muted-foreground">None in this period.</p>}
        </div>
        <div className="rounded-xl border bg-card">
          <div className="px-4 py-3 border-b text-sm font-medium">Networks with the most failed or blocked sign-ins</div>
          {data?.topNetworks.length ? (
            <ul className="divide-y text-sm">
              {data.topNetworks.map((n) => (
                <li key={n.ipAddress} className="px-4 py-2 flex justify-between gap-3">
                  <span className="font-mono text-xs">{n.ipAddress}</span>
                  <span className="tabular-nums whitespace-nowrap">{n.count} · <span className="text-muted-foreground">{formatDate(n.lastAt)}</span></span>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-3 text-sm text-muted-foreground">None in this period.</p>}
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>What</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Network</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data?.events.length ? (
              <TableRow>
                <TableCell colSpan={5} className="text-sm text-muted-foreground text-center py-6">
                  {isLoading ? 'Loading…' : 'Nothing recorded in this period.'}
                </TableCell>
              </TableRow>
            ) : data.events.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap text-sm">{formatDate(e.createdAt)}</TableCell>
                <TableCell>
                  <span className={cn('inline-flex px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap', KIND[e.kind].tone)}>
                    {KIND[e.kind].label}
                  </span>
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {e.identifier ?? '—'}{e.role ? <span className="text-muted-foreground"> · {ROLE[e.role] ?? e.role}</span> : null}
                </TableCell>
                <TableCell className="font-mono text-xs whitespace-nowrap">{e.ipAddress ?? '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{detail(e)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
