/**
 * Asks patients who registered before consent existed, and everyone again
 * whenever the policy text materially changes (as the web app's ConsentGate).
 *
 * Not dismissible, because it is the decision that makes it lawful to keep
 * holding this person's prescriptions. But not a lock-out either: the server
 * only refuses to create anything new, and someone who wants to read their
 * orders, download their data or delete their account must still be able to.
 * "Not now" therefore closes it until the app is next opened.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getPatientPrivacy, recordPatientConsent } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { ConsentChoices, EMPTY_CONSENT, type ConsentChoiceState } from "@/components/ConsentChoices";

export function ConsentGate() {
  const { user } = useAuth();
  const [needed, setNeeded] = useState(false);
  const [choices, setChoices] = useState<ConsentChoiceState>(EMPTY_CONSENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const state = await getPatientPrivacy();
        if (cancelled) return;
        setNeeded(state.needsConsent);
        // Someone who already said no to the optional choice is not ticked again.
        const saidNo =
          state.researchAnalytics?.policyVersion != null && state.researchAnalytics.granted === false;
        setChoices({ termsAndPrivacy: false, researchAnalytics: !saidNo });
      } catch {
        // A failed check must not block the app. The server is the real gate.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await recordPatientConsent({ termsAndPrivacy: true, researchAnalytics: choices.researchAnalytics });
      setNeeded(false);
    } catch {
      setError("Could not save that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!user || !needed) return null;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => setNeeded(false)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ScrollView contentContainerStyle={{ gap: 14 }}>
            <Text style={styles.title}>Before you continue</Text>
            <Text style={styles.body}>
              We have set out clearly how MobiCare handles your information. Please read and agree to carry on
              ordering.
            </Text>
            <ConsentChoices value={choices} onChange={setChoices} disabled={busy} />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={[styles.button, (busy || !choices.termsAndPrivacy) && styles.buttonOff]}
              disabled={busy || !choices.termsAndPrivacy}
              onPress={() => void submit()}
              testID="button-accept-consent"
            >
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.buttonText}>Agree and continue</Text>}
            </Pressable>
            <Pressable onPress={() => setNeeded(false)} hitSlop={8}>
              <Text style={styles.later}>Not now</Text>
            </Pressable>
            <Text style={styles.note}>
              You can still view your orders and download or delete your data without agreeing — see Profile.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "center", padding: 20 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 20, maxHeight: "85%" },
  title: { fontSize: 19, fontWeight: "700", color: "#0B3D2E" },
  body: { fontSize: 14, lineHeight: 20, color: "#4B5563" },
  error: { fontSize: 13, color: "#E84040" },
  button: {
    height: 48,
    borderRadius: 999,
    backgroundColor: "#1A8F6E",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonOff: { opacity: 0.5 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  later: { textAlign: "center", fontSize: 13, color: "#6B7C76", fontWeight: "600" },
  note: { fontSize: 12, color: "#6B7C76", lineHeight: 17 },
});
