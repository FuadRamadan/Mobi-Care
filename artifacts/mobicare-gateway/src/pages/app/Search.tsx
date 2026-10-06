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
import { Promotions } from "./Promotions";
import { categoryIcon, categoryLabel } from "@/patient/categories";

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

  /**
   * Whether the patient is looking for something specific.
   *
   * Keyed off the raw query rather than the debounced one, so the screen
   * responds on the first keystroke. Waiting for the debounce would leave a
   * promotion sitting there for a third of a second after someone has already
   * started searching.
   */
  const searching = query.trim().length > 0 || category !== "";

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
          Every Pharmacy in your pocket. Medicine Found, Lives Saved !!
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

      {/* Only while nobody is searching. On arrival this is the most valuable
          space on the screen; the moment someone types or picks a category it
          belongs to their results, and an advert in front of those is in the
          way. It renders nothing until HQ has published something. */}
      {!searching && <Promotions />}

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
        {groupByMedicine(results ?? []).map((medicine) => (
          <MedicineCard key={medicine.drugId} medicine={medicine} />
        ))}
      </div>

    </div>
  );
}

/**
 * One product a pharmacy sells: a strength and form of the medicine (the
 * search result it came from) in one brand or maker's generic (the offer).
 */
interface Option {
  listing: DrugSearchResult;
  offer: DrugOffer;
}

/** Everything one pharmacy sells of a medicine, across strengths, forms and brands. */
interface PharmacyOptions {
  pharmacyId: string;
  first: DrugOffer;
  options: Option[];
}

/** A medicine with every strength and form any pharmacy lists, shown as one card. */
interface Medicine {
  drugId: string;
  /** The first listing: name, tier, badges and limits are the same on all of them. */
  drug: DrugSearchResult;
  listings: DrugSearchResult[];
  pharmacies: PharmacyOptions[];
}

/**
 * The search returns one result per strength + form, each with its
 * pharmacies. Patients see one card per medicine instead, each pharmacy once,
 * with everything it sells of that medicine behind its options.
 */
function groupByMedicine(results: DrugSearchResult[]): Medicine[] {
  const medicines = new Map<string, Medicine>();
  for (const listing of results) {
    let medicine = medicines.get(listing.drugId);
    if (!medicine) {
      medicine = { drugId: listing.drugId, drug: listing, listings: [], pharmacies: [] };
      medicines.set(listing.drugId, medicine);
    }
    medicine.listings.push(listing);
    for (const offer of listing.offers) {
      let pharmacy = medicine.pharmacies.find((p) => p.pharmacyId === offer.pharmacyId);
      if (!pharmacy) {
        pharmacy = { pharmacyId: offer.pharmacyId, first: offer, options: [] };
        medicine.pharmacies.push(pharmacy);
      }
      pharmacy.options.push({ listing, offer });
    }
  }
  const cheapest = (pharmacy: PharmacyOptions) => Math.min(...pharmacy.options.map((o) => o.offer.priceLeones));
  for (const medicine of medicines.values()) {
    // Grouped by strength and form in the order the card lists them,
    // cheapest first within each.
    const position = (listing: DrugSearchResult) => medicine.listings.indexOf(listing);
    for (const pharmacy of medicine.pharmacies) {
      pharmacy.options.sort(
        (a, b) => position(a.listing) - position(b.listing) || a.offer.priceLeones - b.offer.priceLeones,
      );
    }
    // In order of price, as before: MobiCare does not steer a patient to a pharmacy.
    medicine.pharmacies.sort((a, b) => cheapest(a) - cheapest(b));
  }
  return [...medicines.values()];
}

function versionLabel(offer: DrugOffer): string {
  return offer.brand?.trim() || "Generic";
}

/** "500mg Tablet" */
function productLabel(listing: DrugSearchResult): string {
  return [listing.strength, listing.form].filter(Boolean).join(" ");
}

/** The strengths and forms on a card, shortened after a few. */
function productsLine(listings: DrugSearchResult[]): string {
  const labels = [...new Set(listings.map(productLabel))];
  return labels.length > 3 ? `${labels.slice(0, 3).join(" · ")} +${labels.length - 3} more` : labels.join(" · ");
}

