/**
 * The patient's own controls, as on the web app's PrivacyPanel: what they have
 * agreed to, a copy of everything held about them, and the right to have it
 * erased. A right that requires emailing someone is not one most people use.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import {
  erasePatientAccount,
  exportPatientData,
  getPatientPrivacy,
  recordPatientConsent,
} from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { Box } from "@/components/ConsentChoices";
import { GoogleButton } from "@/components/GoogleButton";
import { GoogleCancelled, googleIdToken } from "@/lib/googleAuth";
import { notify } from "@/lib/dialogs";
import { errorText } from "@/lib/format";
import { useColors } from "@/hooks/useColors";

const ERASURE_PHRASE = "DELETE MY ACCOUNT";

/**
 * `hasPassword` false = the account was made with Google and has no password,
 * so deleting it is confirmed by signing in with that Google account again.
 */
export function PrivacyPanel({ hasPassword = true }: { hasPassword?: boolean }) {
  const colors = useColors();
  const s = makeStyles(colors);
  const { logout } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [googleCredential, setGoogleCredential] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [erasing, setErasing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getPatientPrivacy()
      .then((state) => {
        setAnalytics(state.mayRecordAnalytics);
        setLoaded(true);
      })
      .catch(() => {});
  }, []);

  const saveAnalytics = async (granted: boolean) => {
    setAnalytics(granted);
    setSaving(true);
    try {
      // Only the optional choice: withdrawing the required one belongs with deleting the account.
      await recordPatientConsent({ termsAndPrivacy: true, researchAnalytics: granted });
      notify(granted ? "Thank you — your searches will be counted" : "Your searches will not be recorded");
    } catch {
      setAnalytics(!granted);
      notify("Could not save that", "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      const data = await exportPatientData();
      const text = JSON.stringify(data, null, 2);
      if (Platform.OS === "web") {
        const href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = href;
        link.download = "mobicare-my-data.json";
        link.click();
        URL.revokeObjectURL(href);
        return;
      }
      const file = new File(Paths.cache, "mobicare-my-data.json");
      if (file.exists) file.delete();
      file.create();
      file.write(text);
      // The phone's own share sheet: save to Files, email it, or send it on.
      await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "Your MobiCare data" });
    } catch {
      notify("Could not prepare your data", "Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const erase = async () => {
    setErasing(true);
    setError("");
    try {
      await erasePatientAccount(
        hasPassword ? { password, confirm: ERASURE_PHRASE } : { googleCredential: googleCredential!, confirm: ERASURE_PHRASE },
      );
      setEraseOpen(false);
      // Nothing to return to: the account is gone.
      await logout();
    } catch (err) {
      setError(errorText(err, "Could not delete your account. Nothing has been changed."));
    } finally {
      setErasing(false);
    }
  };

  const confirmedIdentity = hasPassword ? password.length > 0 : Boolean(googleCredential);

  return (
    <View style={s.card} testID="privacy-panel">
      <View style={s.titleRow}>
        <Feather name="shield" size={16} color={colors.primary} />
        <Text style={s.title}>Your data</Text>
      </View>

      <Pressable
        style={s.row}
        disabled={saving || !loaded}
        onPress={() => void saveAnalytics(!analytics)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: analytics }}
        testID="checkbox-analytics-consent"
      >
        <Box checked={analytics} />
        <Text style={s.text}>
          <Text style={s.strong}>Help improve medicine access.</Text> Counts your searches, including medicines you could
          not find and your area (zone or district, never your exact location), in combined figures shared with health
          authorities and partners. Never your name, prescriptions or orders. Turning this off stops the recording; it
          does not affect your orders.
        </Text>
      </Pressable>

      <View style={s.buttons}>
        <Pressable style={s.outline} onPress={() => void download()} disabled={downloading} testID="button-download-my-data">
          {downloading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="download" size={15} color={colors.darkGreen} />
          )}
          <Text style={s.outlineText}>Download my data</Text>
        </Pressable>
        <Pressable
          style={[s.outline, s.danger]}
          onPress={() => {
            setPassword("");
            setGoogleCredential(null);
            setTyped("");
            setError("");
            setEraseOpen(true);
          }}
          testID="button-delete-account"
        >
          <Feather name="trash-2" size={15} color={colors.destructive} />
          <Text style={[s.outlineText, { color: colors.destructive }]}>Delete my account</Text>
        </Pressable>
      </View>

      <Modal transparent animationType="fade" visible={eraseOpen} onRequestClose={() => setEraseOpen(false)}>
        <View style={s.backdrop}>
          <View style={s.dialog}>
            <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
              <Text style={s.dialogTitle}>Delete your account?</Text>
              <Text style={s.muted}>This cannot be undone.</Text>
              <View>
                <Text style={s.strong}>Removed</Text>
                <Text style={s.muted}>
                  • Your name, phone number, address and photo{"\n"}• Your search history and notifications{"\n"}•
                  Prescription photos you uploaded but never used{"\n"}• Every device you are signed in on
                </Text>
              </View>
              <View>
                <Text style={s.strong}>Kept, without your name on it</Text>
                <Text style={s.muted}>
                  Orders you placed, and any prescription a pharmacist reviewed for them. A pharmacy has to keep a record
                  of the medicine it dispensed — but after this it no longer says who it was for.
                </Text>
              </View>
              {error ? <Text style={{ color: colors.destructive, fontSize: 13 }}>{error}</Text> : null}
              {hasPassword ? (
                <>
                  <Text style={s.label}>Your password</Text>
                  <TextInput
                    style={s.input}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoComplete="current-password"
                    testID="input-erase-password"
                  />
                </>
              ) : googleCredential ? (
                <Text style={{ color: colors.primary, fontSize: 13 }} testID="text-erase-google-confirmed">
                  Confirmed with your Google account.
                </Text>
              ) : (
                <View style={{ gap: 8 }}>
                  <Text style={s.muted}>Your account signs in with Google. Confirm it is you:</Text>
                  <GoogleButton
                    onPress={async (clientId) => {
                      try {
                        setGoogleCredential(await googleIdToken(clientId));
                      } catch (err) {
                        if (!(err instanceof GoogleCancelled)) setError(err instanceof Error ? err.message : "Google did not confirm it.");
                      }
                    }}
                    testID="button-erase-google"
                  />
                </View>
              )}
              <Text style={s.label}>Type {ERASURE_PHRASE} to confirm</Text>
              <TextInput
                style={s.input}
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="characters"
                autoCorrect={false}
                testID="input-erase-confirm"
              />
              <View style={s.buttons}>
                <Pressable style={s.outline} onPress={() => setEraseOpen(false)} disabled={erasing}>
                  <Text style={s.outlineText}>Keep my account</Text>
                </Pressable>
                <Pressable
                  style={[s.dangerFill, (erasing || !confirmedIdentity || typed.trim() !== ERASURE_PHRASE) && { opacity: 0.5 }]}
                  disabled={erasing || !confirmedIdentity || typed.trim() !== ERASURE_PHRASE}
                  onPress={() => void erase()}
                  testID="button-confirm-erase"
                >
                  <Text style={s.dangerFillText}>{erasing ? "Deleting…" : "Delete my account"}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius + 4,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 18,
      gap: 14,
    },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    title: { fontSize: 16, fontWeight: "700", color: colors.foreground },
    row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    text: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.mutedForeground },
    strong: { color: colors.foreground, fontWeight: "600", fontSize: 13 },
    muted: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
    buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    outline: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
      backgroundColor: colors.card,
    },
    outlineText: { fontSize: 13, fontWeight: "600", color: colors.darkGreen },
    danger: { borderColor: "#F3B4B4" },
    dangerFill: {
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: colors.destructive,
    },
    dangerFillText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 20 },
    dialog: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 20, maxHeight: "85%" },
    dialogTitle: { fontSize: 19, fontWeight: "700", color: colors.darkGreen },
    label: { fontSize: 13, fontWeight: "600", color: colors.foreground },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.foreground,
    },
  });
}
