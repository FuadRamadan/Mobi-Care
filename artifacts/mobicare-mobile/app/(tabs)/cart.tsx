import React, { useState } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  getPatientListOrdersQueryKey,
  usePatientCreateOrder,
  usePatientPayOrder,
  usePatientUploadPrescription,
} from "@workspace/api-client-react";
import { useCart } from "@/context/CartContext";
import { useColors } from "@/hooks/useColors";
import { MobiCareHeader } from "@/components/MobiCareHeader";

type Fulfillment = "delivery" | "collection";

function formatLeones(n: number) {
  return `Le ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export default function CartScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const {
    cart,
    itemCount,
    drugTotalLeones,
    serviceFeeLeones,
    totalLeones,
    requiresPrescription,
    requiresCollection,
    updateQty,
    removeItem,
    clearCart,
  } = useCart();

  const [fulfillment, setFulfillment] = useState<Fulfillment>("delivery");
  const [address, setAddress] = useState("");
  const [prescriptionUri, setPrescriptionUri] = useState<string | null>(null);
  const [prescriptionBase64, setPrescriptionBase64] = useState<string | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createOrder = usePatientCreateOrder();
  const payOrder = usePatientPayOrder();
  const uploadPrescription = usePatientUploadPrescription();

  const activeFulfillment = requiresCollection ? "collection" : fulfillment;
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? insets.top + 67 : insets.top;

  const pickPrescription = async () => {
    if (Platform.OS !== "web") {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission Needed",
          "Allow access to your photos to upload a prescription.",
          [{ text: "OK" }],
        );
        return;
      }
    }
    Alert.alert("Upload Prescription", "Choose a source:", [
      {
        text: "Camera",
        onPress: async () => {
          if (Platform.OS !== "web") {
            const { status } =
              await ImagePicker.requestCameraPermissionsAsync();
            if (status !== "granted") {
              Alert.alert("Camera permission denied");
              return;
            }
          }
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 0.8,
            base64: true,
            allowsEditing: true,
          });
          if (!result.canceled && result.assets[0]) {
            const asset = result.assets[0];
            if (asset.base64) {
              setPrescriptionUri(asset.uri);
              const mime = asset.mimeType ?? "image/jpeg";
              setPrescriptionBase64(`data:${mime};base64,${asset.base64}`);
            } else {
              Alert.alert(
                "Upload failed",
                "Could not read image data. Please try again.",
              );
            }
          }
        },
      },
      {
        text: "Photo Library",
        onPress: async () => {
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.8,
            base64: true,
            allowsEditing: true,
          });
          if (!result.canceled && result.assets[0]) {
            const asset = result.assets[0];
            if (asset.base64) {
              setPrescriptionUri(asset.uri);
              const mime = asset.mimeType ?? "image/jpeg";
              setPrescriptionBase64(`data:${mime};base64,${asset.base64}`);
            } else {
              Alert.alert(
                "Upload failed",
                "Could not read image data. Please try again.",
              );
            }
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const handleCheckout = async () => {
    if (cart.items.length === 0) return;
    if (activeFulfillment === "delivery" && address.trim().length < 5) {
      Alert.alert(
        "Delivery Address",
        "Please enter your full delivery address (minimum 5 characters).",
      );
      return;
    }
    if (requiresPrescription && !prescriptionBase64) {
      Alert.alert(
        "Prescription Required",
        "One or more items require a prescription photo. Please upload it to continue.",
      );
      return;
    }

    setIsSubmitting(true);
    try {
      let prescriptionImageKey: string | undefined;
      if (prescriptionBase64) {
        const uploaded = await uploadPrescription.mutateAsync({
          data: { image: prescriptionBase64 },
        });
        prescriptionImageKey = uploaded.imageKey;
      }

      const order = await createOrder.mutateAsync({
        data: {
          pharmacyId: cart.pharmacyId!,
          fulfillmentType: activeFulfillment,
          expectedTotalMinor: Math.round(totalLeones * 100),
          items: cart.items.map((i) => ({
            inventoryId: i.inventoryId,
            quantity: i.quantity,
          })),
          ...(activeFulfillment === "delivery"
            ? { deliveryAddress: address.trim() }
            : {}),
          ...(prescriptionImageKey ? { prescriptionImageKey } : {}),
        },
      });

      await payOrder.mutateAsync({ id: order.id });

      clearCart();
      setPrescriptionUri(null);
      setPrescriptionBase64(null);
      setAddress("");

      queryClient.invalidateQueries({
        queryKey: getPatientListOrdersQueryKey(),
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Order Placed!",
        "Your payment has been recorded. Track your order in the Orders tab.",
        [
          {
            text: "View Orders",
            onPress: () => router.replace("/(tabs)/orders"),
          },
        ],
      );
    } catch (e: unknown) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg =
        e instanceof Error ? e.message : "Order failed. Please try again.";
      const friendly =
        msg.includes("409") || msg.includes("conflict")
          ? "Some items are out of stock or unavailable. Please review your cart."
          : msg.includes("401")
            ? "Session expired. Please log in again."
            : "Order failed. Please try again.";
      Alert.alert("Order Failed", friendly);
    } finally {
      setIsSubmitting(false);
    }
  };

  const s = makeStyles(colors, insets);

  if (cart.items.length === 0) {
    return (
      <View style={[s.container, { paddingTop: topPad }]}>
        <MobiCareHeader />
        <View style={s.screenTitle}>
          <Text style={s.screenTitleText}>Cart</Text>
        </View>
        <View style={s.emptyState}>
          <Feather name="shopping-cart" size={56} color={colors.border} />
          <Text style={s.emptyTitle}>Your cart is empty</Text>
          <Text style={s.emptyBody}>
            Search for medicines and add them here.
          </Text>
          <TouchableOpacity
            style={s.searchBtn}
            onPress={() => router.push("/(tabs)")}
            activeOpacity={0.85}
          >
            <Text style={s.searchBtnText}>Search Medicines</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[s.container, { paddingTop: topPad }]}
      contentContainerStyle={[
        s.scrollContent,
        isWeb ? { paddingBottom: insets.bottom + 34 } : {},
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <MobiCareHeader />
      {/* Header */}
      <View style={s.screenTitle}>
        <Text style={s.screenTitleText}>Cart</Text>
        <Text style={s.pharmacyLabel}>from {cart.pharmacyName}</Text>
      </View>

      {/* Cart items */}
      <View style={s.section}>
        {cart.items.map((item) => (
          <View key={item.inventoryId} style={s.cartItem}>
            <View style={s.cartItemInfo}>
              <Text style={s.cartItemName} numberOfLines={2}>
                {item.drugName}
              </Text>
              <Text style={s.cartItemPrice}>
                {formatLeones(item.priceLeones)} each
              </Text>
            </View>
            <View style={s.qtyRow}>
              <Pressable
                style={[s.qtyBtn, item.quantity <= 1 && s.qtyBtnDestructive]}
                testID={`decrease-qty-${item.inventoryId}`}
                onPress={() => {
                  if (item.quantity <= 1) {
                    Alert.alert(
                      "Remove Item?",
                      `Remove ${item.drugName} from cart?`,
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Remove",
                          style: "destructive",
                          onPress: () => {
                            removeItem(item.inventoryId);
                            Haptics.impactAsync(
                              Haptics.ImpactFeedbackStyle.Medium,
                            );
                          },
                        },
                      ],
                    );
                  } else {
                    updateQty(item.inventoryId, -1);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }
                }}
              >
                <Ionicons
                  name={item.quantity <= 1 ? "trash-outline" : "remove"}
                  size={16}
                  color={
                    item.quantity <= 1 ? colors.destructive : colors.foreground
                  }
                />
              </Pressable>
              <Text style={s.qtyText} testID={`qty-${item.inventoryId}`}>
                {item.quantity}
              </Text>
              <Pressable
                style={[
                  s.qtyBtn,
                  item.quantity >= item.maxQuantity && s.qtyBtnDisabled,
                ]}
                testID={`increase-qty-${item.inventoryId}`}
                onPress={() => {
                  updateQty(item.inventoryId, 1);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                disabled={item.quantity >= item.maxQuantity}
              >
                <Ionicons
                  name="add"
                  size={16}
                  color={
                    item.quantity >= item.maxQuantity
                      ? colors.border
                      : colors.primary
                  }
                />
              </Pressable>
            </View>
            <Text style={s.cartItemTotal}>
              {formatLeones(item.priceLeones * item.quantity)}
            </Text>
          </View>
        ))}
      </View>

      {/* Fulfillment */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Fulfillment</Text>
        {requiresCollection && (
          <View style={s.infoBanner}>
            <Ionicons
              name="information-circle"
              size={16}
              color={colors.accent}
            />
            <Text style={s.infoBannerText}>
              Some items require in-person collection and ID verification.
            </Text>
          </View>
        )}
        <View style={s.fulfillmentRow}>
          {(["delivery", "collection"] as Fulfillment[]).map((f) => {
            const active = activeFulfillment === f;
            const disabled = requiresCollection && f === "delivery";
            return (
              <Pressable
                key={f}
                style={[
                  s.fulfillmentBtn,
                  active && s.fulfillmentBtnActive,
                  disabled && s.fulfillmentBtnDisabled,
                ]}
                testID={`fulfillment-${f}`}
                onPress={() => {
                  if (!disabled && !requiresCollection) setFulfillment(f);
                }}
                disabled={disabled}
              >
                <Feather
                  name={f === "delivery" ? "truck" : "shopping-bag"}
                  size={18}
                  color={active ? "#FFF" : colors.mutedForeground}
                />
                <Text
                  style={[s.fulfillmentText, active && s.fulfillmentTextActive]}
                >
                  {f === "delivery" ? "Delivery" : "Collection"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {activeFulfillment === "delivery" && (
          <View style={s.addressField}>
            <Text style={s.fieldLabel}>Delivery Address</Text>
            <TextInput
              style={s.addressInput}
              value={address}
              onChangeText={setAddress}
              placeholder="Enter your full delivery address"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
              returnKeyType="done"
            />
          </View>
        )}
      </View>

      {/* Prescription */}
      {requiresPrescription && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Prescription</Text>
          <Text style={s.sectionHint}>
            A valid prescription photo is required for one or more items.
          </Text>
          {prescriptionUri ? (
            <View style={s.prescriptionPreview}>
              <Image
                source={{ uri: prescriptionUri }}
                style={s.prescriptionImage}
                resizeMode="cover"
              />
              <Pressable
                style={s.changePrescription}
                onPress={pickPrescription}
              >
                <Feather name="camera" size={14} color={colors.primary} />
                <Text style={s.changePrescriptionText}>Change Photo</Text>
              </Pressable>
            </View>
          ) : (
            <TouchableOpacity
              style={s.uploadBtn}
              onPress={pickPrescription}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons
                name="file-image-outline"
                size={22}
                color={colors.primary}
              />
              <Text style={s.uploadBtnText}>Upload Prescription Photo</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Summary */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Summary</Text>
        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>Drug price</Text>
          <Text style={s.summaryValue}>{formatLeones(drugTotalLeones)}</Text>
        </View>
        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>Service fee (5%)</Text>
          <Text style={s.summaryValue}>{formatLeones(serviceFeeLeones)}</Text>
        </View>
        <View style={s.summaryRow}>
          <Text style={s.summaryLabel}>Payment</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={[s.omBadge]}>
              <Text style={s.omText}>Orange Money</Text>
            </View>
          </View>
        </View>
        <View style={[s.summaryRow, s.summaryTotal]}>
          <Text style={s.totalLabel}>Total payable</Text>
          <Text style={s.totalValue}>{formatLeones(totalLeones)}</Text>
        </View>
      </View>

      {/* Pay button */}
      <TouchableOpacity
        style={[s.payBtn, isSubmitting && s.payBtnDisabled]}
        testID="pay-button"
        onPress={handleCheckout}
        disabled={isSubmitting}
        activeOpacity={0.85}
      >
        <Ionicons name="phone-portrait-outline" size={20} color="#FFF" />
        <Text style={s.payBtnText}>
          {isSubmitting ? "Processing…" : `Pay ${formatLeones(totalLeones)}`}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function makeStyles(
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>,
  insets: { top: number; bottom: number },
) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scrollContent: { paddingBottom: 120, gap: 0 },
    screenTitle: { paddingHorizontal: 20, paddingVertical: 16 },
    screenTitleText: {
      fontSize: 26,
      fontWeight: "800",
      color: colors.darkGreen,
    },
    pharmacyLabel: {
      fontSize: 13,
      color: colors.mutedForeground,
      marginTop: 2,
    },
    emptyState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 32,
      gap: 12,
    },
    emptyTitle: { fontSize: 20, fontWeight: "700", color: colors.foreground },
    emptyBody: {
      fontSize: 14,
      color: colors.mutedForeground,
      textAlign: "center",
    },
    searchBtn: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingHorizontal: 24,
      paddingVertical: 13,
      marginTop: 8,
    },
    searchBtnText: { color: "#FFF", fontWeight: "700", fontSize: 15 },
    section: {
      backgroundColor: colors.card,
      marginHorizontal: 16,
      marginBottom: 12,
      borderRadius: colors.radius + 4,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.foreground,
      marginBottom: 12,
    },
    sectionHint: {
      fontSize: 12,
      color: colors.mutedForeground,
      marginBottom: 12,
    },
    cartItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    cartItemInfo: { flex: 1 },
    cartItemName: { fontSize: 14, fontWeight: "600", color: colors.foreground },
    cartItemPrice: {
      fontSize: 12,
      color: colors.mutedForeground,
      marginTop: 2,
    },
    qtyRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    qtyBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    qtyBtnDestructive: { backgroundColor: "#FEE2E2" },
    qtyBtnDisabled: { opacity: 0.4 },
    qtyText: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.foreground,
      minWidth: 20,
      textAlign: "center",
    },
    cartItemTotal: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.primary,
      minWidth: 60,
      textAlign: "right",
    },
    infoBanner: {
      flexDirection: "row",
      backgroundColor: "#FEF3C7",
      borderRadius: colors.radius,
      padding: 10,
      gap: 8,
      marginBottom: 12,
      alignItems: "flex-start",
    },
    infoBannerText: { flex: 1, fontSize: 12, color: "#92400E" },
    fulfillmentRow: { flexDirection: "row", gap: 10 },
    fulfillmentBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 12,
      borderRadius: colors.radius,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    fulfillmentBtnActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    fulfillmentBtnDisabled: { opacity: 0.4 },
    fulfillmentText: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.mutedForeground,
    },
    fulfillmentTextActive: { color: "#FFF" },
    addressField: { marginTop: 14 },
    fieldLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.foreground,
      marginBottom: 6,
    },
    addressInput: {
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: colors.radius,
      padding: 12,
      fontSize: 14,
      color: colors.foreground,
      backgroundColor: colors.background,
      minHeight: 80,
      textAlignVertical: "top",
    },
    uploadBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      backgroundColor: colors.secondary,
      borderRadius: colors.radius,
      borderWidth: 1.5,
      borderColor: colors.primary,
      borderStyle: "dashed",
      paddingVertical: 18,
    },
    uploadBtnText: { fontSize: 14, fontWeight: "600", color: colors.primary },
    prescriptionPreview: { gap: 10 },
    prescriptionImage: {
      width: "100%",
      height: 140,
      borderRadius: colors.radius,
    },
    changePrescription: { flexDirection: "row", alignItems: "center", gap: 6 },
    changePrescriptionText: {
      fontSize: 13,
      color: colors.primary,
      fontWeight: "600",
    },
    summaryRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10,
    },
    summaryLabel: { fontSize: 14, color: colors.mutedForeground },
    summaryValue: { fontSize: 14, color: colors.foreground, fontWeight: "500" },
    summaryTotal: {
      marginTop: 4,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 12,
      marginBottom: 0,
    },
    totalLabel: { fontSize: 16, fontWeight: "700", color: colors.foreground },
    totalValue: { fontSize: 18, fontWeight: "800", color: colors.darkGreen },
    omBadge: {
      backgroundColor: "#FF6600",
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    omText: { color: "#FFF", fontSize: 11, fontWeight: "700" },
    payBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      backgroundColor: colors.orangeMoney ?? "#FF6600",
      marginHorizontal: 16,
      marginBottom: 16,
      borderRadius: colors.radius,
      paddingVertical: 16,
    },
    payBtnDisabled: { opacity: 0.6 },
    payBtnText: { fontSize: 16, fontWeight: "700", color: "#FFF" },
  });
}
