import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPatientPrescriptionRequestQueryKey,
  type PatientPrescriptionRequest,
  type PrescriptionRequestDelivery,
  useAskPrescriptionRequestFurther,
  useCancelPrescriptionRequest,
  useGetPatientPrescriptionRequest,
} from "@workspace/api-client-react";
import { MobiCareHeader } from "@/components/MobiCareHeader";
import { useCart } from "@/context/CartContext";
import { useColors } from "@/hooks/useColors";
import { notify } from "@/lib/dialogs";
import { errorText, formatLeones } from "@/lib/format";

type Colors = ReturnType<typeof useColors>;

const REJECT_REASONS: Record<string, string> = {
  illegible_image: "The photo could not be read clearly.",
  expired_prescription: "The prescription has expired.",
  invalid_prescription: "The prescription could not be accepted.",
  drug_unavailable: "The pharmacy does not have these medicines.",
  controlled_substance_not_authorized: "It includes a controlled medicine this pharmacy cannot dispense.",
  patient_mismatch: "The prescription appears to be for someone else.",
  quantity_exceeded: "The quantity is more than is allowed.",
};

/** "4:12" until the given time, ticking every second; null once it has passed. */
function useCountdown(until: string | null | undefined): string | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const ms = new Date(until).getTime() - now;
  if (ms <= 0) return null;
  const sec = Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** Follow a prescription sent to the pharmacies nearby, and order once it is confirmed (as on the web app). */
export default function PrescriptionStatusScreen() {
  const colors = useColors();
  const s = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const { data: request, isLoading } = useGetPatientPrescriptionRequest(id, {
    query: {
      enabled: Boolean(id),
      queryKey: getGetPatientPrescriptionRequestQueryKey(id),
      // Poll while a pharmacy may still act on it.
      refetchInterval: (q) => {
        const status = (q.state.data as PatientPrescriptionRequest | undefined)?.status;
        return status === "searching" || status === "accepted" ? 5000 : status === "out_of_range" ? 30_000 : false;
      },
    },
  });

  return (
    <View style={s.container}>
      <MobiCareHeader />
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}>
        <View>
          <Pressable onPress={() => router.navigate("/(tabs)")} style={s.back} hitSlop={8}>
            <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
            <Text style={s.backText}>Search</Text>
          </Pressable>
          <Text style={s.title}>Your prescription</Text>
          {request ? (
            <Text style={s.meta}>
              Sent{" "}
              {new Date(request.createdAt).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {request.areaName ? ` · ${request.areaName}` : ""}
            </Text>
          ) : null}
        </View>
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
        ) : !request ? (
          <View style={s.card}>
            <Text style={[s.meta, { textAlign: "center" }]}>This prescription request was not found.</Text>
          </View>
        ) : (
          <StatusBody request={request} colors={colors} />
        )}
      </ScrollView>
    </View>
  );
}

/** What delivery from the pharmacy that took it costs, so the patient knows before ordering. */
function DeliveryLine({ delivery, colors }: { delivery: PrescriptionRequestDelivery | null | undefined; colors: Colors }) {
  const s = makeStyles(colors);
  if (!delivery) return null;
  const km =
    delivery.distanceKm == null ? null : delivery.distanceEstimated ? `about ${delivery.distanceKm} km` : `${delivery.distanceKm} km by road`;
  return (
    <View style={[s.card, { flexDirection: "row", gap: 10 }]} testID="request-delivery">
      {delivery.available ? (
        <MaterialCommunityIcons name="bike" size={20} color={colors.primary} />
      ) : (
        <Feather name="map-pin" size={18} color="#D97706" />
      )}
      <View style={{ flex: 1 }}>
        {delivery.available ? (
          <>
            <Text style={s.bold}>
              Delivery {formatLeones(delivery.feeLeones ?? 0)}
              {km ? ` · ${km}` : ""}
            </Text>
            <Text style={s.meta}>To where you sent your prescription from. Or collect it from the pharmacy at no delivery charge.</Text>
          </>
        ) : (
          <>
            <Text style={s.bold}>Collection only</Text>
            <Text style={s.meta}>{delivery.message}</Text>
          </>
        )}
      </View>
    </View>
  );
}

