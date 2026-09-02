import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

type MobiCareLogoProps = {
  compact?: boolean;
  inverse?: boolean;
};

export function MobiCareLogo({ compact = false, inverse = false }: MobiCareLogoProps) {
  const markSize = compact ? 38 : 58;
  return (
    <View
      style={[
        styles.container,
        inverse && styles.inverseSurface,
      ]}
      accessibilityRole="image"
      accessibilityLabel="MobiCare"
    >
      <View style={{ width: markSize, height: markSize }}>
        <Ionicons name="location" size={markSize} color="#249B79" />
        <Ionicons
          name="medical"
          size={compact ? 12 : 17}
          color="#FFFFFF"
          style={[
            styles.cross,
            compact ? styles.compactCross : styles.largeCross,
          ]}
        />
      </View>
      <Text style={[styles.wordmark, compact && styles.compactWordmark]}>
        <Text style={styles.mobi}>Mobi</Text>
        <Text style={styles.care}>Care</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  inverseSurface: {
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  cross: {
    position: "absolute",
  },
  compactCross: {
    left: 13,
    top: 8,
  },
  largeCross: {
    left: 20,
    top: 12,
  },
  wordmark: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.7,
  },
  compactWordmark: {
    fontSize: 21,
  },
  mobi: {
    color: "#0B3D2E",
  },
  care: {
    color: "#2E9E77",
  },
});