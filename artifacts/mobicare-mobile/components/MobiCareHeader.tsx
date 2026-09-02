import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { MobiCareLogo } from "@/components/MobiCareLogo";

export function MobiCareHeader() {
  const colors = useColors();
  return (
    <View style={[styles.container, { borderBottomColor: colors.border }]}>
      <MobiCareLogo compact />
      <View>
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
  tagline: { fontSize: 12, fontWeight: "500", marginTop: 1 },
});