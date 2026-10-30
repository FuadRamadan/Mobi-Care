import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  type DrugOffer,
  type DrugPrimaryCategory,
  type DrugSearchResult,
  type DrugSubcategory,
  getListPatientPrescriptionRequestsQueryKey,
  getPatientSearchDrugsQueryKey,
  getPatientSuggestMedicineQueryKey,
  useListPatientDrugCategories,
  useListPatientPrescriptionRequests,
  usePatientSearchDrugs,
  usePatientSuggestMedicine,
} from "@workspace/api-client-react";
import { useCart } from "@/context/CartContext";
import { useColors } from "@/hooks/useColors";
import { useDebounce } from "@/hooks/useDebounce";
import { MobiCareHeader } from "@/components/MobiCareHeader";
import { AdCarousel } from "@/components/AdCarousel";
import { categoryIcon, categoryLabel } from "@/lib/categories";
import { confirmAction, notify } from "@/lib/dialogs";
import { formatLeones } from "@/lib/format";

type Colors = ReturnType<typeof useColors>;

export default function SearchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const s = makeStyles(colors);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<DrugPrimaryCategory | "">("");
  const [subcategory, setSubcategory] = useState<DrugSubcategory | "">("");
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const q = useDebounce(query, 350);
  const enabled = q.trim().length >= 2 || category !== "";
  // Keyed off the raw query, so promotions make way on the first keystroke.
  const searching = query.trim().length > 0 || category !== "";

  // Asked once, on opening: nearest pharmacies come first when we know where you are.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) return;
        const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }).catch(() => null);
        const position = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        if (!cancelled) setLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      } catch {
        // Search works without a location: cheapest first instead of nearest.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { data: categories } = useListPatientDrugCategories();
  const { data: requests } = useListPatientPrescriptionRequests({
    query: { queryKey: getListPatientPrescriptionRequestsQueryKey(), refetchInterval: 30_000 },
  });
  const activeRequest = requests?.find(
    (r) => r.status === "searching" || r.status === "out_of_range" || r.status === "accepted" || r.status === "ready",
  );

  const params = {
    q: q.trim() || undefined,
    category: category || undefined,
    subcategory: subcategory || undefined,
    ...(location ? { patientLatitude: location.latitude, patientLongitude: location.longitude } : {}),
  };
  const { data: results, isFetching, isError } = usePatientSearchDrugs(params, {
    query: { enabled, queryKey: getPatientSearchDrugsQueryKey(params) },
  });

  // "Did you mean …?": asked only once a typed search has come back empty.
  const suggestParams = { q: q.trim() };
  const { data: suggestionData } = usePatientSuggestMedicine(suggestParams, {
    query: {
      enabled: enabled && q.trim().length >= 4 && results?.length === 0,
      queryKey: getPatientSuggestMedicineQueryKey(suggestParams),
      staleTime: 60_000,
    },
  });
  const suggestion = results?.length === 0 ? suggestionData?.suggestion ?? null : null;
  const activeCategory = categories?.find((group) => group.value === category);

  /** Tapping the selected category clears it; changing it drops the subcategory. */
  function chooseCategory(value: DrugPrimaryCategory) {
    setSubcategory("");
    setCategory((current) => (current === value ? "" : value));
  }

  return (
    <View style={s.container}>
      <MobiCareHeader />
      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 110 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text style={s.title}>Find medicines</Text>
          <Text style={s.subtitle}>Every Pharmacy in your pocket. Medicine Found, Lives Saved !!</Text>
        </View>

        <View style={s.searchBar}>
          <Feather name="search" size={17} color={isFetching ? colors.primary : colors.mutedForeground} />
          <TextInput
            style={s.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search e.g. paracetamol, malaria, vitamin…"
            placeholderTextColor={colors.mutedForeground}
            autoCorrect={false}
            returnKeyType="search"
            testID="search-input"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8} testID="clear-search">
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>

        {!searching &&
          (activeRequest ? (
            <Pressable
              style={[
                s.rxCard,
                activeRequest.status === "ready" && s.rxCardReady,
                activeRequest.status === "out_of_range" && s.rxCardWarn,
              ]}
              onPress={() => router.push(`/prescription/${activeRequest.id}`)}
              testID="link-active-request"
            >
              <MaterialCommunityIcons name="camera-outline" size={22} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={s.rxTitle}>
                  {activeRequest.status === "ready"
                    ? "Your medicines are ready to order"
                    : activeRequest.status === "accepted"
                      ? `${activeRequest.pharmacy?.name ?? "A pharmacy"} is checking your prescription`
                      : activeRequest.status === "out_of_range"
                        ? "No pharmacy within delivery range took your prescription"
                        : "Looking for a pharmacy for your prescription"}
                </Text>
                <Text style={s.rxHint}>
                  {activeRequest.status === "out_of_range" ? "Tap to choose what to do next" : "Tap to see where it is"}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : (
            <Pressable style={[s.rxCard, s.rxCardDashed]} onPress={() => router.push("/prescription")} testID="link-send-prescription">
              <View style={s.rxIcon}>
                <MaterialCommunityIcons name="camera-outline" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rxTitle}>Upload prescription</Text>
                <Text style={s.rxHint}>Pharmacies near you check it and confirm your medicines</Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </Pressable>
          ))}

        {categories && categories.length > 0 ? (
          <View style={{ gap: 10 }}>
            <View style={s.rowBetween}>
              <Text style={s.label}>Browse by category</Text>
              {category !== "" ? (
                <Pressable
                  onPress={() => {
                    setCategory("");
                    setSubcategory("");
                  }}
                  hitSlop={8}
                  testID="button-clear-category"
                >
                  <Text style={s.link}>Clear</Text>
                </Pressable>
              ) : null}
            </View>
            {/* One scrolling row: browsing is a shortcut, not the main event. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.bleed} contentContainerStyle={s.tiles}>
              {categories.map((cat) => {
                const selected = category === cat.value;
                return (
                  <Pressable
                    key={cat.value}
                    style={[s.tile, selected && s.tileOn]}
                    onPress={() => chooseCategory(cat.value)}
                    accessibilityState={{ selected }}
                    testID={`tile-category-${cat.value}`}
                  >
                    <MaterialCommunityIcons
                      name={categoryIcon(cat.value)}
                      size={21}
                      color={selected ? colors.primary : "#4FA98C"}
                    />
                    <Text style={[s.tileText, selected && s.tileTextOn]} numberOfLines={2}>
                      {categoryLabel(cat.value, cat.label)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {activeCategory && activeCategory.subcategories.length > 0 ? (
              <View style={s.chips}>
                <Chip
                  label={`All ${categoryLabel(activeCategory.value, activeCategory.label).toLowerCase()}`}
                  on={subcategory === ""}
                  onPress={() => setSubcategory("")}
                  colors={colors}
                />
                {activeCategory.subcategories.map((sub) => (
                  <Chip
                    key={sub.value}
                    label={sub.label}
                    on={subcategory === sub.value}
                    onPress={() => setSubcategory((current) => (current === sub.value ? "" : sub.value))}
                    colors={colors}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Promotions only while nobody is searching; then the space is theirs. */}
        {!searching ? <AdCarousel /> : null}

        {!enabled && query.length > 0 ? <Empty text="Keep typing — searches start at two letters." colors={colors} /> : null}
        {enabled && isFetching && !results ? (
          <View style={s.empty}>
            <ActivityIndicator color={colors.primary} />
            <Text style={s.emptyText}>Searching…</Text>
          </View>
        ) : null}
        {enabled && isError ? <Empty text="Search failed. Check your connection." colors={colors} /> : null}
        {enabled && results && results.length === 0 ? (
          suggestion ? (
            <View style={s.empty}>
              <Text style={s.emptyText}>No medicines matched “{q.trim()}”.</Text>
              <Text style={s.emptyText}>
                Did you mean{" "}
                <Text style={s.suggestion} onPress={() => setQuery(suggestion.name)} testID="button-did-you-mean">
                  {suggestion.name}
                </Text>
                ?
              </Text>
            </View>
          ) : (
            <Empty text="No medicines matched your search. Try the generic name." colors={colors} />
          )
        ) : null}

        {enabled && results && results.length > 0 ? (
          <Text style={s.order} testID="text-result-order">
            {location
              ? "Nearest pharmacies first. You can order from any of them."
              : "Allow location to see the nearest pharmacies first. Showing the cheapest first."}
          </Text>
        ) : null}

        {enabled
          ? groupByMedicine(results ?? []).map((medicine) => (
              <MedicineCard key={medicine.drugId} medicine={medicine} colors={colors} />
            ))
          : null}
      </ScrollView>
    </View>
  );
}

function Chip({ label, on, onPress, colors }: { label: string; on: boolean; onPress: () => void; colors: Colors }) {
  const s = makeStyles(colors);
  return (
    <Pressable style={[s.chip, on && s.chipOn]} onPress={onPress}>
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Empty({ text, colors }: { text: string; colors: Colors }) {
  const s = makeStyles(colors);
  return (
    <View style={s.empty}>
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}

/** One product a pharmacy sells: a strength and form (the listing) in one brand or generic (the offer). */
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
  drug: DrugSearchResult;
  listings: DrugSearchResult[];
  pharmacies: PharmacyOptions[];
}

/**
 * The search returns one result per strength + form, each with its pharmacies.
 * Patients see one card per medicine instead, each pharmacy once (as on the web).
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
    const position = (listing: DrugSearchResult) => medicine.listings.indexOf(listing);
    for (const pharmacy of medicine.pharmacies) {
      pharmacy.options.sort(
        (a, b) => position(a.listing) - position(b.listing) || a.offer.priceLeones - b.offer.priceLeones,
      );
    }
    // Nearest first (medicine is needed fast, and nearer delivers sooner and for
    // less); without a location, cheapest first. Pharmacies not selling now
    // (signed out) come last either way.
    const away = (pharmacy: PharmacyOptions) => pharmacy.first.estimatedDistanceKm ?? Number.POSITIVE_INFINITY;
    medicine.pharmacies.sort(
      (a, b) =>
        Number(a.first.online === false) - Number(b.first.online === false) ||
        away(a) - away(b) ||
        cheapest(a) - cheapest(b),
    );
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

/** Stock per strength and form, never added up across them. */
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

function MedicineCard({ medicine, colors }: { medicine: Medicine; colors: Colors }) {
  const s = makeStyles(colors);
  const { addItem, cart } = useCart();
  const [expanded, setExpanded] = useState(false);
  const [openPharmacy, setOpenPharmacy] = useState<string | null>(null);
  const { drug, pharmacies } = medicine;
  const visible = expanded ? pharmacies : pharmacies.slice(0, 3);
  const severalProducts = new Set(medicine.listings.map(productLabel)).size > 1;

  async function add({ listing, offer }: Option, replace = false) {
    const ok = addItem(
      { id: offer.pharmacyId, name: offer.pharmacyName, address: offer.pharmacyAddress ?? null },
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
      const start = await confirmAction(
        `Your cart has items from ${cart?.pharmacyName}`,
        "One order is placed with one pharmacy. Start a new cart with this pharmacy?",
        { confirmText: "Start new cart", cancelText: "Keep my cart", destructive: true },
      );
      if (start) void add({ listing, offer }, true);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    notify(
      `${listing.name} ${productLabel(listing)} added`,
      `${versionLabel(offer)} from ${offer.pharmacyName} — ${formatLeones(offer.priceLeones)}`,
    );
  }

  return (
    <View style={s.card} testID={`card-drug-${drug.drugId}`}>
      <View style={s.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={s.drugName}>{drug.name}</Text>
          <Text style={s.products}>{productsLine(medicine.listings)}</Text>
          {drug.genericName && drug.genericName !== drug.name ? <Text style={s.generic}>{drug.genericName}</Text> : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          {drug.prescriptionRequired ? (
            <View style={[s.badge, { backgroundColor: "#FEF3C7" }]}>
              <Feather name="file-text" size={11} color="#92400E" />
              <Text style={[s.badgeText, { color: "#92400E" }]}>Prescription</Text>
            </View>
          ) : null}
          {drug.collectionOnly ? (
            <View style={[s.badge, { backgroundColor: "#FEE2E2" }]}>
              <Feather name="shield" size={11} color="#991B1B" />
              <Text style={[s.badgeText, { color: "#991B1B" }]}>Collection + ID only</Text>
            </View>
          ) : null}
        </View>
      </View>
      {drug.maxUnitsPerOrder != null ? <Text style={s.limit}>Limited to {drug.maxUnitsPerOrder} per order.</Text> : null}

      <View style={s.pharmacies}>
        {visible.map(({ pharmacyId, first, options }, index) => {
          const many = options.length > 1;
          const isOpen = openPharmacy === pharmacyId;
          const prices = options.map((option) => option.offer.priceLeones);
          const totalStock = options.reduce((sum, option) => sum + Math.max(option.offer.stockQuantity, 0), 0);
          const anyInStock = options.some((option) => option.offer.inStock);
          const selling = first.online !== false;
          return (
            <View
              key={pharmacyId}
              style={[s.pharmacy, index > 0 && s.pharmacyBorder, (!anyInStock || !selling) && { opacity: 0.6 }]}
              testID={`pharmacy-${drug.drugId}-${pharmacyId}`}
            >
              <View style={s.nameRow}>
                <Text style={s.pharmacyName}>{first.pharmacyName}</Text>
                {selling ? (
                  <View style={s.onlineDot} accessibilityLabel="Selling now" />
                ) : (
                  <View style={s.notSelling} testID={`badge-not-selling-${pharmacyId}`}>
                    <Text style={s.notSellingText}>Not selling now</Text>
                  </View>
                )}
              </View>
              {first.pharmacyAddress ? <Text style={s.meta}>{first.pharmacyAddress}</Text> : null}
              {first.estimatedDistanceKm != null ? (
                <Text style={s.meta}>{first.estimatedDistanceKm.toFixed(1)} km away</Text>
              ) : null}
              <View style={s.ways}>
                {options.some((o) => o.offer.availableForDelivery) ? (
                  <View style={s.way}>
                    <Feather name="truck" size={12} color={colors.primary} />
                    <Text style={s.wayText}>Delivery</Text>
                  </View>
                ) : null}
                {options.some((o) => o.offer.availableForCollection) ? (
                  <View style={s.way}>
                    <Feather name="shopping-bag" size={12} color={colors.primary} />
                    <Text style={s.wayText}>Collection</Text>
                  </View>
                ) : null}
              </View>

              {/* Every strength, form and brand, listed as they come: MobiCare does not steer a patient to a brand. */}
              <View style={s.optionsBox}>
                {many ? (
                  <>
                    <Pressable
                      style={s.optionsToggle}
                      onPress={() => setOpenPharmacy(isOpen ? null : pharmacyId)}
                      testID={`button-options-${drug.drugId}-${pharmacyId}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={s.optionsTitle}>
                          {options.length} options
                          <Text style={s.optionsRange}>
                            {" · "}
                            {formatLeones(Math.min(...prices))}
                            {Math.max(...prices) !== Math.min(...prices)
                              ? `–${formatLeones(Math.max(...prices)).replace(/^Le /, "")}`
                              : ""}
                          </Text>
                        </Text>
                        <Text style={[s.stock, { color: totalStock > 0 ? "#16A34A" : colors.destructive }]}>
                          {stockLine(options, severalProducts)}
                        </Text>
                      </View>
                      <Text style={s.link}>{isOpen ? "Hide" : "See options"}</Text>
                    </Pressable>
                    {isOpen
                      ? options.map((option) => (
                          <OptionRow
                            key={option.offer.inventoryId}
                            offer={option.offer}
                            product={severalProducts ? productLabel(option.listing) : null}
                            selling={selling}
                            onAdd={() => void add(option)}
                            colors={colors}
                            divided
                          />
                        ))
                      : null}
                  </>
                ) : (
                  <OptionRow
                    offer={options[0]!.offer}
                    product={severalProducts ? productLabel(options[0]!.listing) : null}
                    selling={selling}
                    onAdd={() => void add(options[0]!)}
                    colors={colors}
                  />
                )}
              </View>

              {/* Payment always goes through MobiCare (Monime), so no pharmacy payment numbers here. */}
              <View style={s.contact}>
                <Text style={s.contactLabel}>Contact</Text>
                {first.pharmacyPhone ? (
                  <Text style={s.contactPhone} onPress={() => void Linking.openURL(`tel:${first.pharmacyPhone}`)}>
                    {first.pharmacyPhone}
                  </Text>
                ) : (
                  <Text style={s.contactNone}>Not provided</Text>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {pharmacies.length > 3 ? (
        <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={6}>
          <Text style={s.link}>{expanded ? "Show fewer pharmacies" : `Compare all ${pharmacies.length} pharmacies`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** One version of the medicine at one pharmacy: what it is, what it costs, and Add. */
function OptionRow({
  offer,
  product,
  selling,
  onAdd,
  colors,
  divided,
}: {
  offer: DrugOffer;
  product: string | null;
  /** False when the pharmacy is signed out: listed, but not taking orders. */
  selling: boolean;
  onAdd: () => void;
  colors: Colors;
  divided?: boolean;
}) {
  const s = makeStyles(colors);
  const origin = [offer.manufacturer, offer.countryOfOrigin].filter(Boolean).join(" · ");
  const canAdd = offer.inStock && selling;
  return (
    <View style={[s.option, divided && s.optionDivided, !offer.inStock && { opacity: 0.6 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        {product ? <Text style={s.optionProduct}>{product}</Text> : null}
        {versionLabel(offer) === "Generic" ? (
          <View style={s.generic2}>
            <Text style={s.generic2Text}>Generic</Text>
          </View>
        ) : (
          <Text style={s.brand}>{versionLabel(offer)}</Text>
        )}
        {origin ? <Text style={s.meta}>{origin}</Text> : null}
        <Text style={[s.stock, { color: offer.inStock ? "#16A34A" : colors.destructive }]}>
          {offer.inStock ? `${offer.stockQuantity} in stock` : "Out of stock"}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", width: 118 }}>
        <Text style={s.price}>{formatLeones(offer.priceLeones)}</Text>
        <Text style={s.per}>per {offer.unitOfSale}</Text>
        <Pressable
          style={[s.add, !canAdd && s.addOff]}
          onPress={onAdd}
          disabled={!canAdd}
          testID={`add-offer-${offer.inventoryId}`}
        >
          <Text style={[s.addText, !canAdd && s.addTextOff]}>
            {!selling ? "Not selling now" : offer.inStock ? "Add to cart" : "Out of stock"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 16 },
    title: { fontSize: 24, fontWeight: "700", color: colors.darkGreen },
    subtitle: { fontSize: 13, color: colors.mutedForeground, marginTop: 2 },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.card,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
      height: 48,
    },
    searchInput: { flex: 1, fontSize: 15, color: colors.foreground, height: "100%" },
    rxCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 12,
    },
    rxCardDashed: { borderStyle: "dashed", borderColor: "#8CC9B5" },
    rxCardReady: { borderColor: colors.primary, backgroundColor: "#E8F5EF" },
    rxCardWarn: { borderColor: "#FCD34D", backgroundColor: "#FFFBEB" },
    rxIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: "#E8F5EF",
      alignItems: "center",
      justifyContent: "center",
    },
    rxTitle: { fontSize: 14, fontWeight: "600", color: colors.foreground },
    rxHint: { fontSize: 12, color: colors.mutedForeground, marginTop: 1 },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
    label: { fontSize: 14, fontWeight: "600", color: colors.foreground },
    link: { fontSize: 12.5, color: colors.primary, fontWeight: "600" },
    bleed: { marginHorizontal: -16 },
    tiles: { paddingHorizontal: 16, gap: 8 },
    tile: {
      width: 104,
      height: 88,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      paddingHorizontal: 6,
    },
    tileOn: { borderColor: colors.primary, backgroundColor: "#E8F5EF" },
    tileText: { fontSize: 10.5, lineHeight: 13, textAlign: "center", color: colors.foreground },
    tileTextOn: { color: colors.primary, fontWeight: "700" },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "#E8EEEB" },
    chipOn: { backgroundColor: colors.primary },
    chipText: { fontSize: 12, fontWeight: "600", color: colors.foreground },
    chipTextOn: { color: "#FFFFFF" },
    empty: {
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.border,
      borderRadius: 16,
      padding: 24,
      alignItems: "center",
      gap: 6,
    },
    emptyText: { fontSize: 14, color: colors.mutedForeground, textAlign: "center", lineHeight: 20 },
    suggestion: { fontWeight: "700", color: colors.primary, textDecorationLine: "underline" },
    order: { fontSize: 12, color: colors.mutedForeground },
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      gap: 12,
    },
    cardHead: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
    drugName: { fontSize: 18, fontWeight: "700", color: colors.darkGreen },
    products: { fontSize: 13.5, fontWeight: "600", color: colors.foreground, marginTop: 2 },
    generic: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
    badge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
    },
    badgeText: { fontSize: 11, fontWeight: "600" },
    limit: { fontSize: 12, color: colors.mutedForeground },
    pharmacies: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: "#F3F8F6" },
    pharmacy: { padding: 12, gap: 6 },
    pharmacyBorder: { borderTopWidth: 1, borderTopColor: colors.border },
    nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
    pharmacyName: { fontSize: 15, fontWeight: "700", color: colors.foreground },
    onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#22C55E" },
    notSelling: { backgroundColor: "#E5E7EB", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    notSellingText: { fontSize: 11, fontWeight: "600", color: "#374151" },
    meta: { fontSize: 12, color: colors.mutedForeground },
    ways: { flexDirection: "row", gap: 12, marginTop: 2 },
    way: { flexDirection: "row", alignItems: "center", gap: 4 },
    wayText: { fontSize: 12, color: colors.primary },
    optionsBox: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: "rgba(255,255,255,0.7)",
      marginTop: 4,
    },
    optionsToggle: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10 },
    optionsTitle: { fontSize: 14, fontWeight: "600", color: colors.foreground },
    optionsRange: { fontWeight: "400", color: colors.mutedForeground },
    stock: { fontSize: 12, marginTop: 1 },
    option: { flexDirection: "row", gap: 12, padding: 10, alignItems: "flex-start" },
    optionDivided: { borderTopWidth: 1, borderTopColor: colors.border },
    optionProduct: { fontSize: 14, fontWeight: "700", color: colors.darkGreen },
    brand: { fontSize: 14, fontWeight: "600", color: colors.foreground },
    generic2: { alignSelf: "flex-start", backgroundColor: "#E8EEEB", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    generic2Text: { fontSize: 11.5, fontWeight: "600", color: colors.foreground },
    price: { fontSize: 16, fontWeight: "700", color: colors.darkGreen },
    per: { fontSize: 11, color: colors.mutedForeground, marginTop: 1 },
    add: {
      marginTop: 8,
      alignSelf: "stretch",
      backgroundColor: colors.primary,
      borderRadius: 999,
      paddingVertical: 7,
      alignItems: "center",
    },
    addOff: { backgroundColor: "#E8EEEB" },
    addText: { color: "#FFFFFF", fontSize: 12.5, fontWeight: "700" },
    addTextOff: { color: colors.mutedForeground },
    contact: {
      borderWidth: 1,
      borderColor: "rgba(217,226,222,0.7)",
      borderRadius: 10,
      backgroundColor: "rgba(255,255,255,0.5)",
      padding: 8,
    },
    contactLabel: { fontSize: 11.5, color: colors.mutedForeground, marginBottom: 1 },
    contactPhone: { fontSize: 13, fontWeight: "600", color: colors.primary },
    contactNone: { fontSize: 12.5, color: colors.mutedForeground, fontStyle: "italic" },
  });
}
