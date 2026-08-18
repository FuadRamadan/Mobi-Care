import { useState } from 'react';
import {
  useListCouriers,
  useCreateCourier,
  useUpdateCourier,
  getListCouriersQueryKey,
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';

export default function HqCouriers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListCouriers();
  const couriers = data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListCouriersQueryKey() });
  const onError = (err: unknown) =>
    toast({ title: 'Action failed', description: err instanceof Error ? err.message : 'Please try again', variant: 'destructive' });

  const create = useCreateCourier({
    mutation: {
      onSuccess: () => {
        refresh();
        setOpen(false);
        setForm({ name: '', phone: '', vehicleType: 'motorbike' });
      },
      onError,
    },
  });
  const update = useUpdateCourier({ mutation: { onSuccess: refresh, onError } });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', vehicleType: 'motorbike' });

  return (
    <HqLayout title="Courier Fleet">
      <div className="mb-4">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-courier">Add courier</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add courier</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate({
                  data: {
                    name: form.name,
                    phone: form.phone,
                    vehicleType: form.vehicleType as 'motorbike' | 'bicycle' | 'car' | 'van',
                  },
                });
              }}
            >
              <div className="space-y-1.5">
                <Label>Full name</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-courier-name" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input required minLength={5} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-courier-phone" />
              </div>
              <div className="space-y-1.5">
                <Label>Vehicle</Label>
                <Select value={form.vehicleType} onValueChange={(v) => setForm({ ...form, vehicleType: v })}>
                  <SelectTrigger data-testid="select-vehicle"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['motorbike', 'bicycle', 'car', 'van'].map((v) => (
                      <SelectItem key={v} value={v} className="capitalize">{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={create.isPending} className="w-full" data-testid="button-submit-courier">
                {create.isPending ? 'Adding…' : 'Add courier'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : couriers.length === 0 ? (
        <EmptyState>No couriers in the fleet yet.</EmptyState>
      ) : (
        <div className="border rounded-xl bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Courier</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Active deliveries</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {couriers.map((c) => (
                <TableRow key={c.id} data-testid={`row-courier-${c.id}`}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.phone}</TableCell>
                  <TableCell className="capitalize">{c.vehicleType}</TableCell>
                  <TableCell>{c.activeDeliveries ?? 0}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={c.isActive}
                        disabled={update.isPending}
                        onCheckedChange={(v) => update.mutate({ id: c.id, data: { isActive: v } })}
                        data-testid={`switch-courier-${c.id}`}
                      />
                      <Badge variant="secondary" className={c.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}>
                        {c.isActive ? 'active' : 'inactive'}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </HqLayout>
  );
}