function StatusBody({ request, colors }: { request: PatientPrescriptionRequest; colors: Colors }) {
  const s = makeStyles(colors);
  const queryClient = useQueryClient();
  const cancel = useCancelPrescriptionRequest();
  const further = useAskPrescriptionRequestFurther();
  const { cart, startFromRequest, clear } = useCart();
  const left = useCountdown(request.status === "searching" ? request.roundEndsAt : null);
  const choiceLeft = useCountdown(request.status === "out_of_range" ? request.choiceEndsAt : null);

  async function onAskFurther() {
    try {
      await further.mutateAsync({ id: request.id });
    } catch (err) {
      notify("Not sent", errorText(err, "Try again."));
    }
    await queryClient.invalidateQueries();
  }

  async function onCancel() {
    try {
      await cancel.mutateAsync({ id: request.id });
      if (cart?.prescriptionRequestId === request.id) clear();
      await queryClient.invalidateQueries();
    } catch (err) {
      notify("Not cancelled", errorText(err, "Try again."));
    }
  }

  const cancelButton = (
    <Pressable style={s.ghost} disabled={cancel.isPending} onPress={() => void onCancel()} testID="button-cancel-request">
      <Text style={s.ghostText}>Cancel this request</Text>
    </Pressable>
  );

  switch (request.status) {
    case "searching":
      return (
        <>
          <View style={[s.card, s.center]} testID="status-searching">
            <View style={s.bigIcon}>
              <MaterialCommunityIcons name="storefront-outline" size={28} color={colors.primary} />
            </View>
            <Text style={s.heading}>Looking for a pharmacy</Text>
            <Text style={[s.body, { textAlign: "center" }]}>
              {request.collectionOnly
                ? "Pharmacies beyond delivery range can see your prescription now. You'll collect from the one that takes it."
                : request.round <= 1
                  ? "The pharmacies nearest to you can see your prescription now."
                  : "No one nearby took it yet, so pharmacies a little further away can see it now. All of them can deliver to you."}
            </Text>
            <Text style={s.meta}>
              {request.collectionOnly ? "Pharmacies further away" : `Search ${request.round} of ${request.maxRounds}`}
              {left ? (request.round >= request.maxRounds ? ` · ends in ${left}` : ` · widening in ${left}`) : ""}
            </Text>
          </View>
          <Text style={[s.meta, { textAlign: "center" }]}>
            We'll send you a notification when a pharmacy takes it. You can leave this screen.
          </Text>
          {cancelButton}
        </>
      );

    case "out_of_range":
      return (
        <>
          <View style={[s.card, s.center]} testID="status-out-of-range">
            <Feather name="map-pin" size={30} color="#D97706" />
            <Text style={s.heading}>No pharmacy within delivery range took it</Text>
            <Text style={[s.body, { textAlign: "center" }]}>
              Pharmacies further away are open and can be asked too. They can't deliver that far, so you would collect your
              medicines from the one that takes it.
            </Text>
            <Pressable style={[s.primary, { alignSelf: "stretch" }]} disabled={further.isPending} onPress={() => void onAskFurther()} testID="button-ask-further">
              <Text style={s.primaryText}>Ask pharmacies further away · I'll collect</Text>
            </Pressable>
            <Pressable style={[s.outline, { alignSelf: "stretch" }]} onPress={() => router.navigate("/(tabs)")}>
              <Text style={s.outlineText}>Search medicines instead</Text>
            </Pressable>
            {choiceLeft ? (
              <Text style={[s.meta, { textAlign: "center" }]}>
                You have {choiceLeft} to choose. After that the request closes and the photo is deleted.
              </Text>
            ) : null}
          </View>
          {cancelButton}
        </>
      );

    case "accepted":
      return (
        <>
          <View style={[s.card, s.center]} testID="status-accepted">
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[s.heading, { textAlign: "center" }]}>{request.pharmacy?.name ?? "A pharmacy"} is checking your prescription</Text>
            <Text style={[s.body, { textAlign: "center" }]}>
              They are choosing the medicines they have for you. This usually takes a few minutes.
            </Text>
          </View>
          <DeliveryLine delivery={request.delivery} colors={colors} />
          {cancelButton}
        </>
      );

    case "ready": {
      const items = request.items.filter((i) => i.maxQuantity > 0);
      const goToCheckout = () => {
        if (!request.pharmacy) return;
        startFromRequest(
          request.id,
          { id: request.pharmacy.id, name: request.pharmacy.name, address: request.pharmacy.address ?? null },
          items.map((i) => ({
            inventoryId: i.inventoryId,
            drugId: i.drugId,
            drugName: i.drugName,
            strength: i.strength,
            form: i.form,
            unitOfSale: i.unitOfSale,
            tier: i.tier,
            // The pharmacist's limit is this cart's ceiling.
            maxUnitsPerOrder: i.maxQuantity,
            prescriptionRequired: i.prescriptionRequired,
            collectionOnly: i.collectionOnly,
            priceLeones: i.priceLeones,
            brand: i.brand ?? null,
            manufacturer: i.manufacturer ?? null,
            countryOfOrigin: i.countryOfOrigin ?? null,
            quantity: i.maxQuantity,
            availableForDelivery: i.availableForDelivery,
            availableForCollection: i.availableForCollection,
          })),
          { collection: request.delivery?.available === false },
        );
        router.navigate("/(tabs)/cart");
      };
      return (
        <>
          <View style={s.ready} testID="status-ready">
            <Feather name="check-circle" size={22} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={s.bold}>{request.pharmacy?.name} has your medicines</Text>
              <Text style={s.meta}>
                {request.pharmacy?.address ? `${request.pharmacy.address} · ` : ""}The pharmacist checked your prescription.
              </Text>
            </View>
          </View>
          {items.length === 0 ? (
            <View style={s.card}>
              <Text style={[s.meta, { textAlign: "center" }]}>
                These medicines have just run out at the pharmacy. Please send your prescription again.
              </Text>
            </View>
          ) : (
            <View style={[s.card, { padding: 0 }]}>
              {items.map((i, index) => (
                <View key={i.inventoryId} style={[s.item, index > 0 && s.divider]} testID={`request-item-${i.inventoryId}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.bold}>{i.drugName}</Text>
                    <Text style={s.meta}>{[i.strength, i.form, i.brand].filter(Boolean).join(" · ")}</Text>
                    <Text style={s.meta}>
                      {formatLeones(i.priceLeones)} per {i.unitOfSale} · up to {i.maxQuantity}
                      {i.collectionOnly ? " · collection + ID only" : ""}
                    </Text>
                  </View>
                  <Text style={s.bold}>{formatLeones(i.priceLeones * i.maxQuantity)}</Text>
                </View>
              ))}
            </View>
          )}
          {items.length > 0 ? <DeliveryLine delivery={request.delivery} colors={colors} /> : null}
          {items.length > 0 ? (
            <Pressable style={s.primary} onPress={goToCheckout} testID="button-request-checkout">
              <Text style={s.primaryText}>Continue to checkout</Text>
            </Pressable>
          ) : null}
          <Text style={[s.meta, { textAlign: "center" }]}>
            {request.delivery?.available === false
              ? "At checkout you can lower a quantity and pay, then collect from the pharmacy."
              : "At checkout you can lower a quantity, choose delivery or collection, and pay."}
          </Text>
          {cancelButton}
        </>
      );
    }

    case "ordered":
      return (
        <View style={[s.card, s.center]} testID="status-ordered">
          <Feather name="check-circle" size={30} color={colors.primary} />
          <Text style={s.heading}>Ordered</Text>
          {request.orderId ? (
            <Pressable style={s.primary} onPress={() => router.push(`/order/${request.orderId}`)}>
              <Text style={s.primaryText}>View your order</Text>
            </Pressable>
          ) : null}
        </View>
      );

    default: {
      const rejected = request.status === "rejected";
      const expired = request.status === "expired";
      return (
        <View style={[s.card, s.center]} testID={`status-${request.status}`}>
          <Feather name={rejected ? "file-minus" : "clock"} size={30} color={rejected ? colors.destructive : colors.mutedForeground} />
          <Text style={s.heading}>
            {rejected ? "The pharmacist could not accept it" : expired ? "No pharmacy took it in time" : "Cancelled"}
          </Text>
          <Text style={[s.body, { textAlign: "center" }]}>
            {rejected
              ? REJECT_REASONS[request.rejectReason ?? ""] ?? "The prescription was not accepted."
              : expired
                ? "No pharmacy near you confirmed your medicines this time. You can send it again, or search for the medicines by name."
                : "This request was cancelled and the photo deleted."}
          </Text>
          <Pressable style={[s.primary, { alignSelf: "stretch" }]} onPress={() => router.replace("/prescription")} testID="button-send-again">
            <Text style={s.primaryText}>Upload prescription</Text>
          </Pressable>
          <Pressable style={[s.outline, { alignSelf: "stretch" }]} onPress={() => router.navigate("/(tabs)")}>
            <Text style={s.outlineText}>Search medicines</Text>
          </Pressable>
        </View>
      );
    }
  }
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 16 },
    back: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, alignSelf: "flex-start" },
    backText: { fontSize: 14, color: colors.mutedForeground },
    title: { fontSize: 24, fontWeight: "700", color: colors.darkGreen },
    heading: { fontSize: 18, fontWeight: "700", color: colors.foreground },
    bold: { fontSize: 14, fontWeight: "700", color: colors.foreground },
    body: { fontSize: 14, color: colors.mutedForeground, lineHeight: 20 },
    meta: { fontSize: 12.5, color: colors.mutedForeground, lineHeight: 18, marginTop: 2 },
    card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16 },
    center: { alignItems: "center", gap: 10, paddingVertical: 24 },
    bigIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: "#E8F5EF",
      alignItems: "center",
      justifyContent: "center",
    },
    ready: {
      flexDirection: "row",
      gap: 10,
      borderWidth: 1,
      borderColor: "#A7D8C6",
      backgroundColor: "#F0F8F4",
      borderRadius: 16,
      padding: 14,
    },
    item: { flexDirection: "row", gap: 10, padding: 14, alignItems: "flex-start" },
    divider: { borderTopWidth: 1, borderTopColor: colors.border },
    primary: {
      height: 50,
      borderRadius: 999,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 16,
    },
    primaryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
    outline: {
      height: 46,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    outlineText: { color: colors.darkGreen, fontWeight: "600", fontSize: 14 },
    ghost: { alignItems: "center", paddingVertical: 10 },
    ghostText: { color: colors.mutedForeground, fontSize: 14, fontWeight: "600" },
  });
}
