import { useState, useEffect } from 'react';
import { Search as SearchIcon, ShieldAlert, FileText, Truck, Store } from 'lucide-react';
import {
  usePatientSearchDrugs,
  getPatientSearchDrugsQueryKey,
  type DrugSearchResult,
  type DrugOffer,
} from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useCart } from '@/patient/cart';
import { formatLeones, EmptyState } from '@/pages/hq/shared';

function useDebounced(value: string, ms = 350): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function PatientSearch() {
  const [query, setQuery] = useState('');
  const q = useDebounced(query);
  const enabled = q.trim().length >= 2;
  const { data: results, isFetching } = usePatientSearchDrugs(
    { q: q.trim() },
    { query: { enabled, queryKey: getPatientSearchDrugsQueryKey({ q: q.trim() }) } },
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display font-bold text-2xl text-dark-green mb-1">Find medicines</h1>
        <p className="text-sm text-muted-foreground">
          Compare prices across licensed pharmacies before you order.
        </p>
      </div>

      <div className="relative">
        <SearchIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search e.g. paracetamol, malaria, vitamin…"
          className="pl-10 h-12 rounded-full bg-card"
          data-testid="input-search"
        />
      </div>

      {!enabled && (
        <EmptyState>Type at least 2 letters to search the catalogue.</EmptyState>
      )}
      {enabled && isFetching && !results && (
        <EmptyState>Searching…</EmptyState>
      )}
      {enabled && results && results.length === 0 && (
        <EmptyState>No medicines matched “{q}”. Try the generic name.</EmptyState>
      )}

      <div className="space-y-4">
        {results?.map((drug) => (
          <DrugCard key={drug.drugId} drug={drug} />
        ))}
      </div>
    </div>
  );
}

function DrugCard({ drug }: { drug: DrugSearchResult }) {
  const { addItem, cart } = useCart();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const offers = expanded ? drug.offers : drug.offers.slice(0, 3);

  function add(offer: DrugOffer, replace = false) {
    const ok = addItem(
      { id: offer.pharmacyId, name: offer.pharmacyName, address: offer.pharmacyAddress ?? null },
      {
        drugId: drug.drugId,
        drugName: drug.name,
        unit: drug.unit,
        tier: drug.tier,
        maxUnitsPerOrder: drug.maxUnitsPerOrder ?? null,
        prescriptionRequired: drug.prescriptionRequired,
        collectionOnly: drug.collectionOnly,
        priceLeones: offer.priceLeones,
        availableForDelivery: offer.availableForDelivery,
        availableForCollection: offer.availableForCollection,
      },
      { replacePharmacy: replace },
    );
    if (!ok) {
      toast({
        title: `Your cart has items from ${cart?.pharmacyName}`,
        description: 'One order is placed with one pharmacy. Start a new cart with this pharmacy?',
        action: (
          <Button size="sm" variant="destructive" onClick={() => add(offer, true)} data-testid="button-replace-cart">
            Start new cart
          </Button>
        ),
      });
      return;
    }
    toast({ title: `${drug.name} added`, description: `From ${offer.pharmacyName} — ${formatLeones(offer.priceLeones)}` });
  }

  return (
    <Card data-testid={`card-drug-${drug.drugId}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-lg text-dark-green">{drug.name}</h3>
            {drug.genericName && (
              <p className="text-xs text-muted-foreground">{drug.genericName} · per {drug.unit}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {drug.prescriptionRequired && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800 gap-1">
                <FileText className="w-3 h-3" /> Prescription
              </Badge>
            )}
            {drug.collectionOnly && (
              <Badge variant="secondary" className="bg-red-100 text-red-800 gap-1">
                <ShieldAlert className="w-3 h-3" /> Collection + ID only
              </Badge>
            )}
          </div>
        </div>

        {drug.maxUnitsPerOrder != null && (
          <p className="text-xs text-muted-foreground">
            Limited to {drug.maxUnitsPerOrder} {drug.unit} per order.
          </p>
        )}

        <div className="divide-y rounded-xl border bg-secondary/30">
          {offers.map((offer, idx) => (
            <div key={offer.inventoryId} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{offer.pharmacyName}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                  {offer.availableForDelivery && (
                    <span className="inline-flex items-center gap-1"><Truck className="w-3 h-3" /> Delivery</span>
                  )}
                  {offer.availableForCollection && (
                    <span className="inline-flex items-center gap-1"><Store className="w-3 h-3" /> Collection</span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-display font-bold text-dark-green">
                  {formatLeones(offer.priceLeones)}
                  {idx === 0 && drug.offers.length > 1 && (
                    <span className="ml-1.5 text-[10px] font-sans font-semibold text-primary uppercase">Best</span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                className="rounded-full shrink-0"
                onClick={() => add(offer)}
                data-testid={`button-add-${drug.drugId}-${offer.pharmacyId}`}
              >
                Add
              </Button>
            </div>
          ))}
        </div>

        {drug.offers.length > 3 && (
          <button
            className="text-xs text-primary font-medium"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Show fewer pharmacies' : `Compare all ${drug.offers.length} pharmacies`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
