import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DrugOffer,
  DrugSearchResult,
  getPatientSearchDrugsQueryKey,
  usePatientSearchDrugs,
} from '@workspace/api-client-react';
import { useCart } from '@/context/CartContext';
import { useColors } from '@/hooks/useColors';
import { useDebounce } from '@/hooks/useDebounce';

const TIER_LABELS: Record<string, string> = { '1': 'Rx Only', '2': 'Rx Required', '3': 'OTC' };
const TIER_COLORS = (colors: ReturnType<typeof import('@/hooks/useColors').useColors>) => ({
  '1': colors.darkGreen,
  '2': colors.primary,
  '3': colors.mutedForeground,
});

function formatLeones(n: number) {
  return `Le ${n.toLocaleString()}`;
}

interface OfferRowProps {
  offer: DrugOffer;
  drug: DrugSearchResult;
  onAdd: (offer: DrugOffer) => void;
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
}

function OfferRow({ offer, drug, onAdd, colors }: OfferRowProps) {
  const s = makeStyles(colors, { top: 0, bottom: 0 });
  const canDeliver = offer.availableForDelivery && offer.inStock;
  const canCollect = offer.availableForCollection && offer.inStock;

  return (
    <View style={s.offerRow}>
      <View style={s.offerInfo}>
        <Text style={s.offerPharmacy} numberOfLines={1}>{offer.pharmacyName}</Text>
        <View style={s.offerTags}>
          {canDeliver && (
            <View style={[s.tag, { backgroundColor: colors.secondary }]}>
              <Feather name="truck" size={10} color={colors.primary} />
              <Text style={[s.tagText, { color: colors.primary }]}>Delivery</Text>
            </View>
          )}
          {canCollect && (
            <View style={[s.tag, { backgroundColor: colors.secondary }]}>
              <Feather name="shopping-bag" size={10} color={colors.primary} />
              <Text style={[s.tagText, { color: colors.primary }]}>Collection</Text>
            </View>
          )}
          {!offer.inStock && (
            <View style={[s.tag, { backgroundColor: '#FEE2E2' }]}>
              <Text style={[s.tagText, { color: colors.destructive }]}>Out of stock</Text>
            </View>
          )}
        </View>
      </View>
      <View style={s.offerRight}>
        <Text style={s.offerPrice}>{formatLeones(offer.priceLeones)}</Text>
        {offer.inStock ? (
          <TouchableOpacity
            style={s.addBtn}
            onPress={() => onAdd(offer)}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={18} color="#FFFFFF" />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

interface DrugCardProps {
  drug: DrugSearchResult;
  colors: ReturnType<typeof import('@/hooks/useColors').useColors>;
  onAddOffer: (drug: DrugSearchResult, offer: DrugOffer) => void;
}

function DrugCard({ drug, colors, onAddOffer }: DrugCardProps) {
  const [expanded, setExpanded] = useState(false);
  const s = makeStyles(colors, { top: 0, bottom: 0 });
  const tierColors = TIER_COLORS(colors);
  const visibleOffers = expanded ? drug.offers : drug.offers.slice(0, 2);
  const bestOffer = drug.offers.find((o) => o.inStock);

  return (
    <View style={s.drugCard}>
      <View style={s.drugHeader}>
        <View style={s.drugTitleRow}>
          <Text style={s.drugName}>{drug.name}</Text>
          <View style={[s.tierBadge, { backgroundColor: tierColors[drug.tier] ?? colors.mutedForeground }]}>
            <Text style={s.tierText}>{TIER_LABELS[drug.tier] ?? `Tier ${drug.tier}`}</Text>
          </View>
        </View>
        {drug.genericName ? <Text style={s.drugGeneric}>{drug.genericName}</Text> : null}
        <View style={s.drugMeta}>
          <Text style={s.drugUnit}>{drug.unit}</Text>
          {drug.prescriptionRequired && (
            <View style={s.rxBadge}>
              <MaterialCommunityIcons name="prescription" size={11} color={colors.accent} />
              <Text style={[s.tagText, { color: colors.accent }]}>Rx Required</Text>
            </View>
          )}
          {drug.collectionOnly && (
            <View style={[s.tag, { backgroundColor: '#FEF3C7' }]}>
              <Text style={[s.tagText, { color: '#92400E' }]}>Collection Only</Text>
            </View>
          )}
          {drug.maxUnitsPerOrder ? (
            <Text style={s.maxUnits}>Max {drug.maxUnitsPerOrder}/order</Text>
          ) : null}
        </View>
        {bestOffer && (
          <Text style={s.fromPrice}>From {formatLeones(bestOffer.priceLeones)}</Text>
        )}
      </View>

      <View style={s.divider} />

      {visibleOffers.map((offer) => (
        <OfferRow key={offer.inventoryId} offer={offer} drug={drug} onAdd={(o) => onAddOffer(drug, o)} colors={colors} />
      ))}

      {drug.offers.length > 2 && (
        <Pressable style={s.expandBtn} onPress={() => setExpanded((v) => !v)}>
          <Text style={s.expandText}>{expanded ? 'Show less' : `+${drug.offers.length - 2} more pharmacies`}</Text>
          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primary} />
        </Pressable>
      )}
    </View>
  );
}

export default function SearchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addItem, replaceCart, cart } = useCart();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 350);
  const isWeb = Platform.OS === 'web';

  const { data: drugs, isFetching, isError } = usePatientSearchDrugs(
    { q: debouncedQuery },
    {
      query: {
        queryKey: getPatientSearchDrugsQueryKey({ q: debouncedQuery }),
        enabled: debouncedQuery.trim().length >= 2,
      },
    }
  );

  const handleAddOffer = useCallback((drug: DrugSearchResult, offer: DrugOffer) => {
    const item = {
      drugId: drug.drugId,
      drugName: drug.name,
      inventoryId: offer.inventoryId,
      maxQuantity: drug.maxUnitsPerOrder ?? 999,
      priceLeones: offer.priceLeones,
      requiresPrescription: drug.prescriptionRequired,
      collectionOnly: drug.collectionOnly,
    };
    const ok = addItem(offer.pharmacyId, offer.pharmacyName, item);
    if (ok) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Alert.alert('Added to Cart', `${drug.name} from ${offer.pharmacyName} added.`, [
        { text: 'Continue', style: 'cancel' },
        { text: 'View Cart', onPress: () => router.push('/(tabs)/cart') },
      ]);
    } else {
      Alert.alert(
        'Replace Cart?',
        `Your cart has items from ${cart.pharmacyName}. Replace with items from ${offer.pharmacyName}?`,
        [
          { text: 'Keep Current', style: 'cancel' },
          {
            text: 'Replace',
            style: 'destructive',
            onPress: () => {
              replaceCart(offer.pharmacyId, offer.pharmacyName, item);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            },
          },
        ]
      );
    }
  }, [addItem, replaceCart, cart.pharmacyName]);

  const s = makeStyles(colors, insets);
  const topPad = isWeb ? insets.top + 67 : insets.top;

  const showEmpty = debouncedQuery.trim().length >= 2 && !isFetching && drugs?.length === 0;
  const showPrompt = debouncedQuery.trim().length < 2 && !isFetching;

  return (
    <View style={[s.container, { paddingTop: topPad }]}>
      {/* Search bar */}
      <View style={s.searchBar}>
        <Feather name="search" size={18} color={isFetching ? colors.primary : colors.mutedForeground} />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search medicines…"
          placeholderTextColor={colors.mutedForeground}
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        {query.length > 0 && Platform.OS !== 'ios' && (
          <Pressable onPress={() => setQuery('')}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {isError && (
        <View style={s.center}>
          <Feather name="alert-circle" size={40} color={colors.destructive} />
          <Text style={s.centerText}>Search failed. Check your connection.</Text>
        </View>
      )}

      {showPrompt && !isError && (
        <View style={s.center}>
          <MaterialCommunityIcons name="pill" size={56} color={colors.border} />
          <Text style={s.centerTitle}>Find Medicines</Text>
          <Text style={s.centerText}>Search by name or generic name to compare prices across pharmacies.</Text>
        </View>
      )}

      {showEmpty && (
        <View style={s.center}>
          <Feather name="search" size={40} color={colors.border} />
          <Text style={s.centerTitle}>No results</Text>
          <Text style={s.centerText}>No medicines found for "{debouncedQuery}"</Text>
        </View>
      )}

      <FlatList
        data={drugs ?? []}
        keyExtractor={(d) => d.drugId}
        renderItem={({ item }) => (
          <DrugCard drug={item} colors={colors} onAddOffer={handleAddOffer} />
        )}
        contentContainerStyle={[s.list, isWeb ? { paddingBottom: insets.bottom + 34 } : {}]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!!(drugs && drugs.length > 0)}
      />
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof import('@/hooks/useColors').useColors>, insets: { top: number; bottom: number }) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      marginHorizontal: 16,
      marginVertical: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: colors.radius,
      borderWidth: 1.5,
      borderColor: colors.border,
      gap: 10,
    },
    searchInput: { flex: 1, fontSize: 15, color: colors.foreground },
    list: { paddingHorizontal: 16, paddingBottom: 120, gap: 12 },
    drugCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius + 4,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    drugHeader: { padding: 16 },
    drugTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
    drugName: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.foreground },
    tierBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
    tierText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
    drugGeneric: { fontSize: 13, color: colors.mutedForeground, marginTop: 2 },
    drugMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' },
    drugUnit: { fontSize: 12, color: colors.mutedForeground, fontWeight: '500' },
    tag: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, gap: 3 },
    tagText: { fontSize: 11, fontWeight: '600' },
    rxBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    maxUnits: { fontSize: 11, color: colors.mutedForeground },
    fromPrice: { fontSize: 14, fontWeight: '600', color: colors.primary, marginTop: 6 },
    divider: { height: 1, backgroundColor: colors.border },
    offerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    offerInfo: { flex: 1, gap: 4 },
    offerPharmacy: { fontSize: 14, fontWeight: '600', color: colors.foreground },
    offerTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    offerRight: { alignItems: 'flex-end', gap: 6 },
    offerPrice: { fontSize: 15, fontWeight: '700', color: colors.darkGreen },
    addBtn: {
      backgroundColor: colors.primary,
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    expandBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, gap: 4 },
    expandText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 48, gap: 12 },
    centerTitle: { fontSize: 18, fontWeight: '700', color: colors.foreground, textAlign: 'center' },
    centerText: { fontSize: 14, color: colors.mutedForeground, textAlign: 'center', lineHeight: 20 },
  });
}
