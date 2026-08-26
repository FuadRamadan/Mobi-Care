import React from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PatientOrder, getPatientListOrdersQueryKey, usePatientListOrders } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';

type StatusColor = { bg: string; text: string };

function statusStyle(status: string, colors: ReturnType<typeof import('@/hooks/useColors').useColors>): StatusColor {
  switch (status) {
    case 'awaiting_payment': return { bg: '#F3F4F6', text: '#6B7280' };
    case 'paid': return { bg: '#DBEAFE', text: '#1D4ED8' };
    case 'confirmed': return { bg: '#DBEAFE', text: '#1D4ED8' };
    case 'packaging': return { bg: '#FEF3C7', text: '#D97706' };
    case 'ready': return { bg: '#D1FAE5', text: '#065F46' };
    case 'assigned':
    case 'picked_up':
    case 'delivering': return { bg: '#FFF7ED', text: '#C2410C' };
    case 'delivered':
    case 'collected': return { bg: colors.secondary, text: colors.primary };
    case 'cancelled': return { bg: '#FEE2E2', text: colors.destructive };
    default: return { bg: '#F3F4F6', text: '#6B7280' };
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatLeones(n: number) {
  return `Le ${n.toLocaleString()}`;
}

function OrderCard({ order, colors }: { order: PatientOrder; colors: ReturnType<typeof import('@/hooks/useColors').useColors> }) {
  const s = makeStyles(colors);
  const st = statusStyle(order.status, colors);
  const names = order.items.map((i) => i.drugName).join(', ');

  return (
    <Pressable style={s.card} onPress={() => router.push(`/order/${order.id}`)}>
      <View style={s.cardHeader}>
        <View style={s.fulfillmentRow}>
          <Ionicons
            name={order.fulfillmentType === 'delivery' ? 'bicycle-outline' : 'storefront-outline'}
            size={16}
            color={colors.primary}
          />
          <Text style={s.fulfillmentText}>{order.fulfillmentType === 'delivery' ? 'Delivery' : 'Collection'}</Text>
        </View>
        <View style={[s.statusBadge, { backgroundColor: st.bg }]}>
          <Text style={[s.statusText, { color: st.text }]}>{statusLabel(order.status)}</Text>
        </View>
      </View>
      <Text style={s.itemNames} numberOfLines={2}>{names}</Text>
      <View style={s.cardFooter}>
        <View>
          <Text style={s.pharmacyName}>{(order as { pharmacy?: { name: string } }).pharmacy?.name ?? '—'}</Text>
          <Text style={s.orderDate}>{formatDate(order.createdAt)}</Text>
        </View>
        <View style={s.totalRow}>
          <Text style={s.totalText}>{formatLeones(order.totalLeones)}</Text>
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </View>
      </View>
    </Pressable>
  );
}

export default function OrdersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const topPad = isWeb ? insets.top + 67 : insets.top;

  const { data: orders, isFetching, isError, refetch } = usePatientListOrders({
    query: { queryKey: getPatientListOrdersQueryKey(), refetchInterval: 15_000 },
  });

  const s = makeStyles(colors);

  return (
    <View style={[s.container, { paddingTop: topPad }]}>
      <View style={s.titleRow}>
        <Text style={s.title}>Orders</Text>
        {isFetching && <Feather name="refresh-cw" size={16} color={colors.mutedForeground} />}
      </View>

      <FlatList
        data={orders ?? []}
        keyExtractor={(o) => o.id}
        renderItem={({ item }) => <OrderCard order={item} colors={colors} />}
        contentContainerStyle={[
          s.list,
          isWeb ? { paddingBottom: insets.bottom + 34 } : {},
          (orders ?? []).length === 0 ? s.listEmpty : {},
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!!(orders && orders.length > 0)}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />}
        ListEmptyComponent={
          !isFetching ? (
            <View style={s.empty}>
              <Ionicons name="receipt-outline" size={56} color={colors.border} />
              <Text style={s.emptyTitle}>{isError ? 'Could not load orders' : 'No orders yet'}</Text>
              <Text style={s.emptyBody}>{isError ? 'Check your connection and pull down to retry.' : 'Your orders will appear here after you checkout.'}</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof import('@/hooks/useColors').useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
    title: { fontSize: 26, fontWeight: '800', color: colors.darkGreen },
    list: { paddingHorizontal: 16, paddingBottom: 120, gap: 10 },
    listEmpty: { flex: 1 },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius + 4,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 10,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    fulfillmentRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    fulfillmentText: { fontSize: 13, fontWeight: '600', color: colors.primary },
    statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    statusText: { fontSize: 12, fontWeight: '700' },
    itemNames: { fontSize: 15, fontWeight: '600', color: colors.foreground, lineHeight: 20 },
    cardFooter: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
    pharmacyName: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    orderDate: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
    totalRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    totalText: { fontSize: 16, fontWeight: '800', color: colors.darkGreen },
    empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12, paddingHorizontal: 32 },
    emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.foreground },
    emptyBody: { fontSize: 14, color: colors.mutedForeground, textAlign: 'center' },
  });
}
