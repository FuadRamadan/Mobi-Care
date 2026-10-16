import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bike, Fuel, MapPin, RotateCcw } from 'lucide-react';
import {
  previewDeliveryPricing,
  useGetDeliveryPricing,
  useListDeliveryZones,
  type KmPricingSettings,
  type KmQuote,
} from '@workspace/api-client-react';
import HqLayout from './HqLayout';
import { formatLeones } from './shared';
import { TripMap } from '@/components/map/TripMap';
import type { LatLng, ZoneOutline } from '@/components/map/mapConfig';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/** Starting numbers: Le 40 a litre, ~40 km a litre, pickup Le 20, Le 4/km, rider 40%. */
const DEFAULTS: KmPricingSettings = {
  fuelPricePerLitre: 40,
  kmPerLitre: 40,
  pickupLeones: 20,
  serviceRatePerKm: 4,
  riderSharePercent: 40,
  roundToLeones: 5,
  minimumFeeLeones: 0,
  maxKm: null,
};

/** Approximate centres, for quick testing. Tap the map for an exact spot. */
const PLACES: Record<string, LatLng> = {
  Jui: { latitude: 8.4136, longitude: -13.1311 },
  Lumley: { latitude: 8.458, longitude: -13.264 },
  Goderich: { latitude: 8.43, longitude: -13.288 },
  Aberdeen: { latitude: 8.487, longitude: -13.275 },
  'Congo Cross': { latitude: 8.479, longitude: -13.256 },
  'Central (Cotton Tree)': { latitude: 8.4866, longitude: -13.2346 },
  Kissy: { latitude: 8.472, longitude: -13.188 },
  Wellington: { latitude: 8.443, longitude: -13.158 },
  Waterloo: { latitude: 8.338, longitude: -13.071 },
};

const EXAMPLES: Array<[string, string]> = [
  ['Lumley', 'Goderich'],
  ['Congo Cross', 'Aberdeen'],
  ['Central (Cotton Tree)', 'Kissy'],
  ['Wellington', 'Central (Cotton Tree)'],
  ['Jui', 'Lumley'],
  ['Jui', 'Waterloo'],
];

