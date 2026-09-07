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
  type DrugSubcategory,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCart } from "@/patient/cart";
import { formatLeones, EmptyState } from "@/pages/hq/shared";
import { PromotionsCarousel } from "./PromotionsCarousel";
import { categoryIcon, categoryLabel } from "@/patient/categories";
import { MobileMoneyLines } from "@/patient/MobileMoneyLines";

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
  const [subcategory, setSubcategory] = useState<DrugSubcategory | "">("");

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
    subcategory: subcategory || undefined,
    // The names the API documents. The route also still accepts lat/lng, which
    // is what this app used to send.
    ...(location
      ? { patientLatitude: location.lat, patientLongitude: location.lng }
      : {})
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

  const activeCategory = categories?.find((group) => group.value === category);

  /**
   * Tapping the selected category clears it, so there is always a way back to
   * everything without hunting for a separate control. Changing category drops
   * the subcategory, which would otherwise be a filter from the previous one —
   * the server rejects a mismatched pair, so this is correctness, not tidiness.
   */
  function chooseCategory(value: DrugPrimaryCategory) {
    setSubcategory("");
    setCategory((current) => (current === value ? "" : value));
  }

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

        {categories && categories.length > 0 && (
          <div className="space-y-2.5">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-medium">Browse by category</p>
              {category !== "" && (
                <button
                  type="button"
                  onClick={() => { setCategory(""); setSubcategory(""); }}
                  className="text-xs text-primary hover:underline underline-offset-2"
                  data-testid="button-clear-category"
                >
                  Clear
                </button>
              )}
            </div>

            {/* One scrolling row rather than a block that fills the screen.
                Browsing is a shortcut, not the main event — the space below
                belongs to what is being promoted. Bleeding into the page
                padding lets a tile sit half-cut at the edge, which is what
                tells you the row scrolls. */}
            <div
              className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none" }}
            >
              {categories.map((cat) => {
                const selected = category === cat.value;
                const Icon = categoryIcon(cat.value);
                return (
                  <button
                    key={cat.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => chooseCategory(cat.value)}
                    className={`shrink-0 w-[104px] h-[88px] rounded-xl border flex flex-col items-center justify-center gap-2 px-2 transition-colors ${
                      selected
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:bg-secondary/40"
                    }`}
                    data-testid={`tile-category-${cat.value}`}
                  >
                    <Icon
                      className={`w-5 h-5 shrink-0 ${selected ? "text-primary" : "text-primary/70"}`}
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <span
                      className={`text-[10.5px] leading-tight text-center line-clamp-2 ${
                        selected ? "font-semibold text-primary" : "text-foreground"
                      }`}
                    >
                      {categoryLabel(cat.value, cat.label)}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Subcategories appear only once a category is chosen: the full
                taxonomy is over forty entries, which is a list to get lost in
                rather than one to browse. */}
            {activeCategory && activeCategory.subcategories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={subcategory === "" ? "default" : "secondary"}
                  className="cursor-pointer transition-colors"
                  onClick={() => setSubcategory("")}
                >
                  All {categoryLabel(activeCategory.value, activeCategory.label).toLowerCase()}
                </Badge>
                {activeCategory.subcategories.map((sub) => (
                  <Badge
                    key={sub.value}
                    variant={subcategory === sub.value ? "default" : "secondary"}
                    className="cursor-pointer transition-colors"
                    onClick={() =>
                      setSubcategory((current) =>
                        current === sub.value ? "" : sub.value,
                      )
                    }
                    data-testid={`chip-subcategory-${sub.value}`}
                  >
                    {sub.label}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Promotions sit here, above the results, so they are on screen when
          someone arrives rather than buried under a search they have not run
          yet. It renders nothing until HQ has published something. */}
      <PromotionsCarousel />

      {/* Only once someone has started typing. On arrival the category grid is
          already the invitation, and a box below it saying "select a category"
          just repeats what is on screen. */}
      {!enabled && query.length > 0 && (
        <EmptyState>Keep typing — searches start at two letters.</EmptyState>
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
        mobileMoneyLines: offer.mobileMoneyLines ?? [],
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
                  <MobileMoneyLines
                    lines={offer.mobileMoneyLines}
                    accountName={offer.mobileMoneyAccountName}
                  />
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
