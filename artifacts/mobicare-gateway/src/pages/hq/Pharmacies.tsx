import { useState } from 'react';
import {
  useListHqPharmacies,
  useOnboardPharmacy,
  useUpdateHqPharmacy,
  useResetPharmacyPassword,
  getListHqPharmaciesQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import HqLayout from './HqLayout';
import { EmptyState, formatDate } from './shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Copy, KeyRound, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

export default function HqPharmacies() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListHqPharmacies();
  const pharmacies = data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListHqPharmaciesQueryKey() });
  const onError = (err: unknown) =>
    toast({ title: 'Action failed', description: err instanceof Error ? err.message : 'Please try again', variant: 'destructive' });

  const [openOnboard, setOpenOnboard] = useState(false);
  const [form, setForm] = useState({ name: '', username: '', phone: '', address: '' });
  const [tempPasswordRes, setTempPasswordRes] = useState<{ tempPassword: string; temporaryPasswordExpiresAt: string } | null>(null);

  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const onboard = useOnboardPharmacy({
    mutation: {
      onSuccess: (res) => {
        setTempPasswordRes({ tempPassword: res.tempPassword, temporaryPasswordExpiresAt: res.temporaryPasswordExpiresAt });
        refresh();
      },
      onError,
    },
  });
  const update = useUpdateHqPharmacy({ mutation: { onSuccess: refresh, onError } });

  const resetPassword = useResetPharmacyPassword({
    mutation: {
      onSuccess: (res) => {
        setTempPasswordRes({ tempPassword: res.tempPassword, temporaryPasswordExpiresAt: res.temporaryPasswordExpiresAt });
        refresh();
        setResetConfirmOpen(false);
      },
      onError: (err) => {
        onError(err);
        setResetConfirmOpen(false);
      },
    },
  });

  const activeResetTarget = pharmacies.find(p => p.id === resetTargetId);

  return (
    <HqLayout title="Pharmacies">
      <div className="mb-4">
        <Dialog
          open={openOnboard || !!tempPasswordRes}
          onOpenChange={(v) => {
            if (!v && tempPasswordRes) return;
            if (!v) {
              setTempPasswordRes(null);
              setForm({ name: '', username: '', phone: '', address: '' });
              setOpenOnboard(false);
            } else {
              setOpenOnboard(v);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button data-testid="button-onboard-pharmacy">Onboard pharmacy</Button>
          </DialogTrigger>
          <DialogContent
            className={tempPasswordRes ? '[&>button]:hidden' : undefined}
            onEscapeKeyDown={(event) => {
              if (tempPasswordRes) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (tempPasswordRes) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>{tempPasswordRes ? 'Temporary Password Generated' : 'Onboard a pharmacy'}</DialogTitle>
              <DialogDescription>
                {tempPasswordRes
                  ? 'A one-time temporary password has been generated. Ensure you communicate it securely. It will not be shown again.'
                  : 'Create a new pharmacy account. A one-time temporary password will be generated.'}
              </DialogDescription>
            </DialogHeader>

            {tempPasswordRes ? (
              <div className="space-y-4 pt-2">
                <div className="p-4 bg-muted/50 border border-border rounded-lg space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Temporary Password</p>
                      <code className="font-mono text-xl tracking-tight font-bold text-foreground" data-testid="text-temp-password">
                        {tempPasswordRes.tempPassword}
                      </code>
                    </div>
                    <Button
                      size="icon"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(tempPasswordRes.tempPassword);
                        toast({ title: 'Copied to clipboard' });
                      }}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-2.5 rounded border border-amber-200 dark:border-amber-900/50">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>
                      This password expires on <strong>{format(new Date(tempPasswordRes.temporaryPasswordExpiresAt), 'PPP p')}</strong>.
                      The pharmacy must log in and change their password before this time.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <Button onClick={() => { setTempPasswordRes(null); setOpenOnboard(false); }} variant="default">
                    I have saved it securely
                  </Button>
                </div>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  onboard.mutate({
                    data: {
                      name: form.name,
                      username: form.username,
                      phone: form.phone || undefined,
                      address: form.address || undefined,
                    },
                  });
                }}
              >
                <div className="space-y-1.5">
                  <Label>Pharmacy name</Label>
                  <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-pharmacy-name" />
                </div>
                <div className="space-y-1.5">
                  <Label>Login username</Label>
                  <Input required minLength={3} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} data-testid="input-pharmacy-username" />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone (optional)</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Address (optional)</Label>
                  <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </div>
                <Button type="submit" disabled={onboard.isPending} className="w-full" data-testid="button-submit-onboard">
                  {onboard.isPending ? 'Creating…' : 'Create pharmacy account'}
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Pharmacy Password</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reset the password for <strong>{activeResetTarget?.name}</strong>?
              <br/><br/>
              This will immediately invalidate their current password and disconnect active sessions. A new temporary password will be generated that you must relay to them securely.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetPassword.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetPassword.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (resetTargetId) {
                  resetPassword.mutate({ id: resetTargetId });
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {resetPassword.isPending ? 'Resetting...' : 'Yes, Reset Password'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : pharmacies.length === 0 ? (
        <EmptyState>No pharmacies yet — onboard the first one.</EmptyState>
      ) : (
        <div className="border rounded-xl bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pharmacy</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Online</TableHead>
                <TableHead>Tier 1 authorised</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pharmacies.map((p) => (
                <TableRow key={p.id} data-testid={`row-pharmacy-${p.id}`}>
                  <TableCell>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.address ?? '—'}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.username}</TableCell>
                  <TableCell>{p.phone ?? '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={p.isActive}
                        disabled={update.isPending}
                        onCheckedChange={(v) => update.mutate({ id: p.id, data: { isActive: v } })}
                        data-testid={`switch-active-${p.id}`}
                      />
                      <Badge variant="secondary" className={p.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}>
                        {p.isActive ? 'online' : 'offline'}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={p.controlledSubstanceAuthorized}
                      disabled={update.isPending}
                      onCheckedChange={(v) => update.mutate({ id: p.id, data: { controlledSubstanceAuthorized: v } })}
                      data-testid={`switch-tier1-${p.id}`}
                    />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(p.createdAt)}</TableCell>
                  <TableCell>
                    {p.isActive ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1.5 h-8 w-full border-border/60 hover:bg-destructive/5 hover:text-destructive hover:border-destructive/30"
                        onClick={() => {
                          setResetTargetId(p.id);
                          setResetConfirmOpen(true);
                        }}
                        data-testid={`button-reset-password-${p.id}`}
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        Reset
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground px-2">Inactive</span>
                    )}
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
