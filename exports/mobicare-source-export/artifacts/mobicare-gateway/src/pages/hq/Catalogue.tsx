import { useState } from 'react';
import {
  useListHqDrugs,
  useCreateHqDrug,
  useUpdateHqDrug,
  getListHqDrugsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import HqLayout from './HqLayout';
import { EmptyState } from './shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';

const TIER_LABEL: Record<string, string> = {
  '1': 'Tier 1 · Controlled',
  '2': 'Tier 2 · Prescription',
  '3': 'Tier 3 · OTC',
};

export default function HqCatalogue() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<'all' | 'held'>('all');
  const { data, isLoading } = useListHqDrugs(tab === 'held' ? { status: 'held' } : undefined);
  const drugs = data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListHqDrugsQueryKey() });
  const onError = (err: unknown) =>
    toast({ title: 'Action failed', description: err instanceof Error ? err.message : 'Please try again', variant: 'destructive' });
  const create = useCreateHqDrug({ mutation: { onSuccess: refresh, onError } });
  const update = useUpdateHqDrug({ mutation: { onSuccess: refresh, onError } });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', genericName: '', tier: '3', unit: 'tablets', maxUnits: '' });

  return (
    <HqLayout title="Master Catalogue">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'all' | 'held')}>
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-all-drugs">All drugs</TabsTrigger>
            <TabsTrigger value="held" data-testid="tab-held-drugs">Held (proposals)</TabsTrigger>
          </TabsList>
        </Tabs>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-drug">Add drug</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add drug to master catalogue</DialogTitle>
              <DialogDescription>
                Tier 1 (controlled) drugs require a max-units-per-order cap.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate(
                  {
                    data: {
                      name: form.name,
                      genericName: form.genericName || undefined,
                      tier: form.tier as '1' | '2' | '3',
                      unit: form.unit,
                      maxUnitsPerOrder: form.maxUnits ? Number(form.maxUnits) : null,
                    },
                  },
                  { onSuccess: () => setOpen(false) },
                );
              }}
            >
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-drug-name" />
              </div>
              <div className="space-y-1.5">
                <Label>Generic name (optional)</Label>
                <Input value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Tier</Label>
                  <Select value={form.tier} onValueChange={(v) => setForm({ ...form, tier: v })}>
                    <SelectTrigger data-testid="select-drug-tier"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(['1', '2', '3'] as const).map((t) => (
                        <SelectItem key={t} value={t}>{TIER_LABEL[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Unit</Label>
                  <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
                </div>
              </div>
              {form.tier === '1' && (
                <div className="space-y-1.5">
                  <Label>Max units per order (required for Tier 1)</Label>
                  <Input
                    type="number"
                    min={1}
                    required
                    value={form.maxUnits}
                    onChange={(e) => setForm({ ...form, maxUnits: e.target.value })}
                    data-testid="input-max-units"
                  />
                </div>
              )}
              <Button type="submit" disabled={create.isPending} className="w-full" data-testid="button-submit-drug">
                {create.isPending ? 'Adding…' : 'Add drug'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : drugs.length === 0 ? (
        <EmptyState>{tab === 'held' ? 'No held proposals awaiting review.' : 'No drugs in the catalogue yet.'}</EmptyState>
      ) : (
        <div className="border rounded-xl bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Drug</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Max units/order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drugs.map((d) => (
                <TableRow key={d.id} data-testid={`row-drug-${d.id}`}>
                  <TableCell>
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{d.genericName ?? '—'} · {d.unit}</div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={d.tier}
                      onValueChange={(tier) => {
                        if (tier === '1' && d.maxUnitsPerOrder == null) {
                          const cap = window.prompt('Tier 1 requires a max-units-per-order cap. Enter cap:');
                          const n = cap ? Number(cap) : NaN;
                          if (!Number.isFinite(n) || n < 1) {
                            toast({ title: 'Tier not changed', description: 'A valid cap is required for Tier 1.', variant: 'destructive' });
                            return;
                          }
                          update.mutate({ id: d.id, data: { tier: '1', maxUnitsPerOrder: n } });
                          return;
                        }
                        update.mutate({ id: d.id, data: { tier: tier as '1' | '2' | '3' } });
                      }}
                    >
                      <SelectTrigger className="w-44" data-testid={`select-tier-${d.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(['1', '2', '3'] as const).map((t) => (
                          <SelectItem key={t} value={t}>{TIER_LABEL[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>{d.maxUnitsPerOrder ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={d.isApproved ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
                      {d.isApproved ? 'approved' : 'held'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {!d.isApproved && (
                      <Button
                        size="sm"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: d.id, data: { isApproved: true } })}
                        data-testid={`button-release-${d.id}`}
                      >
                        Release
                      </Button>
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
