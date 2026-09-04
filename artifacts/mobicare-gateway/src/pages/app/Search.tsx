import { useState, useEffect } from "react";
import {
  Search as SearchIcon,
  ShieldAlert,
  FileText,
  Truck,
  Store,
  X,
} from "lucide-react";
import {
  usePatientSearchDrugs,
  getPatientSearchDrugsQueryKey,
  useListPatientDrugCategories,
  type DrugSearchResult,
  type DrugOffer,
  type DrugPrimaryCategory,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCart } from "@/patient/cart";
import { formatLeones, EmptyState } from "@/pages/hq/shared";

function useDebounced(value: string, ms = 350): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function PatientSearch() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<DrugPrimaryCategory | "">("");

  const q = useDebounced(query);
  const enabled = q.trim().length >= 2 || category !== "";

  const { data: categories } = useListPatientDrugCategories();

  const [location, setLocation] = useState<{lat: number, lng: number} | null>(null);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setLocation(null),
        { timeout: 5000, maximumAge: 300000 }
      );
    }
  }, []);

  const params = {
    q: q.trim() || undefined,
    category: category || undefined,
    ...(location ? { lat: location.lat, lng: location.lng } : {})
  };

  const { data: results, isFetching } = usePatientSearchDrugs(
    params,
    {
      query: {
        enabled,
        queryKey: getPatientSearchDrugsQueryKey(params),
      },
    },
  );

  // Keep this compact on first view; the selector exposes every appendix group.
  const popularCats = categories?.slice(0, 8) || [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display font-bold text-2xl text-dark-green mb-1">
          Find medicines
        </h1>
        <p className="text-sm text-muted-foreground">
          Compare prices across licensed pharmacies before you order.
        </p>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <SearchIcon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search e.g. paracetamol, malaria, vitamin…"
            className="pl-10 h-12 rounded-full bg-card pr-10"
            data-testid="input-search"
          />
          {query.length > 0 && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={category === "" ? "default" : "secondary"}
            className="cursor-pointer hover:bg-primary/80 transition-colors"
            onClick={() => setCategory("")}
          >
            All
          </Badge>
          {popularCats.map((cat) => (
            <Badge
              key={cat.value}
              variant={category === cat.value ? "default" : "secondary"}
              className="cursor-pointer hover:bg-primary/80 transition-colors"
              onClick={() => setCategory(cat.value)}
            >
              {cat.label}
            </Badge>
          ))}
          {categories && categories.flatMap((group) => group.subcategories).length > popularCats.length && (
            <Select
              value={category || "all"}
              onValueChange={(value) =>
                setCategory(
                  value === "all" ? "" : (value.split(":")[0] as DrugPrimaryCategory),
                )
              }
            >
              <SelectTrigger className="w-auto h-6 text-xs rounded-full border-dashed bg-secondary/50 px-3 shrink-0">
                <SelectValue placeholder="More categories..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.flatMap((group) =>
                  group.subcategories.map((subcategory) => (
                    <SelectItem key={`${group.value}:${subcategory.value}`} value={`${group.value}:${subcategory.value}`}>
                      {group.label} · {subcategory.label}
                    </SelectItem>
                  )),
                )}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {!enabled && (
        <EmptyState>
          Type at least 2 letters or select a category to search.
        </EmptyState>
      )}
      {enabled && isFetching && !results && <EmptyState>Searching…</EmptyState>}
      {enabled && results && results.length === 0 && (
        <EmptyState>
          No medicines matched your search. Try the generic name.
        </EmptyState>
      )}

      <div className="space-y-4">
        {results?.map((drug) => (
          <DrugCard key={drug.listingKey} drug={drug} />
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
      {
        id: offer.pharmacyId,
        name: offer.pharmacyName,
        address: offer.pharmacyAddress ?? null,
        mobileMoneyNumber: offer.mobileMoneyNumber,
        mobileMoneyProvider: offer.mobileMoneyProvider,
        mobileMoneyAccountName: offer.mobileMoneyAccountName,
      },
      {
        inventoryId: offer.inventoryId,
        drugId: drug.drugId,
        drugName: drug.name,
        strength: drug.strength,
        form: drug.form,
        unitOfSale: offer.unitOfSale,
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
        description:
          "One order is placed with one pharmacy. Start a new cart with this pharmacy?",
        action: (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => add(offer, true)}
            data-testid="button-replace-cart"
          >
            Start new cart
          </Button>
        ),
      });
      return;
    }
    toast({
      title: `${drug.name} added`,
      description: `From ${offer.pharmacyName} — ${formatLeones(offer.priceLeones)}`,
    });
  }

  return (
    <Card data-testid={`card-drug-${drug.listingKey}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-lg text-dark-green leading-tight">
              {drug.name}
            </h3>
            <p className="text-sm font-medium mt-0.5">
              {drug.strength} {drug.form}
            </p>
            {drug.genericName && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {drug.genericName}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {drug.prescriptionRequired && (
              <Badge
                variant="secondary"
                className="bg-amber-100 text-amber-800 gap-1 whitespace-nowrap"
              >
                <FileText className="w-3 h-3" /> Prescription
              </Badge>
            )}
            {drug.collectionOnly && (
              <Badge
                variant="secondary"
                className="bg-red-100 text-red-800 gap-1 whitespace-nowrap"
              >
                <ShieldAlert className="w-3 h-3" /> Collection + ID only
              </Badge>
            )}
          </div>
        </div>

        {drug.maxUnitsPerOrder != null && (
          <p className="text-xs text-muted-foreground">
            Limited to {drug.maxUnitsPerOrder} per order.
          </p>
        )}

        <div className="divide-y rounded-xl border bg-secondary/30">
          {offers.map((offer, idx) => (
            <div
              key={offer.inventoryId}
              className={`flex flex-col gap-3 p-3 ${!offer.inStock ? "opacity-60 grayscale-[50%]" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm flex items-center gap-2">
                    {offer.pharmacyName}
                    <span className={`w-2 h-2 rounded-full ${offer.online ? 'bg-green-500' : 'bg-gray-300'}`} title={offer.online ? 'Online' : 'Offline'} />
                  </div>
                  {offer.pharmacyAddress && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {offer.pharmacyAddress}
                    </div>
                  )}
                  {offer.estimatedDistanceKm != null && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {offer.estimatedDistanceKm.toFixed(1)} km away
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                    {offer.availableForDelivery && (
                      <span className="inline-flex items-center gap-1 text-primary">
                        <Truck className="w-3 h-3" /> Delivery
                      </span>
                    )}
                    {offer.availableForCollection && (
                      <span className="inline-flex items-center gap-1 text-primary">
                        <Store className="w-3 h-3" /> Collection
                      </span>
                    )}
                    <span className={`inline-flex items-center gap-1 ${offer.inStock ? 'text-green-600' : 'text-red-600'}`}>
                      {offer.inStock ? `${offer.stockQuantity} in stock` : 'Out of stock'}
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="font-display font-bold text-dark-green">
                    {formatLeones(offer.priceLeones)}
                    {idx === 0 && drug.offers.length > 1 && offer.inStock && (
                      <span className="ml-1.5 text-[10px] font-sans font-semibold text-primary uppercase">
                        Best
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    per {offer.unitOfSale}
                  </div>
                  <Button
                    size="sm"
                    className="rounded-full mt-2 w-full"
                    onClick={() => add(offer)}
                    disabled={!offer.inStock}
                    variant={offer.inStock ? "default" : "secondary"}
                    data-testid={`button-add-${drug.listingKey}-${offer.pharmacyId}`}
                  >
                    {offer.inStock ? "Add to cart" : "Out of stock"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs bg-background/50 rounded-lg p-2 border border-border/50">
                <div>
                  <span className="text-muted-foreground block mb-0.5">Contact</span>
                  {offer.pharmacyPhone ? (
                    <a href={`tel:${offer.pharmacyPhone}`} className="font-medium text-primary hover:underline">{offer.pharmacyPhone}</a>
                  ) : (
                    <span className="text-muted-foreground italic">Not provided</span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground block mb-0.5">Mobile Money</span>
                  {offer.mobileMoneyNumber ? (
                    <div>
                      <div className="flex items-center gap-1">
                        <span className="font-medium">{offer.mobileMoneyNumber}</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(offer.mobileMoneyNumber!);
                            toast({ title: 'Number copied' });
                          }}
                          className="text-primary hover:underline text-[10px]"
                        >
                          Copy
                        </button>
                      </div>
                      {(offer.mobileMoneyProvider || offer.mobileMoneyAccountName) && (
                        <div className="text-muted-foreground mt-0.5">
                          {offer.mobileMoneyProvider} {offer.mobileMoneyProvider && offer.mobileMoneyAccountName ? '·' : ''} {offer.mobileMoneyAccountName}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground italic">Not provided</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {drug.offers.length > 3 && (
          <button
            className="text-xs text-primary font-medium hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? "Show fewer pharmacies"
              : `Compare all ${drug.offers.length} pharmacies`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
