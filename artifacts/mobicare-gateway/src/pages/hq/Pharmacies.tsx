import { useState } from 'react';
import {
  useListHqPharmacies,
  useOnboardPharmacy,
  useUpdateHqPharmacy,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Copy } from 'lucide-react';

export default function HqPharmacies() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListHqPharmacies();
  const pharmacies = data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListHqPharmaciesQueryKey() });
  const onError = (err: unknown) =>
    toast({ title: 'Action failed', description: err instanceof Error ? err.message : 'Please try again', variant: 'destructive' });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', username: '', phone: '', address: '' });
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const onboard = useOnboardPharmacy({
    mutation: {
      onSuccess: (res) => {
        setTempPassword(res.tempPassword);
        refresh();
      },
      onError,
    },
  });
  const update = useUpdateHqPharmacy({ mutation: { onSuccess: refresh, onError } });

  return (
    <HqLayout title="Pharmacies">
      <div className="mb-4">
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) {
              setTempPassword(null);
              setForm({ name: '', username: '', phone: '', address: '' });
            }
          }}
        >
          <DialogTrigger asChild>
            <Button data-testid="button-onboard-pharmacy">Onboard pharmacy</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Onboard a pharmacy</DialogTitle>
              <DialogDescription>
                A one-time temporary password is generated — share it securely with the pharmacy. It is shown only once.
              </DialogDescription>
            </DialogHeader>

            {tempPassword ? (
              <div className="space-y-3">
                <p className="text-sm">Pharmacy created. Temporary password:</p>
                <div className="flex items-center gap-2">
                  <code className="bg-muted px-3 py-2 rounded-lg font-mono text-lg" data-testid="text-temp-password">
                    {tempPassword}
                  </code>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(tempPassword);
                      toast({ title: 'Copied to clipboard' });
                    }}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  This password will not be shown again. The pharmacy should change it after first login.
                </p>
              </div>
            ) : (
              <form
                className="space-y-3"
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </HqLayout>
  );
}
