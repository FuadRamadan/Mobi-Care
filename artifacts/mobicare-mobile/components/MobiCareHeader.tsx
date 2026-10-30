import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MobiCareLogo } from "@/components/MobiCareLogo";
import { useAuth } from "@/context/AuthContext";
import { firstName, freetownGreeting } from "@/lib/greeting";

/**
 * The top bar, as on the web app: dark green, the logo in a white pill, and a
 * greeting instead of buttons (alerts live in the tab bar, sign out in Profile).
 * It reaches up under the status bar, so screens add no top padding of their own.
 */
export function MobiCareHeader() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const greeting = useFreetownGreeting();
  // The web build is only for testing; it has no status bar to clear.
  const top = Platform.OS === "web" ? 0 : insets.top;
  return (
    <View style={[styles.bar, { paddingTop: top }]}>
      <StatusBar style="light" />
      <View style={styles.row}>
        <Pressable onPress={() => router.navigate("/(tabs)")} accessibilityLabel="MobiCare" hitSlop={6}>
          <MobiCareLogo compact inverse />
        </Pressable>
        {user ? (
          <Text style={styles.greeting} numberOfLines={1} testID="text-greeting">
            {greeting}, {firstName(user.name)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Moves on by itself while the app stays open. */
function useFreetownGreeting(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return freetownGreeting(now);
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: "#0B3D2E",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    zIndex: 10,
  },
  row: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    gap: 12,
  },
  greeting: {
    flexShrink: 1,
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "right",
  },
});
