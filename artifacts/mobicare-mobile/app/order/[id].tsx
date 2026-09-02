import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  PatientOrder,
  getPatientGetOrderQueryKey,
  getPatientListOrdersQueryKey,
  useCancelPatientOrder,
  useConfirmPatientOrderReceipt,
  usePatientGetOrder,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { MobiCareHeader } from '@/components/MobiCareHeader';

type Colors = ReturnType<typeof import('@/hooks/useColors').useColors>;

function formatLeones(n: number) { return `Le ${n.toLocaleString()}`; }
function imageUrl(path: string) {
  return path.startsWith("http") ? path : `https://${process.env.EXPO_PUBLIC_DOMAIN}${path}`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Timeline ─────────────────────────────────────────────────────────────────

const DELIVERY_STEPS = [
  { key: 'awaiting_payment', label: 'Order Placed' },
  { key: 'paid', label: 'Payment Confirmed' },
  { key: 'confirmed', label: 'Pharmacy Confirmed' },
  { key: 'packaging', label: 'Being Packaged' },
  { key: 'ready', label: 'Ready for Pickup' },
  { key: 'assigned', label: 'Courier Assigned' },
  { key: 'picked_up', label: 'Picked Up' },
  { key: 'delivering', label: 'Out for Delivery' },
  { key: 'delivered', label: 'Delivered' },
];

const COLLECTION_STEPS = [
  { key: 'awaiting_payment', label: 'Order Placed' },
  { key: 'paid', label: 'Payment Confirmed' },
  { key: 'confirmed', label: 'Pharmacy Confirmed' },
  { key: 'packaging', label: 'Being Packaged' },
  { key: 'ready', label: 'Ready for Collection' },
  { key: 'collected', label: 'Collected' },
];

const STATUS_RANK: Record<string, number> = {
  awaiting_payment: 0, paid: 1, confirmed: 2, packaging: 3,
  ready: 4, assigned: 5, picked_up: 6, delivering: 7, delivered: 8,
  collected: 5, cancelled: -1,
};

function Timeline({ order, colors }: { order: PatientOrder; colors: Colors }) {
  const s = makeStyles(colors, { top: 0, bottom: 0 });
  const steps = order.fulfillmentType === 'collection' ? COLLECTION_STEPS : DELIVERY_STEPS;
  const currentRank = STATUS_RANK[order.status] ?? 0;
  const cancelled = order.status === 'cancelled';

  if (cancelled) {
    return (
      <View style={[s.section, { backgroundColor: '#FEE2E2' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="close-circle" size={24} color={colors.destructive} />
          <View>
            <Text style={[s.sectionTitle, { color: colors.destructive }]}>Order Cancelled</Text>
            <Text style={{ fontSize: 12, color: colors.mutedForeground }}>This order has been cancelled.</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Order Status</Text>
      {steps.map((step, idx) => {
        const stepRank = STATUS_RANK[step.key] ?? idx;
        const done = stepRank < currentRank || order.status === step.key;
        const active = order.status === step.key;
        const last = idx === steps.length - 1;

        return (
          <View key={step.key} style={s.timelineItem}>
            <View style={s.timelineLine}>
              <View style={[s.timelineDot, done ? s.dotDone : s.dotPending, active && s.dotActive]}>
                {done && !active ? <Feather name="check" size={10} color="#FFF" /> : null}
                {active ? <View style={s.dotPulse} /> : null}
              </View>
              {!last && <View style={[s.timelineConnector, done ? s.connectorDone : s.connectorPending]} />}
            </View>
            <Text style={[s.timelineLabel, done ? s.labelDone : s.labelPending, active && s.labelActive]}>
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Prescription ──────────────────────────────────────────────────────────────

function PrescriptionBlock({ order, colors }: { order: PatientOrder; colors: Colors }) {
  const s = makeStyles(colors, { top: 0, bottom: 0 });
  const prescription = (order as { prescription?: { id: string; status: string; rejectReason?: string | null } }).prescription;
  if (!prescription) return null;

  const statusConfig: Record<string, { icon: string; label: string; color: string; bg: string }> = {
    pending: { icon: 'time-outline', label: 'Prescription Under Review', color: '#D97706', bg: '#FEF3C7' },
    approved: { icon: 'checkmark-circle-outline', label: 'Prescription Approved', color: colors.primary, bg: colors.secondary },
    rejected: { icon: 'close-circle-outline', label: 'Prescription Rejected', color: colors.destructive, bg: '#FEE2E2' },
  };
  const cfg = statusConfig[prescription.status] ?? statusConfig.pending;

  return (
    <View style={[s.section, { backgroundColor: cfg.bg }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons name={cfg.icon as 'time-outline'} size={22} color={cfg.color} />
        <View style={{ flex: 1 }}>
          <Text style={[s.sectionTitle, { color: cfg.color }]}>{cfg.label}</Text>
          {prescription.rejectReason && (
            <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>
              Reason: {prescription.rejectReason.replace(/_/g, ' ')}
            </Text>
          )}
          {prescription.status === 'rejected' && (
            <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 4 }}>
              Please search again and upload a valid prescription to reorder.
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const queryClient = useQueryClient();

  const { data: order, isLoading, isError } = usePatientGetOrder(
    id ?? '',
    { query: { queryKey: getPatientGetOrderQueryKey(id ?? ''), refetchInterval: 10_000, enabled: !!id } }
  );
  const confirmReceipt = useConfirmPatientOrderReceipt({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData(getPatientGetOrderQueryKey(id ?? ''), updated);
        queryClient.invalidateQueries({ queryKey: getPatientListOrdersQueryKey() });
        Alert.alert('Receipt confirmed', 'Your order is now marked as delivered.');
      },
      onError: (error) => {
        Alert.alert(
          'Could not confirm receipt',
          error instanceof Error ? error.message : 'Please refresh and try again.',
        );
      },
    },
  });
  const cancelOrder = useCancelPatientOrder({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData(getPatientGetOrderQueryKey(id ?? ''), updated);
        queryClient.invalidateQueries({ queryKey: getPatientListOrdersQueryKey() });
        Alert.alert('Order cancelled', 'Your order has been cancelled.');
      },
      onError: (error) => {
        Alert.alert(
          'Could not cancel order',
          error instanceof Error ? error.message : 'Please refresh and try again.',
        );
      },
    },
  });

  const s = makeStyles(colors, insets);
  const topPad = isWeb ? insets.top + 67 : insets.top;

  if (isLoading) {
    return (
      <View style={[s.center, { paddingTop: topPad }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError || !order) {
    return (
      <View style={[s.center, { paddingTop: topPad }]}>
        <Feather name="alert-circle" size={40} color={colors.destructive} />
        <Text style={s.errorText}>Could not load order. Check your connection.</Text>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const pharmacy = (order as { pharmacy?: { id: string; name: string; address?: string | null; phone?: string | null } }).pharmacy;
  const courier = (order as { courier?: { id: string; name: string; phone?: string | null; photoUrl?: string | null } }).courier;
  const cancellableStatuses = ['awaiting_payment', 'paid', 'confirmed', 'packaging', 'ready'];
  const canCancel = !courier && cancellableStatuses.includes(order.status);
  const cancellationLocked = !!courier && ['assigned', 'picked_up', 'delivering'].includes(order.status);

  const callPhone = (phone: string) => {
    Linking.openURL(`tel:${phone}`).catch(() => {});
  };

  return (
    <ScrollView
      style={[s.container]}
      contentContainerStyle={[
        s.scrollContent,
        { paddingTop: topPad },
        isWeb ? { paddingBottom: insets.bottom + 34 } : {},
      ]}
      showsVerticalScrollIndicator={false}
    >
      <MobiCareHeader />
      {/* Back button */}
      <Pressable style={s.backRow} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={22} color={colors.darkGreen} />
        <Text style={s.backLabel}>Orders</Text>
      </Pressable>

      {/* Order ID */}
      <View style={s.orderHeader}>
        <View>
          <Text style={s.orderLabel}>Order</Text>
          <Text style={s.orderId}>#{order.id.slice(-8).toUpperCase()}</Text>
        </View>
        <View>
          <Text style={[s.orderDate, { textAlign: 'right' }]}>{formatDate(order.createdAt)}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
            <Ionicons
              name={order.fulfillmentType === 'delivery' ? 'bicycle-outline' : 'storefront-outline'}
              size={14}
              color={colors.primary}
            />
            <Text style={s.fulfillment}> {order.fulfillmentType === 'delivery' ? 'Delivery' : 'Collection'}</Text>
          </View>
        </View>
      </View>

      {/* Timeline */}
      <Timeline order={order} colors={colors} />

      {(canCancel || cancellationLocked) && (
        <View style={s.section} testID="card-cancel-order">
          <Text style={s.sectionTitle}>Order Cancellation</Text>
          <Text style={s.cancelHint}>
            {cancellationLocked
              ? 'A courier has been assigned, so this order can no longer be cancelled.'
              : 'You can cancel this order until a courier is assigned.'}
          </Text>
          <Pressable
            style={[
              s.cancelButton,
              (!canCancel || cancelOrder.isPending) && s.cancelButtonDisabled,
            ]}
            disabled={!canCancel || cancelOrder.isPending}
            testID="button-cancel-order"
            onPress={() =>
              Alert.alert(
                'Cancel this order?',
                'This action cannot be undone.',
                [
                  { text: 'Keep Order', style: 'cancel' },
                  {
                    text: 'Cancel Order',
                    style: 'destructive',
                    onPress: () => cancelOrder.mutate({ id: order.id }),
                  },
                ],
              )
            }
          >
            {cancelOrder.isPending ? (
              <ActivityIndicator size="small" color={colors.destructive} />
            ) : (
              <Text style={[s.cancelButtonText, !canCancel && s.cancelButtonTextDisabled]}>
                {cancellationLocked ? 'Cancellation Unavailable' : 'Cancel Order'}
              </Text>
            )}
          </Pressable>
        </View>
      )}

      {order.fulfillmentType === 'delivery' && order.status === 'delivering' && (
        <View style={[s.section, s.confirmSection]} testID="card-confirm-receipt">
          <View style={s.confirmHeader}>
            <Ionicons name="checkmark-done-circle-outline" size={24} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[s.sectionTitle, { marginBottom: 4 }]}>Have you received your order?</Text>
              <Text style={s.confirmHint}>
                Confirm only after the medicines are in your hands. This cannot be undone.
              </Text>
            </View>
          </View>
          <Pressable
            style={[s.confirmButton, confirmReceipt.isPending && { opacity: 0.6 }]}
            disabled={confirmReceipt.isPending}
            testID="button-confirm-receipt"
            onPress={() =>
              Alert.alert(
                'Confirm receipt?',
                'Only continue if you have received the medicines in this order.',
                [
                  { text: 'Not yet', style: 'cancel' },
                  {
                    text: 'Yes, I received it',
                    onPress: () => confirmReceipt.mutate({ id: order.id }),
                  },
                ],
              )
            }
          >
            {confirmReceipt.isPending ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={s.confirmButtonText}>Confirm Delivery</Text>
            )}
          </Pressable>
        </View>
      )}

      {/* Prescription */}
      <PrescriptionBlock order={order} colors={colors} />

      {/* Items */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Items</Text>
        {order.items.map((item) => (
          <View key={item.id} style={s.itemRow}>
            <Text style={s.itemName} numberOfLines={2}>{item.drugName}</Text>
            <View style={s.itemRight}>
              <Text style={s.itemQty}>×{item.quantity}</Text>
              <Text style={s.itemPrice}>{formatLeones(item.unitPriceLeones * item.quantity)}</Text>
            </View>
          </View>
        ))}
        <View style={s.totalRow}>
          <Text style={s.totalLabel}>Total</Text>
          <Text style={s.totalValue}>{formatLeones(order.totalLeones)}</Text>
        </View>
      </View>

      {/* Pharmacy info */}
      {pharmacy && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Pharmacy</Text>
          <View style={s.infoRow}>
            <Ionicons name="storefront-outline" size={16} color={colors.primary} />
            <Text style={s.infoText}>{pharmacy.name}</Text>
          </View>
          {pharmacy.address && (
            <View style={s.infoRow}>
              <Ionicons name="location-outline" size={16} color={colors.mutedForeground} />
              <Text style={[s.infoText, { color: colors.mutedForeground }]}>{pharmacy.address}</Text>
            </View>
          )}
          {pharmacy.phone && (
            <Pressable style={s.infoRow} onPress={() => callPhone(pharmacy.phone!)}>
              <Ionicons name="call-outline" size={16} color={colors.primary} />
              <Text style={[s.infoText, { color: colors.primary }]}>{pharmacy.phone}</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Delivery address */}
      {order.fulfillmentType === 'delivery' && (order as { deliveryAddress?: string | null }).deliveryAddress && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Delivery Address</Text>
          <View style={s.infoRow}>
            <Ionicons name="home-outline" size={16} color={colors.mutedForeground} />
            <Text style={[s.infoText, { color: colors.mutedForeground }]}>{(order as { deliveryAddress?: string }).deliveryAddress}</Text>
          </View>
        </View>
      )}

      {/* Courier info */}
      {courier && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Courier</Text>
          <View style={s.infoRow}>
            {courier.photoUrl ? (
              <Image source={{ uri: imageUrl(courier.photoUrl) }} style={s.courierPhoto} />
            ) : (
              <MaterialCommunityIcons name="motorbike" size={16} color={colors.primary} />
            )}
            <Text style={s.infoText}>{courier.name}</Text>
          </View>
          {courier.phone && (
            <Pressable style={s.infoRow} onPress={() => callPhone(courier.phone!)}>
              <Ionicons name="call-outline" size={16} color={colors.primary} />
              <Text style={[s.infoText, { color: colors.primary }]}>{courier.phone}</Text>
            </Pressable>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: Colors, insets: { top: number; bottom: number }) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scrollContent: { paddingBottom: 48, gap: 0 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 },
    errorText: { fontSize: 15, color: colors.mutedForeground, textAlign: 'center' },
    backBtn: { backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: colors.radius },
    backBtnText: { color: '#FFF', fontWeight: '600' },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
    backLabel: { fontSize: 16, color: colors.darkGreen, fontWeight: '600' },
    orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20, paddingVertical: 12 },
    orderLabel: { fontSize: 12, color: colors.mutedForeground, fontWeight: '500' },
    orderId: { fontSize: 22, fontWeight: '800', color: colors.darkGreen },
    orderDate: { fontSize: 12, color: colors.mutedForeground },
    fulfillment: { fontSize: 13, color: colors.primary, fontWeight: '600' },
    section: {
      backgroundColor: colors.card,
      marginHorizontal: 16,
      marginBottom: 12,
      borderRadius: colors.radius + 4,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 0,
    },
    sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.foreground, marginBottom: 12 },
    confirmSection: { borderColor: colors.primary, backgroundColor: colors.secondary },
    confirmHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    confirmHint: { fontSize: 12, color: colors.mutedForeground, lineHeight: 18 },
    confirmButton: {
      marginTop: 14,
      minHeight: 46,
      borderRadius: colors.radius,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
    },
    confirmButtonText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
    cancelHint: { fontSize: 13, color: colors.mutedForeground, lineHeight: 19, marginBottom: 12 },
    cancelButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: colors.radius, borderWidth: 1, borderColor: colors.destructive, backgroundColor: '#FFF5F5' },
    cancelButtonDisabled: { borderColor: colors.border, backgroundColor: colors.muted, opacity: 0.75 },
    cancelButtonText: { color: colors.destructive, fontSize: 14, fontWeight: '800' },
    cancelButtonTextDisabled: { color: colors.mutedForeground },
    // Timeline
    timelineItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 0 },
    timelineLine: { width: 20, alignItems: 'center' },
    timelineDot: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
    dotDone: { backgroundColor: colors.primary },
    dotPending: { backgroundColor: colors.border, borderWidth: 2, borderColor: colors.border },
    dotActive: { backgroundColor: colors.primary, shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
    dotPulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF' },
    timelineConnector: { width: 2, height: 28, marginTop: 0 },
    connectorDone: { backgroundColor: colors.primary },
    connectorPending: { backgroundColor: colors.border },
    timelineLabel: { flex: 1, fontSize: 14, paddingTop: 2, paddingBottom: 14 },
    labelDone: { color: colors.primary, fontWeight: '600' },
    labelPending: { color: colors.mutedForeground },
    labelActive: { color: colors.darkGreen, fontWeight: '700' },
    // Items
    itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 },
    itemName: { flex: 1, fontSize: 14, color: colors.foreground },
    itemRight: { alignItems: 'flex-end', gap: 2 },
    itemQty: { fontSize: 12, color: colors.mutedForeground },
    itemPrice: { fontSize: 14, fontWeight: '600', color: colors.foreground },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, marginTop: 4 },
    totalLabel: { fontSize: 15, fontWeight: '700', color: colors.foreground },
    totalValue: { fontSize: 16, fontWeight: '800', color: colors.darkGreen },
    // Info
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    courierPhoto: { width: 32, height: 32, borderRadius: 16 },
    infoText: { flex: 1, fontSize: 14, color: colors.foreground },
  });
}
