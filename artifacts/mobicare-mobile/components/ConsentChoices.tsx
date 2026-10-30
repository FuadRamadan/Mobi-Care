import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";

/**
 * The two consent decisions, worded as on the web app (patient/ConsentChoices).
 * Two separate choices, not one bundled "I agree": the first makes it lawful to
 * hold someone's prescriptions; the second is optional and refusing it costs
 * nothing. The optional one starts ticked (policy 2026-10-11), except for
 * someone who has already said no.
 */
export interface ConsentChoiceState {
  termsAndPrivacy: boolean;
  researchAnalytics: boolean;
}

export const EMPTY_CONSENT: ConsentChoiceState = {
  termsAndPrivacy: false,
  researchAnalytics: true,
};

const site = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
const openPage = (path: string) => void WebBrowser.openBrowserAsync(`${site}${path}`);

export function ConsentChoices({
  value,
  onChange,
  disabled,
}: {
  value: ConsentChoiceState;
  onChange: (next: ConsentChoiceState) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.block}>
      <Pressable
        style={styles.row}
        disabled={disabled}
        onPress={() => onChange({ ...value, termsAndPrivacy: !value.termsAndPrivacy })}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: value.termsAndPrivacy, disabled }}
        testID="checkbox-terms"
      >
        <Box checked={value.termsAndPrivacy} />
        <Text style={styles.text}>
          <Text style={styles.strong}>
            I agree to the{" "}
            <Text style={styles.link} onPress={() => openPage("/terms")}>terms</Text> and{" "}
            <Text style={styles.link} onPress={() => openPage("/privacy")}>privacy notice</Text>.
          </Text>{" "}
          MobiCare holds your details, prescriptions and orders. A pharmacy you order from sees what it needs to
          dispense your medicine.
        </Text>
      </Pressable>

      <Pressable
        style={styles.row}
        disabled={disabled}
        onPress={() => onChange({ ...value, researchAnalytics: !value.researchAnalytics })}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: value.researchAnalytics, disabled }}
        testID="checkbox-research"
      >
        <Box checked={value.researchAnalytics} />
        <Text style={styles.text}>
          <Text style={styles.strong}>Help improve medicine access.</Text> Optional. Counts your searches, including
          medicines you could not find and your area (zone or district, never your exact location), in combined figures
          shared with health authorities and partners. Never your name, prescriptions or orders. Untick to say no; it
          changes nothing about your orders, and you can change your mind later.
        </Text>
      </Pressable>
    </View>
  );
}

export function Box({ checked }: { checked: boolean }) {
  return (
    <View style={[styles.box, checked && styles.boxOn]}>
      {checked ? <Text style={styles.tick}>✓</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 12 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  box: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#9CA3AF",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  boxOn: { backgroundColor: "#0B3D2E", borderColor: "#0B3D2E" },
  tick: { color: "#FFFFFF", fontSize: 13, lineHeight: 16, fontWeight: "700" },
  text: { flex: 1, fontSize: 12, lineHeight: 17, color: "#6B7280" },
  strong: { color: "#111827", fontWeight: "600" },
  link: { color: "#1A8F6E", textDecorationLine: "underline" },
});