/**
 * How many are in stock. Counts are per strength and form, never added up
 * across them: 80 packs of tablets and 12 bottles of syrup are not 92 of anything.
 */
function stockLine(options: Option[], severalProducts: boolean): string {
  const byProduct = new Map<string, number>();
  for (const { listing, offer } of options) {
    const label = productLabel(listing);
    byProduct.set(label, (byProduct.get(label) ?? 0) + Math.max(offer.stockQuantity, 0));
  }
  const total = [...byProduct.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) return "Out of stock";
  if (!severalProducts || byProduct.size === 1) return `${total} in stock`;
  return `In stock: ${[...byProduct].map(([label, count]) => `${label} (${count})`).join(" · ")}`;
}

function MedicineCard({ medicine }: { medicine: Medicine }) {
  const { addItem, cart } = useCart();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [openPharmacy, setOpenPharmacy] = useState<string | null>(null);
  const { drug, pharmacies } = medicine;
  const visible = expanded ? pharmacies : pharmacies.slice(0, 3);
  const severalProducts = new Set(medicine.listings.map(productLabel)).size > 1;

  function add({ listing, offer }: Option, replace = false) {
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
        drugId: listing.drugId,
        drugName: listing.name,
        strength: listing.strength,
        form: listing.form,
        unitOfSale: offer.unitOfSale,
        tier: listing.tier,
        maxUnitsPerOrder: listing.maxUnitsPerOrder ?? null,
        prescriptionRequired: listing.prescriptionRequired,
        collectionOnly: listing.collectionOnly,
        priceLeones: offer.priceLeones,
        brand: versionLabel(offer),
        manufacturer: offer.manufacturer ?? null,
        countryOfOrigin: offer.countryOfOrigin ?? null,
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
            onClick={() => add({ listing, offer }, true)}
            data-testid="button-replace-cart"
          >
            Start new cart
          </Button>
        ),
      });
      return;
    }
    toast({
      title: `${listing.name} ${productLabel(listing)} added`,
      description: `${versionLabel(offer)} from ${offer.pharmacyName} — ${formatLeones(offer.priceLeones)}`,
    });
  }

  return (
    <Card data-testid={`card-drug-${drug.drugId}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display font-semibold text-lg text-dark-green leading-tight">
              {drug.name}
            </h3>
            <p className="text-sm font-medium mt-0.5">{productsLine(medicine.listings)}</p>
            {drug.genericName && drug.genericName !== drug.name && (
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
          {visible.map(({ pharmacyId, first, options }) => {
            const many = options.length > 1;
            const isOpen = openPharmacy === pharmacyId;
            const prices = options.map((option) => option.offer.priceLeones);
            const totalStock = options.reduce((sum, option) => sum + Math.max(option.offer.stockQuantity, 0), 0);
            const stock = stockLine(options, severalProducts);
            const anyInStock = options.some((option) => option.offer.inStock);
            return (
              <div
                key={pharmacyId}
                className={`flex flex-col gap-3 p-3 ${!anyInStock ? "opacity-60 grayscale-[50%]" : ""}`}
                data-testid={`pharmacy-${drug.drugId}-${pharmacyId}`}
              >
                <div className="min-w-0">
                  <div className="font-bold text-base text-foreground flex items-center gap-2" data-testid="text-pharmacy-name">
                    {first.pharmacyName}
                    <span className={`w-2 h-2 rounded-full ${first.online ? 'bg-green-500' : 'bg-gray-300'}`} title={first.online ? 'Online' : 'Offline'} />
                  </div>
                  {first.pharmacyAddress && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {first.pharmacyAddress}
                    </div>
                  )}
                  {first.estimatedDistanceKm != null && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {first.estimatedDistanceKm.toFixed(1)} km away
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                    {options.some((option) => option.offer.availableForDelivery) && (
                      <span className="inline-flex items-center gap-1 text-primary">
                        <Truck className="w-3 h-3" /> Delivery
                      </span>
                    )}
                    {options.some((option) => option.offer.availableForCollection) && (
                      <span className="inline-flex items-center gap-1 text-primary">
                        <Store className="w-3 h-3" /> Collection
                      </span>
                    )}
                  </div>
                </div>

                {/* Every strength, form and brand this pharmacy sells of the
                    medicine, listed as they come with no option singled out:
                    MobiCare does not steer a patient towards a brand. */}
                {many ? (
                  <div className="rounded-lg border bg-background/60">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between gap-2 p-2.5 text-left"
                      onClick={() => setOpenPharmacy(isOpen ? null : pharmacyId)}
                      aria-expanded={isOpen}
                      data-testid={`button-options-${drug.drugId}-${pharmacyId}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {options.length} options
                          <span className="text-muted-foreground font-normal">
                            {" · "}
                            {formatLeones(Math.min(...prices))}
                            {Math.max(...prices) !== Math.min(...prices) && `–${formatLeones(Math.max(...prices)).replace(/^Le /, "")}`}
                          </span>
                        </span>
                        <span className={`block text-xs mt-0.5 ${totalStock > 0 ? "text-green-600" : "text-red-600"}`}>
                          {stock}
                        </span>
                      </span>
                      <span className="text-xs text-primary font-medium shrink-0">
                        {isOpen ? "Hide" : "See options"}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="divide-y border-t">
                        {options.map((option) => (
                          <OptionRow
                            key={option.offer.inventoryId}
                            offer={option.offer}
                            product={severalProducts ? productLabel(option.listing) : null}
                            onAdd={() => add(option)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border bg-background/60">
                    <OptionRow
                      offer={options[0]!.offer}
                      product={severalProducts ? productLabel(options[0]!.listing) : null}
                      onAdd={() => add(options[0]!)}
                    />
                  </div>
                )}

                {/* Payment always goes through MobiCare (Monime), so no pharmacy payment numbers here. */}
                <div className="text-xs bg-background/50 rounded-lg p-2 border border-border/50">
                  <div>
                    <span className="text-muted-foreground block mb-0.5">Contact</span>
                    {first.pharmacyPhone ? (
                      <a href={`tel:${first.pharmacyPhone}`} className="font-medium text-primary hover:underline">{first.pharmacyPhone}</a>
                    ) : (
                      <span className="text-muted-foreground italic">Not provided</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {pharmacies.length > 3 && (
          <button
            className="text-xs text-primary font-medium hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? "Show fewer pharmacies"
              : `Compare all ${pharmacies.length} pharmacies`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}

/** One version of the medicine at one pharmacy: what it is, what it costs, and Add. */
function OptionRow({
  offer,
  product,
  onAdd,
}: {
  offer: DrugOffer;
  /** The strength and form, when the medicine comes in more than one. */
  product: string | null;
  onAdd: () => void;
}) {
  const origin = [offer.manufacturer, offer.countryOfOrigin].filter(Boolean).join(" · ");
  return (
    <div className={`flex items-start justify-between gap-3 p-2.5 ${!offer.inStock ? "opacity-60" : ""}`}>
      <div className="min-w-0">
        {product && <div className="text-sm font-semibold text-dark-green">{product}</div>}
        <div className="text-sm font-medium">
          {versionLabel(offer) === "Generic" ? (
            <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">Generic</span>
          ) : (
            versionLabel(offer)
          )}
        </div>
        {origin && <div className="text-xs text-muted-foreground mt-0.5">{origin}</div>}
        <div className={`text-xs mt-0.5 ${offer.inStock ? "text-green-600" : "text-red-600"}`}>
          {offer.inStock ? `${offer.stockQuantity} in stock` : "Out of stock"}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-display font-bold text-dark-green">{formatLeones(offer.priceLeones)}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">per {offer.unitOfSale}</div>
        <Button
          size="sm"
          className="rounded-full mt-2 w-full"
          onClick={onAdd}
          disabled={!offer.inStock}
          variant={offer.inStock ? "default" : "secondary"}
          data-testid={`button-add-${offer.inventoryId}`}
        >
          {offer.inStock ? "Add to cart" : "Out of stock"}
        </Button>
      </div>
    </div>
  );
}
