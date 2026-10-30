import React, { useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  type DeliveryQuote,
  usePatientCreateOrder,
  usePatientDeliveryCoverage,
  usePatientDeliveryQuote,
  usePatientStartCheckout,
  usePatientUploadPrescription,
} from "@workspace/api-client-react";
import { useCart } from "@/context/CartContext";
import { useColors } from "@/hooks/useColors";
import { MobiCareHeader } from "@/components/MobiCareHeader";
import { LocationPicker, type LatLng, type ZoneOutline } from "@/components/LocationPicker";
import { notify } from "@/lib/dialogs";
import { errorBody, formatLeones } from "@/lib/format";
import { openPaymentPage } from "@/lib/payment";
import { pickPhoto, toJpegDataUrl, type PickedPhoto } from "@/lib/photos";

type Colors = ReturnType<typeof useColors>;

/** The cart and checkout, as on the web app's Checkout page. */
export default function CartScreen() {
  const colors = useColors();
  const s = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const {
    cart,
    setQuantity,
    removeItem,
    clear,
    serviceFeeLeones,
    serviceFeeBasisPoints,
    paymentsAvailable,
    totalLeones,
    prescriptionRequired,
    collectionOnly,
  } = useCart();

  const [fulfillment, setFulfillment] = useState<"delivery" | "collection" | null>(null);
  const [address, setAddress] = useState("");
  const [pin, setPin] = useState<LatLng | null>(null);
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [opening, setOpening] = useState(false);

  const uploadMutation = usePatientUploadPrescription();
  const createMutation = usePatientCreateOrder();
  const checkoutMutation = usePatientStartCheckout();
  const quoteMutation = usePatientDeliveryQuote();
  const { data: coverage } = usePatientDeliveryCoverage();
  const areas = useMemo(
    () => (coverage ?? []).map((zone) => ({ name: zone.name, boundary: zone.boundary as unknown as ZoneOutline })),
    [coverage],
  );
  const busy = uploadMutation.isPending || createMutation.isPending || checkoutMutation.isPending || opening;

  if (!cart || cart.items.length === 0) {
    return (
      <View style={s.container}>
        <MobiCareHeader />
        <View style={s.content}>
          <Text style={s.title}>Your cart</Text>
          <View style={s.empty}>
            <Text style={s.emptyText}>
              Your cart is empty.{" "}
              <Text style={s.linkText} onPress={() => router.navigate("/(tabs)")}>
                Search medicines
              </Text>{" "}
              to get started.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // A cart from a prescription request was already checked by its pharmacist:
  // no photo to upload, and the order can be paid straight away.
  const fromRequest = Boolean(cart.prescriptionRequestId);
  const needsRxUpload = prescriptionRequired && !fromRequest;
  const chosen = fulfillment ?? (collectionOnly || cart.startsWithCollection ? "collection" : "delivery");
  const effectiveFulfillment = collectionOnly ? "collection" : chosen;
  const isDelivery = effectiveFulfillment === "delivery";
  const deliveryBlocked = isDelivery && cart.items.some((i) => !i.availableForDelivery);
  const collectionBlocked = !isDelivery && cart.items.some((i) => !i.availableForCollection);

  // The fee is worked out on the server from the pin; the one shown here is
  // sent back with the order so a change in between is caught, not charged.
  const deliveryFeeLeones =
    isDelivery && quote?.available && quote.deliveryFeeMinor != null ? quote.deliveryFeeMinor / 100 : 0;
  const payableLeones = totalLeones + deliveryFeeLeones;
  const deliveryNotReady = isDelivery && (!pin || quoteMutation.isPending || !quote?.available);

  async function onPin(next: LatLng) {
    setPin(next);
    setQuote(null);
    try {
      const result = await quoteMutation.mutateAsync({
        data: { pharmacyId: cart!.pharmacyId, latitude: next.latitude, longitude: next.longitude },
      });
      setQuote(result);
    } catch {
      setQuote({
        available: false,
        deliveryFeeMinor: null,
        zoneName: null,
        fromZoneName: null,
        message: "The delivery fee could not be worked out. Check your connection and move the pin to try again.",
      });
    }
  }

  async function choosePhoto(source: "camera" | "library") {
    const picked = await pickPhoto(source);
    if (picked) setPhoto(picked);
  }

  async function placeOrder() {
    try {
      if (isDelivery && !pin) {
        notify("Delivery location needed", "Drop a pin on the map, or use your location, so we can work out the delivery fee.");
        return;
      }
      if (isDelivery && address.trim().length < 5) {
        notify("Landmark needed", "Tell the rider how to find you — a landmark or directions (at least 5 characters).");
        return;
      }
      if (needsRxUpload && !photo) {
        notify("Prescription needed", "Upload a photo of your prescription to continue.");
        return;
      }

      let prescriptionImageKey: string | undefined;
      if (needsRxUpload && photo) {
        const up = await uploadMutation.mutateAsync({ data: { image: await toJpegDataUrl(photo) } });
        prescriptionImageKey = up.imageKey;
      }

      const order = await createMutation.mutateAsync({
        data: {
          pharmacyId: cart!.pharmacyId,
          fulfillmentType: effectiveFulfillment,
          ...(isDelivery && pin
            ? {
                deliveryAddress: address.trim(),
                deliveryLocation: pin,
                ...(quote?.deliveryFeeMinor != null ? { quotedDeliveryFeeMinor: quote.deliveryFeeMinor } : {}),
              }
            : {}),
          ...(prescriptionImageKey ? { prescriptionImageKey } : {}),
          ...(cart!.prescriptionRequestId ? { prescriptionRequestId: cart!.prescriptionRequestId } : {}),
          items: cart!.items.map((i) => ({ inventoryId: i.inventoryId, quantity: i.quantity })),
        },
      });

      clear();
      setPhoto(null);
      setAddress("");
      setPin(null);
      setQuote(null);
      setFulfillment(null);
      await queryClient.invalidateQueries();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (needsRxUpload) {
        notify("Order placed", "A pharmacist will check your prescription first. We'll let you know when you can pay.");
        router.push(`/order/${order.id}`);
        return;
      }
      // Pay through Monime. The order is saved first; the payment link is made
      // on the server from the saved order.
      try {
        const link = await checkoutMutation.mutateAsync({ id: order.id });
        if (link.status === "pending" && link.redirectUrl) {
          setOpening(true);
          await openPaymentPage(link.redirectUrl);
          setOpening(false);
          router.push(`/order/${order.id}?payment=return`);
          return;
        }
      } catch (err) {
        setOpening(false);
        notify("Order saved: payment not started", errorBody(err).error ?? "Open the order and tap Pay to try again.");
      }
      router.push(`/order/${order.id}`);
    } catch (err) {
      const body = errorBody(err);
      if (body.code === "DELIVERY_FEE_CHANGED" && body.deliveryFeeMinor != null) {
        setQuote((current) => ({
          available: true,
          zoneName: current?.zoneName ?? null,
          fromZoneName: current?.fromZoneName ?? null,
          message: null,
          deliveryFeeMinor: body.deliveryFeeMinor!,
        }));
        notify(
          "Delivery fee updated",
          `The delivery fee is now ${formatLeones(body.deliveryFeeMinor / 100)}. Check the new total, then place your order again.`,
        );
        return;
      }
      if (body.code === "DELIVERY_UNAVAILABLE") {
        setQuote({ available: false, deliveryFeeMinor: null, zoneName: null, fromZoneName: null, message: body.error ?? null });
      }
      notify("Could not place order", body.error ?? "Something went wrong — please review your cart and try again.");
    }
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
          <Text style={s.title}>Your cart</Text>
          <Text style={s.subtitle}>
            Ordering from <Text style={s.bold}>{cart.pharmacyName}</Text>
            {cart.pharmacyAddress ? ` · ${cart.pharmacyAddress}` : ""}
          </Text>
        </View>

        <View style={s.card}>
          {cart.items.map((item, index) => (
            <View key={item.inventoryId} style={[s.item, index > 0 && s.divider]} testID={`cart-item-${item.inventoryId}`}>
              <View style={{ flex: 1 }}>
                <Text style={s.itemName}>{item.drugName}</Text>
                <Text style={s.meta}>
                  {item.strength} {item.form}
                </Text>
                {item.brand ? (
                  <Text style={s.meta}>{[item.brand, item.manufacturer, item.countryOfOrigin].filter(Boolean).join(" · ")}</Text>
                ) : null}
                <Text style={s.meta}>
                  {formatLeones(item.priceLeones)} per {item.unitOfSale}
                  {item.prescriptionRequired ? " · prescription" : ""}
                  {item.collectionOnly ? " · collection + ID only" : ""}
                  {fromRequest && item.maxUnitsPerOrder != null ? ` · up to ${item.maxUnitsPerOrder}` : ""}
                </Text>
              </View>
              <View style={s.qty}>
                <Pressable
                  style={s.qtyBtn}
                  onPress={() => (item.quantity <= 1 ? removeItem(item.inventoryId) : setQuantity(item.inventoryId, item.quantity - 1))}
                  testID={`decrease-qty-${item.inventoryId}`}
                >
                  <Feather name="minus" size={13} color={colors.foreground} />
                </Pressable>
                <Text style={s.qtyText} testID={`qty-${item.inventoryId}`}>
                  {item.quantity}
                </Text>
                <Pressable
                  style={[s.qtyBtn, item.maxUnitsPerOrder != null && item.quantity >= item.maxUnitsPerOrder && { opacity: 0.4 }]}
                  onPress={() => setQuantity(item.inventoryId, item.quantity + 1)}
                  disabled={item.maxUnitsPerOrder != null && item.quantity >= item.maxUnitsPerOrder}
                  testID={`increase-qty-${item.inventoryId}`}
                >
                  <Feather name="plus" size={13} color={colors.foreground} />
                </Pressable>
                <Pressable onPress={() => removeItem(item.inventoryId)} hitSlop={6} accessibilityLabel="Remove">
                  <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>

        <View style={{ gap: 8 }}>
          <Text style={s.label}>How do you want to get it?</Text>
          <View style={s.options}>
            <Way
              icon="truck"
              title="Delivery"
              hint="A rider brings it to you"
              on={isDelivery}
              disabled={collectionOnly}
              onPress={() => setFulfillment("delivery")}
              colors={colors}
              testID="fulfillment-delivery"
            />
            <Way
              icon="shopping-bag"
              title="Collection"
              hint="Pick up at the pharmacy"
              on={!isDelivery}
              onPress={() => setFulfillment("collection")}
              colors={colors}
              testID="fulfillment-collection"
            />
          </View>
          {collectionOnly ? (
            <Text style={s.warn}>
              Your cart contains a controlled medicine — collection with an in-person ID check is required.
            </Text>
          ) : null}
          {deliveryBlocked || collectionBlocked ? (
            <Text style={s.error}>Some items are not available for {effectiveFulfillment} from this pharmacy.</Text>
          ) : null}
        </View>

        {isDelivery ? (
          <View style={{ gap: 12 }}>
            <View style={{ gap: 6 }}>
              <Text style={s.label}>Where should we deliver?</Text>
              <LocationPicker value={pin} onChange={(next) => void onPin(next)} areas={areas} testID="map-delivery-location" />
              {pin ? (
                <View style={[s.quote, quote && !quote.available && s.quoteWarn]} testID="text-delivery-quote">
                  <Feather name="map-pin" size={15} color={colors.primary} style={{ marginTop: 2 }} />
                  {quoteMutation.isPending || !quote ? (
                    <Text style={s.meta}>Working out the delivery fee…</Text>
                  ) : quote.available ? (
                    <View style={{ flex: 1 }}>
                      <Text style={s.quoteText} testID="text-delivery-distance">
                        Delivery{quote.zoneName ? <Text> to <Text style={s.bold}>{quote.zoneName}</Text></Text> : null}
                        {quote.distanceKm != null ? ` · ${quote.distanceEstimated ? "about " : ""}${quote.distanceKm} km` : ""}:{" "}
                        <Text style={s.bold}>{formatLeones(deliveryFeeLeones)}</Text>
                      </Text>
                      <Text style={s.meta}>Priced by the distance from {cart.pharmacyName}. Move the pin and the fee updates.</Text>
                    </View>
                  ) : (
                    <Text style={[s.quoteText, { flex: 1, color: "#92400E" }]}>
                      {quote.message}{" "}
                      <Text style={s.underline} onPress={() => setFulfillment("collection")}>
                        Collect instead
                      </Text>
                    </Text>
                  )}
                </View>
              ) : null}
            </View>
            <View style={{ gap: 6 }}>
              <Text style={s.label}>Landmark or directions</Text>
              <TextInput
                style={s.input}
                value={address}
                onChangeText={setAddress}
                placeholder="e.g. Blue gate opposite Lumley police station"
                placeholderTextColor={colors.mutedForeground}
                testID="input-address"
              />
            </View>
          </View>
        ) : null}

        {fromRequest ? (
          <View style={s.checked} testID="text-prescription-checked">
            <Feather name="file-text" size={18} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={s.bold}>Prescription checked by {cart.pharmacyName}</Text>
              <Text style={s.meta}>
                Your photo is already with the pharmacist. You can lower a quantity, or raise it up to what they allowed.
              </Text>
            </View>
          </View>
        ) : null}

        {needsRxUpload ? (
          <View style={{ gap: 8 }}>
            <Text style={s.label}>Prescription photo</Text>
            {photo ? (
              <View style={[s.upload, s.uploadOn]}>
                <Image source={{ uri: photo.uri }} style={s.thumb} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={s.bold}>Prescription photo added</Text>
                  <Text style={s.linkText} onPress={() => void choosePhoto("library")}>
                    Change photo
                  </Text>
                </View>
              </View>
            ) : (
              <View style={s.upload}>
                <Feather name="file-text" size={20} color={colors.primary} />
                <View style={{ flex: 1, gap: 8 }}>
                  <Text style={s.meta}>Your order includes prescription medicines. Add a photo of your prescription.</Text>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <Pressable style={s.smallBtn} onPress={() => void choosePhoto("camera")} testID="button-take-prescription">
                      <Feather name="camera" size={14} color={colors.darkGreen} />
                      <Text style={s.smallBtnText}>Take photo</Text>
                    </Pressable>
                    <Pressable style={s.smallBtn} onPress={() => void choosePhoto("library")} testID="button-upload-prescription">
                      <Feather name="image" size={14} color={colors.darkGreen} />
                      <Text style={s.smallBtnText}>Choose photo</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            )}
          </View>
        ) : null}

        <View style={[s.card, { padding: 16, gap: 12 }]}>
          <View style={s.rowBetween}>
            <Text style={s.meta}>Payment method</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Feather name="smartphone" size={14} color={colors.orangeMoney} />
              <Text style={s.bold}>Mobile money, card or bank</Text>
            </View>
          </View>
          <View style={[s.divider, { paddingTop: 10, gap: 6 }]}>
            {cart.items.map((item) => (
              <View key={item.inventoryId} style={s.rowBetween}>
                <Text style={[s.meta, { flex: 1 }]}>
                  {item.quantity} × {item.drugName}
                  {item.brand ? ` (${item.brand})` : ""}
                </Text>
                <Text style={s.line}>{formatLeones(item.priceLeones * item.quantity)}</Text>
              </View>
            ))}
            {serviceFeeLeones > 0 ? (
              <View style={s.rowBetween}>
                <Text style={s.meta}>Service fee ({serviceFeeBasisPoints / 100}%)</Text>
                <Text style={s.line}>{formatLeones(serviceFeeLeones)}</Text>
              </View>
            ) : null}
            {isDelivery ? (
              <View style={s.rowBetween} testID="text-delivery-fee">
                <Text style={s.meta}>Delivery{quote?.available && quote.distanceKm != null ? ` · ${quote.distanceKm} km` : ""}</Text>
                <Text style={s.line}>{quote?.available ? formatLeones(deliveryFeeLeones) : "—"}</Text>
              </View>
            ) : null}
          </View>
          <View style={[s.rowBetween, s.divider, { paddingTop: 10 }]}>
            <Text style={s.bold}>Total payable</Text>
            <Text style={s.total} testID="text-total">
              {formatLeones(payableLeones)}
            </Text>
          </View>
          <View testID="text-pay-online">
            <Text style={[s.bold, { marginBottom: 2 }]}>Pay securely online</Text>
            <Text style={s.meta}>
              {needsRxUpload
                ? "A pharmacist checks your prescription first. Then you pay online with Orange Money, AfriMoney, a card or a bank account."
                : "Next you'll pay on Monime's secure page with Orange Money, AfriMoney, a card or a bank account. Someone else can pay the link for you too."}
            </Text>
            {!paymentsAvailable ? (
              <Text style={[s.error, { marginTop: 6 }]}>Online payment is unavailable right now. Please try again in a few minutes.</Text>
            ) : null}
          </View>
          <Pressable
            style={[s.pay, (busy || deliveryBlocked || collectionBlocked || deliveryNotReady || !paymentsAvailable) && s.payOff]}
            onPress={() => void placeOrder()}
            disabled={busy || deliveryBlocked || collectionBlocked || deliveryNotReady || !paymentsAvailable}
            testID="pay-button"
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
            <Text style={s.payText}>
              {busy ? "Opening payment…" : !needsRxUpload ? `Place order and pay ${formatLeones(payableLeones)}` : "Place order"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function Way({
  icon,
  title,
  hint,
  on,
  disabled,
  onPress,
  colors,
  testID,
}: {
  icon: "truck" | "shopping-bag";
  title: string;
  hint: string;
  on: boolean;
  disabled?: boolean;
  onPress: () => void;
  colors: Colors;
  testID: string;
}) {
  const s = makeStyles(colors);
  return (
    <Pressable style={[s.way, on && s.wayOn, disabled && { opacity: 0.4 }]} onPress={onPress} disabled={disabled} testID={testID}>
      <Feather name={icon} size={16} color={colors.primary} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={s.bold}>{title}</Text>
        <Text style={s.meta}>{hint}</Text>
      </View>
    </Pressable>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 18 },
    title: { fontSize: 24, fontWeight: "700", color: colors.darkGreen },
    subtitle: { fontSize: 13, color: colors.mutedForeground, marginTop: 2 },
    bold: { fontSize: 14, fontWeight: "700", color: colors.foreground },
    label: { fontSize: 14, fontWeight: "600", color: colors.foreground },
    meta: { fontSize: 12.5, color: colors.mutedForeground, lineHeight: 18 },
    line: { fontSize: 13.5, color: colors.foreground },
    linkText: { color: colors.primary, fontWeight: "600" },
    underline: { fontWeight: "700", textDecorationLine: "underline" },
    warn: {
      fontSize: 12,
      color: "#92400E",
      backgroundColor: "#FFFBEB",
      borderColor: "#FDE68A",
      borderWidth: 1,
      borderRadius: 10,
      padding: 8,
    },
    error: { fontSize: 12.5, color: colors.destructive },
    empty: {
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.border,
      borderRadius: 16,
      padding: 24,
      marginTop: 16,
    },
    emptyText: { fontSize: 14, color: colors.mutedForeground, textAlign: "center", lineHeight: 20 },
    card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
    item: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
    divider: { borderTopWidth: 1, borderTopColor: colors.border },
    itemName: { fontSize: 14, fontWeight: "600", color: colors.foreground },
    qty: { flexDirection: "row", alignItems: "center", gap: 8 },
    qtyBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    qtyText: { width: 22, textAlign: "center", fontSize: 14, fontWeight: "600", color: colors.foreground },
    options: { flexDirection: "row", gap: 8 },
    way: {
      flex: 1,
      flexDirection: "row",
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 12,
      backgroundColor: colors.card,
    },
    wayOn: { borderColor: colors.primary, backgroundColor: "#F0F8F4" },
    quote: {
      flexDirection: "row",
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 12,
      backgroundColor: colors.card,
    },
    quoteWarn: { borderColor: "#FDE68A", backgroundColor: "#FFFBEB" },
    quoteText: { fontSize: 14, color: colors.foreground },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 11,
      fontSize: 14.5,
      color: colors.foreground,
      backgroundColor: colors.card,
    },
    checked: {
      flexDirection: "row",
      gap: 10,
      borderWidth: 1,
      borderColor: "#A7D8C6",
      backgroundColor: "#F0F8F4",
      borderRadius: 16,
      padding: 14,
    },
    upload: {
      flexDirection: "row",
      gap: 12,
      borderWidth: 2,
      borderStyle: "dashed",
      borderColor: colors.border,
      borderRadius: 16,
      padding: 14,
      backgroundColor: colors.card,
      alignItems: "center",
    },
    uploadOn: { borderColor: colors.primary, backgroundColor: "#F0F8F4" },
    thumb: { width: 54, height: 66, borderRadius: 8, backgroundColor: colors.muted },
    smallBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
      backgroundColor: colors.card,
    },
    smallBtnText: { fontSize: 13, fontWeight: "600", color: colors.darkGreen },
    rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
    total: { fontSize: 20, fontWeight: "800", color: colors.darkGreen },
    pay: {
      flexDirection: "row",
      gap: 8,
      height: 50,
      borderRadius: 999,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 4,
    },
    payOff: { opacity: 0.5 },
    payText: { color: "#FFFFFF", fontSize: 15.5, fontWeight: "700" },
  });
}
