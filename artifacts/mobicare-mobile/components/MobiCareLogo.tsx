import { Image, StyleSheet, Text, View } from "react-native";

type MobiCareLogoProps = {
  compact?: boolean;
  /** On a dark background: the logo sits in a white pill, as on the web app. */
  inverse?: boolean;
};

/** The same pin and wordmark as the web app (public/mobicare-pin.png). */
export function MobiCareLogo({ compact = false, inverse = false }: MobiCareLogoProps) {
  const pinHeight = compact ? 28 : 52;
  return (
    <View
      style={[styles.container, compact && styles.compactGap, inverse && styles.inverseSurface]}
      accessibilityRole="image"
      accessibilityLabel="MobiCare"
    >
      <Image
        source={require("@/assets/images/mobicare-pin.png")}
        style={{ height: pinHeight, width: (pinHeight * 300) / 370 }}
        resizeMode="contain"
      />
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
    gap: 8,
  },
  compactGap: { gap: 6 },
  inverseSurface: {
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  wordmark: {
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.7,
  },
  compactWordmark: {
    fontSize: 18,
    letterSpacing: -0.3,
  },
  mobi: {
    color: "#0B3D2E",
  },
  care: {
    color: "#2E9E77",
  },
});