const FIELDS: Array<{ key: keyof KmPricingSettings; label: string; hint: string; unit: string }> = [
  { key: 'fuelPricePerLitre', label: 'Fuel price', hint: 'Petrol, per litre', unit: 'Le / litre' },
  { key: 'kmPerLitre', label: 'Km per litre', hint: 'A litre lasts ~2 hours at ~20 km/h', unit: 'km' },
  { key: 'pickupLeones', label: 'Pickup charge', hint: 'On every delivery', unit: 'Le' },
  { key: 'serviceRatePerKm', label: 'Service rate', hint: 'Per km, on top of fuel', unit: 'Le / km' },
  { key: 'riderSharePercent', label: "Rider's share", hint: 'Of the service part; fuel goes to the rider in full', unit: '%' },
  { key: 'roundToLeones', label: 'Round up to', hint: 'No small change', unit: 'Le' },
  { key: 'minimumFeeLeones', label: 'Minimum fee', hint: '0 = none', unit: 'Le' },
  { key: 'maxKm', label: 'Maximum distance', hint: 'Empty = no limit; beyond it, collection only', unit: 'km' },
];

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function DeliveryPricing() {
  // Starts from the numbers in force; changes here are only tried, never saved.
  const { data: live } = useGetDeliveryPricing();
  const liveSettings = useMemo<KmPricingSettings | null>(() => {
    if (!live) return null;
    const { effectiveFrom: _from, ...numbers } = live.current;
    return numbers;
  }, [live]);
  const [settings, setSettings] = useState<KmPricingSettings>(DEFAULTS);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (liveSettings && !touched) setSettings(liveSettings);
  }, [liveSettings, touched]);
  const [from, setFrom] = useState<LatLng | null>(PLACES.Lumley!);
  const [to, setTo] = useState<LatLng | null>(PLACES.Goderich!);
  const pricing = useDebounced(settings);
  const pins = useDebounced({ from, to });

  const { data: zones } = useListDeliveryZones();
  const areas = useMemo(
    () => (zones?.zones ?? []).filter((z) => z.isActive).map((z) => ({ name: z.name, boundary: z.boundary as unknown as ZoneOutline })),
    [zones],
  );

  const { data: preview, isFetching } = useQuery({
    queryKey: ['delivery-pricing', pricing, pins],
    queryFn: () => previewDeliveryPricing({ ...(pins.from && pins.to ? { from: pins.from, to: pins.to } : {}), pricing }),
    placeholderData: (previous) => previous,
  });

  const { data: examples } = useQuery({
    queryKey: ['delivery-pricing-examples', pricing],
    queryFn: () =>
      Promise.all(EXAMPLES.map(([a, b]) => previewDeliveryPricing({ from: PLACES[a]!, to: PLACES[b]!, pricing }))),
    placeholderData: (previous) => previous,
  });

  const quote = preview?.quote;
  const distance = preview?.distance;

  return (
    <HqLayout title="Delivery fee calculator">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/hq/delivery-zones" className="text-sm text-muted-foreground inline-flex items-center gap-1 mb-1">
              <ArrowLeft className="w-4 h-4" /> Delivery zones
            </Link>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Try numbers on the map before changing them on Delivery Zones. It starts with the numbers in force now; nothing here is saved or charged.
            </p>
          </div>
          <Badge variant="outline" className={touched ? 'text-amber-800 border-amber-300 bg-amber-50' : 'text-green-800 border-green-300 bg-green-50'} data-testid="badge-calculator-mode">
            {touched ? 'Trying new numbers · not saved' : 'Showing the live numbers'}
          </Badge>
        </div>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Your numbers</h2>
                <Button variant="ghost" size="sm" onClick={() => { setSettings(liveSettings ?? DEFAULTS); setTouched(false); }} data-testid="button-reset-pricing">
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Live numbers
                </Button>
              </div>
              {FIELDS.map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={f.key} className="flex items-baseline justify-between gap-2">
                    <span>{f.label}</span>
                    <span className="text-xs text-muted-foreground font-normal">{f.unit}</span>
                  </Label>
                  <Input
                    id={f.key}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={settings[f.key] ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const n = raw === '' ? null : Number(raw);
                      setTouched(true);
                      if (f.key === 'maxKm') setSettings({ ...settings, maxKm: n && n > 0 ? n : null });
                      else if (n != null && Number.isFinite(n) && n >= 0) setSettings({ ...settings, [f.key]: n });
                    }}
                    data-testid={`input-${f.key}`}
                  />
                  <p className="text-[11px] text-muted-foreground">{f.hint}</p>
                </div>
              ))}
              <p className="text-xs rounded-md bg-muted/60 p-2.5">
                Fuel works out at <b>{formatLeones(quote?.fuelPerKmLeones ?? settings.fuelPricePerLitre / settings.kmPerLitre)}</b> per km. The rider rides there and back, so each km of delivery uses twice that.
              </p>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center text-sm">
              <PlacePicker label="Pharmacy" colour="bg-[#0f8a6a]" value={from} onChange={setFrom} />
              <PlacePicker label="Patient" colour="bg-[#2563eb]" value={to} onChange={setTo} />
              <span className="text-xs text-muted-foreground">Or tap the map: first the pharmacy, then the patient. Drag a pin to move it.</span>
            </div>
            <TripMap from={from} to={to} onChange={(p) => { setFrom(p.from); setTo(p.to); }} areas={areas} height={360} />

            <Card data-testid="card-quote">
              <CardContent className="p-5">
                {!distance || !quote ? (
                  <p className="text-sm text-muted-foreground">Place both pins to price the trip.</p>
                ) : (
                  <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground flex items-center gap-1.5"><MapPin className="w-4 h-4" /> Distance</p>
                      <p className="text-3xl font-bold tabular-nums" data-testid="text-distance">{distance.km} km</p>
                      <p className="text-xs text-muted-foreground">
                        {distance.method === 'road'
                          ? 'By road (OpenStreetMap)'
                          : `Estimated: ${distance.straightKm} km in a straight line × 1.3 for the roads. Real road distance once the OpenStreetMap routing key is set.`}
                      </p>
                      {quote.available ? (
                        <>
                          <p className="text-sm text-muted-foreground pt-3">Patient pays</p>
                          <p className="text-4xl font-bold text-dark-green tabular-nums" data-testid="text-fee">{formatLeones(quote.feeLeones)}</p>
                        </>
                      ) : (
                        <p className="pt-3 text-sm font-medium text-amber-800">Too far for delivery (over {settings.maxKm} km): collection only.</p>
                      )}
                      {isFetching && <p className="text-xs text-muted-foreground">Updating…</p>}
                    </div>
                    {quote.available && <Breakdown q={quote} settings={pricing} />}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold">Example trips</h2>
            <p className="text-xs text-muted-foreground">Between approximate area centres, with your numbers above.</p>
            <QuoteTable
              rows={(examples ?? []).map((e, i) => ({ label: `${EXAMPLES[i]![0]} → ${EXAMPLES[i]![1]}`, quote: e.quote, estimated: e.distance?.method === 'estimate' }))}
              testId="table-examples"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold">Price by distance</h2>
            <QuoteTable rows={(preview?.table ?? []).map((q) => ({ label: `${q.km} km`, quote: q, estimated: false }))} testId="table-by-km" />
          </CardContent>
        </Card>
      </div>
    </HqLayout>
  );
}

