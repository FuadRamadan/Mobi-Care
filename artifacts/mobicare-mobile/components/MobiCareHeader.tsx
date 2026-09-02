import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

export function MobiCareHeader() {
  const colors = useColors();
  return (
    <View style={[styles.container, { borderBottomColor: colors.border }]}>
      <Image
        source={require("@/assets/images/icon.png")}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="MobiCare logo"
      />
      <View>
        <Text style={[styles.brand, { color: colors.darkGreen }]}>MobiCare</Text>
        <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
          Medicine, delivered with care
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  logo: { width: 46, height: 46, borderRadius: 13 },
  brand: { fontSize: 22, fontWeight: "800", lineHeight: 25 },
  tagline: { fontSize: 12, fontWeight: "500", marginTop: 1 },
});