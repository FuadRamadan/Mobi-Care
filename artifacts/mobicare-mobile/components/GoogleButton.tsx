import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { getGetGoogleSignInConfigQueryKey, useGetGoogleSignInConfig } from "@workspace/api-client-react";

/** Google's "G", drawn to Google's brand guidelines for sign-in buttons. */
function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <Path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <Path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <Path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </Svg>
  );
}

/** MobiCare's Google Client ID from the server; null until HQ has set Google sign-in up. */
export function useGoogleClientId(): string | null {
  const { data } = useGetGoogleSignInConfig({
    query: { queryKey: getGetGoogleSignInConfigQueryKey(), staleTime: 10 * 60_000, retry: false },
  });
  return data?.clientId ?? null;
}

/**
 * A "Continue with Google" button in Google's style. Renders nothing until the
 * server has a Google Client ID, so the app works as before without it.
 */
export function GoogleButton({
  label = "Continue with Google",
  onPress,
  busy,
  testID = "button-google",
}: {
  label?: string;
  onPress: (clientId: string) => void;
  busy?: boolean;
  testID?: string;
}) {
  const clientId = useGoogleClientId();
  if (!clientId) return null;
  return (
    <Pressable style={[styles.button, busy && { opacity: 0.6 }]} onPress={() => onPress(clientId)} disabled={busy} testID={testID}>
      {busy ? <ActivityIndicator size="small" color="#1F1F1F" /> : <GoogleG />}
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

/** "or" between Google and the phone-number form. */
export function GoogleDivider() {
  const clientId = useGoogleClientId();
  if (!clientId) return null;
  return (
    <View style={styles.divider}>
      <View style={styles.line} />
      <Text style={styles.or}>or</Text>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#747775",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  label: { fontSize: 15, fontWeight: "600", color: "#1F1F1F" },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 16 },
  line: { flex: 1, height: 1, backgroundColor: "#E5E7EB" },
  or: { fontSize: 12, color: "#6B7280", fontWeight: "600" },
});