function PlacePicker({ label, colour, value, onChange }: { label: string; colour: string; value: LatLng | null; onChange: (p: LatLng) => void }) {
  const current = Object.entries(PLACES).find(([, p]) => value && p.latitude === value.latitude && p.longitude === value.longitude)?.[0] ?? '';
  return (
    <label className="inline-flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5">
      <span className={`w-3 h-3 rounded-full ${colour}`} />
      <span className="font-medium">{label}</span>
      <select
        className="bg-transparent text-sm outline-none"
        value={current}
        onChange={(e) => { const p = PLACES[e.target.value]; if (p) onChange(p); }}
        data-testid={`select-${label.toLowerCase()}`}
      >
        <option value="">{value ? 'Pin on map' : 'Choose…'}</option>
        {Object.keys(PLACES).map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
    </label>
  );
}

function Breakdown({ q, settings }: { q: Extract<KmQuote, { feeLeones?: number }>; settings: KmPricingSettings }) {
  const share = settings.riderSharePercent;
  const line = (label: string, detail: string, amount: number | undefined, strong = false) => (
    <div className={`flex justify-between gap-3 ${strong ? 'font-semibold' : ''}`}>
      <span>{label}{detail && <span className="block text-xs text-muted-foreground font-normal">{detail}</span>}</span>
      <span className="tabular-nums shrink-0">{formatLeones(amount)}</span>
    </div>
  );
  return (
    <div className="space-y-4 text-sm" data-testid="breakdown">
      <div className="space-y-2">
        {line('Fuel', `2 × ${q.km} km × ${formatLeones(q.fuelPerKmLeones)} (there and back)`, q.fuelLeones)}
        {line('Pickup', '', q.pickupLeones)}
        {line('Distance charge', `${q.km} km × ${formatLeones(settings.serviceRatePerKm)}`, q.distanceChargeLeones)}
        {(q.roundingLeones ?? 0) > 0 && line('Rounding up', `to the next ${formatLeones(settings.roundToLeones)}`, q.roundingLeones)}
        <div className="border-t pt-2">{line('Patient pays', '', q.feeLeones, true)}</div>
      </div>
      <div className="space-y-2 rounded-lg bg-muted/50 p-3">
        <div className="flex justify-between gap-3 font-medium">
          <span className="flex items-center gap-1.5"><Bike className="w-4 h-4 text-primary" /> Rider gets</span>
          <span className="tabular-nums">{formatLeones(q.riderLeones)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          All the fuel ({formatLeones(q.fuelLeones)}) + {share}% of the service ({formatLeones(q.serviceLeones)})
        </p>
        <div className="flex justify-between gap-3 text-xs">
          <span className="flex items-center gap-1.5"><Fuel className="w-3.5 h-3.5" /> Rider keeps after fuel</span>
          <span className="tabular-nums font-medium">{formatLeones(q.riderKeepsLeones)}</span>
        </div>
        <div className="flex justify-between gap-3 font-medium border-t pt-2">
          <span>MobiCare keeps</span>
          <span className="tabular-nums">{formatLeones(q.mobicareLeones)}</span>
        </div>
      </div>
    </div>
  );
}

function QuoteTable({ rows, testId }: { rows: Array<{ label: string; quote: KmQuote | null | undefined; estimated: boolean }>; testId: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums" data-testid={testId}>
        <thead>
          <tr className="text-left text-xs text-muted-foreground border-b">
            <th className="py-2 pr-3 font-medium">Trip</th>
            <th className="py-2 px-3 font-medium text-right">Km</th>
            <th className="py-2 px-3 font-medium text-right">Fuel</th>
            <th className="py-2 px-3 font-medium text-right">Patient pays</th>
            <th className="py-2 px-3 font-medium text-right">Rider gets</th>
            <th className="py-2 px-3 font-medium text-right">Rider keeps</th>
            <th className="py-2 pl-3 font-medium text-right">MobiCare</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, quote: q, estimated }) => (
            <tr key={label} className="border-b last:border-0">
              <td className="py-2 pr-3">{label}</td>
              <td className="py-2 px-3 text-right">{q ? `${estimated ? '≈ ' : ''}${q.km}` : '—'}</td>
              {q?.available ? (
                <>
                  <td className="py-2 px-3 text-right">{formatLeones(q.fuelLeones)}</td>
                  <td className="py-2 px-3 text-right font-semibold">{formatLeones(q.feeLeones)}</td>
                  <td className="py-2 px-3 text-right">{formatLeones(q.riderLeones)}</td>
                  <td className="py-2 px-3 text-right">{formatLeones(q.riderKeepsLeones)}</td>
                  <td className="py-2 pl-3 text-right">{formatLeones(q.mobicareLeones)}</td>
                </>
              ) : (
                <td colSpan={5} className="py-2 px-3 text-right text-amber-800">{q ? 'Too far: collection only' : '…'}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
