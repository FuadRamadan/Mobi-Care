import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Calculator, Clock, Pencil, Route } from 'lucide-react';
import {
  useGetDeliveryPricing,
  getGetDeliveryPricingQueryKey,
  useScheduleDeliveryPricing,
  useCancelScheduledDeliveryPricing,
  type KmPricingSettings,
} from '@workspace/api-client-react';
import { formatLeones } from './shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const midnight = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Freetown' });

const FIELDS: Array<{ key: keyof KmPricingSettings; label: string; unit: string; hint: string }> = [
  { key: 'maxKm', label: 'Maximum distance', unit: 'km', hint: 'From the pharmacy. Further away: collection only. Empty = no limit.' },
  { key: 'fuelPricePerLitre', label: 'Fuel price', unit: 'Le / litre', hint: 'Petrol, per litre' },
  { key: 'kmPerLitre', label: 'Km per litre', unit: 'km', hint: 'How far a delivery bike goes on a litre' },
  { key: 'pickupLeones', label: 'Pickup charge', unit: 'Le', hint: 'On every delivery' },
  { key: 'serviceRatePerKm', label: 'Service rate', unit: 'Le / km', hint: 'Per km, on top of the fuel' },
  { key: 'riderSharePercent', label: "Rider's share", unit: '%', hint: 'Of the service charge; the rider also gets all the fuel' },
  { key: 'roundToLeones', label: 'Round up to', unit: 'Le', hint: 'Fees are rounded up to this' },
  { key: 'minimumFeeLeones', label: 'Minimum fee', unit: 'Le', hint: '0 = none' },
];

function summary(p: KmPricingSettings): Array<[string, string]> {
  return [
    ['Delivers up to', p.maxKm == null ? 'No limit' : `${p.maxKm} km`],
    ['Fuel', `${formatLeones(p.fuelPricePerLitre)} a litre · ${p.kmPerLitre} km a litre`],
    ['Pickup', formatLeones(p.pickupLeones)],
    ['Service rate', `${formatLeones(p.serviceRatePerKm)} per km`],
    ["Rider's share", `All the fuel + ${p.riderSharePercent}% of the service`],
    ['Rounding', `Up to the next ${formatLeones(p.roundToLeones)}${p.minimumFeeLeones > 0 ? ` · minimum ${formatLeones(p.minimumFeeLeones)}` : ''}`],
  ];
}

/** The delivery fee, by distance: the numbers in force, and changing them from midnight. */
export function DeliveryPricingPanel({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data } = useGetDeliveryPricing();
  const schedule = useScheduleDeliveryPricing();
  const cancel = useCancelScheduledDeliveryPricing();
  const [form, setForm] = useState<Record<string, string> | null>(null);

  if (!data) return <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">Loading delivery pricing…</div>;
  const { current, scheduled } = data;
  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetDeliveryPricingQueryKey() });

  function startEdit() {
    const from = scheduled ?? current;
    setForm(Object.fromEntries(FIELDS.map((f) => [f.key, from[f.key] == null ? '' : String(from[f.key])])));
  }

  const parsed = form && (() => {
    const out: Record<string, number | null> = {};
    for (const f of FIELDS) {
      const raw = (form[f.key] ?? '').trim();
      if (f.key === 'maxKm' && raw === '') { out[f.key] = null; continue; }
      const n = Number(raw);
      if (raw === '' || !Number.isFinite(n) || n < 0) return null;
      out[f.key] = n;
    }
    if ((out.kmPerLitre ?? 0) <= 0 || (out.riderSharePercent ?? 0) > 100 || (out.roundToLeones ?? 0) < 1) return null;
    return out as unknown as KmPricingSettings;
  })();

  async function save() {
    if (!parsed) return;
    try {
      const state = await schedule.mutateAsync({ data: parsed });
      toast({ title: 'Delivery pricing scheduled', description: `The new numbers start at ${midnight(state.scheduled!.effectiveFrom)}.` });
      setForm(null);
      await refresh();
    } catch (err) {
      toast({ title: 'Not saved', description: (err as { data?: { error?: string } })?.data?.error ?? 'Try again.', variant: 'destructive' });
    }
  }

  async function cancelScheduled() {
    try {
      await cancel.mutateAsync();
      toast({ title: 'Change cancelled', description: 'Delivery keeps the current numbers.' });
      await refresh();
    } catch {
      toast({ title: 'Not cancelled', description: 'Try again.', variant: 'destructive' });
    }
  }

  return (
    <section className="rounded-xl border bg-card p-5 space-y-4" data-testid="panel-delivery-pricing">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="font-display font-semibold text-lg text-dark-green flex items-center gap-2">
            <Route className="w-5 h-5" /> Delivery fee by distance
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Every delivery is priced from the road distance between the pharmacy and the patient&apos;s pin: fuel there and
            back, plus the pickup charge and the service rate per km. The rider gets all the fuel and their share of the
            rest. Changes start at midnight (Freetown time).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="rounded-full" data-testid="link-fee-calculator">
            <Link href="/hq/delivery-pricing"><Calculator className="w-4 h-4" /> Try numbers</Link>
          </Button>
          {canManage && (
            <Button className="rounded-full" onClick={startEdit} data-testid="button-change-pricing">
              <Pencil className="w-4 h-4" /> Change
            </Button>
          )}
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 text-sm" data-testid="pricing-current">
        {summary(current).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="font-medium mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>

      {scheduled && (
        <div className="flex flex-wrap items-start gap-2 text-sm rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2" data-testid="pricing-scheduled">
          <Clock className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1 min-w-0">
            From <strong>{midnight(scheduled.effectiveFrom)}</strong>:{' '}
            {summary(scheduled).map(([l, v]) => `${l} ${v}`).join(' · ')}
          </span>
          {canManage && (
            <button className="font-medium underline" onClick={cancelScheduled} data-testid="button-cancel-pricing">Cancel</button>
          )}
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Change delivery pricing</DialogTitle>
            <DialogDescription>
              The new numbers start at {midnight(data.changesTakeEffectAt)}. Orders placed before then keep today&apos;s fee.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2 max-h-[60vh] overflow-y-auto pr-1">
              {FIELDS.map((f) => (
                <div key={f.key} className={`space-y-1 ${f.key === 'maxKm' ? 'sm:col-span-2' : ''}`}>
                  <Label htmlFor={`pricing-${f.key}`} className="flex justify-between gap-2">
                    <span>{f.label}</span><span className="text-xs text-muted-foreground font-normal">{f.unit}</span>
                  </Label>
                  <Input
                    id={`pricing-${f.key}`}
                    inputMode="decimal"
                    value={form[f.key] ?? ''}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    data-testid={`input-pricing-${f.key}`}
                  />
                  <p className="text-[11px] text-muted-foreground">{f.hint}</p>
                </div>
              ))}
            </div>
          )}
          {form && !parsed && <p className="text-xs text-destructive">Fill in every number. The rider&apos;s share is at most 100%, and km per litre more than 0.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button onClick={save} disabled={!parsed || schedule.isPending} data-testid="button-save-pricing">Schedule for midnight</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
