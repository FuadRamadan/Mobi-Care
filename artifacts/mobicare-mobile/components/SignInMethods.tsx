import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPatientProfileQueryKey,
  type PatientProfile,
  useChangePassword,
  useConnectGoogleAccount,
  useDisconnectGoogleAccount,
} from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { GoogleButton, useGoogleClientId } from "@/components/GoogleButton";
import { useColors } from "@/hooks/useColors";
import { confirmAction, notify } from "@/lib/dialogs";
import { errorText } from "@/lib/format";
import { GoogleCancelled, googleIdToken } from "@/lib/googleAuth";

/**
 * How the patient signs in: Google, a password, or both (as the web app's
 * SignInMethods). Google is connected only from here, while signed in, never by
 * matching an email address, so nobody can take over an account with a
 * look-alike Google account.
 */
export function SignInMethods({ profile }: { profile: PatientProfile }) {
  const colors = useColors();
  const s = makeStyles(colors);
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const clientId = useGoogleClientId();
  const connect = useConnectGoogleAccount();
  const disconnect = useDisconnectGoogleAccount();
  const changePassword = useChangePassword();
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const googleConnected = Boolean(profile.googleConnected);
  const hasPassword = profile.hasPassword !== false;
  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetPatientProfileQueryKey() });

  async function onConnect(id: string) {
    setBusy(true);
    try {
      await connect.mutateAsync({ data: { credential: await googleIdToken(id) } });
      await refresh();
      notify("Google connected", "You can now sign in with Google.");
    } catch (err) {
      if (!(err instanceof GoogleCancelled)) {
        notify("Could not connect Google", err instanceof Error && !("data" in err) ? err.message : errorText(err, "Try again."));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onDisconnect() {
    const yes = await confirmAction("Disconnect Google?", "You will sign in with your phone number and password.", {
      confirmText: "Disconnect",
      destructive: true,
    });
    if (!yes) return;
    try {
      await disconnect.mutateAsync();
      await refresh();
      notify("Google disconnected");
    } catch (err) {
      notify("Could not disconnect Google", errorText(err, "Try again."));
    }
  }

  async function onSetPassword() {
    if (newPassword.length < 8 || newPassword !== confirm) return;
    try {
      await changePassword.mutateAsync({ data: { newPassword } });
      // Setting a password signs out every device, this one included.
      notify("Password set", "Sign in again with your phone number and password, or with Google.");
      await logout();
    } catch (err) {
      notify("Could not set your password", errorText(err, "Try again."));
    }
  }

  // Nothing to show until Google sign-in is set up, unless already connected.
  if (!clientId && !googleConnected) return null;

  return (
    <View style={s.card} testID="section-sign-in-methods">
      <View style={s.titleRow}>
        <Feather name="key" size={16} color={colors.primary} />
        <Text style={s.title}>Sign-in methods</Text>
      </View>

      <View style={{ gap: 10 }}>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.strong}>Google</Text>
            <Text style={s.muted}>
              {googleConnected ? "Connected. You can sign in with Google." : "Sign in with one tap, without a password."}
            </Text>
          </View>
          {googleConnected && hasPassword ? (
            <Pressable style={s.outline} onPress={() => void onDisconnect()} disabled={disconnect.isPending} testID="button-disconnect-google">
              <Text style={s.outlineText}>Disconnect</Text>
            </Pressable>
          ) : null}
        </View>
        {!googleConnected ? <GoogleButton onPress={(id) => void onConnect(id)} busy={busy} testID="button-connect-google" /> : null}
      </View>

      <View style={s.divider}>
        <Text style={s.strong}>Password</Text>
        {hasPassword ? (
          <Text style={s.muted}>Set. You can also sign in with your phone number and password.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            <Text style={s.muted}>Your account uses Google only. Set a password to also sign in with your phone number.</Text>
            <TextInput
              style={s.input}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              placeholder="New password (min. 8 characters)"
              placeholderTextColor={colors.mutedForeground}
              autoComplete="new-password"
              testID="input-set-password"
            />
            <TextInput
              style={s.input}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              placeholder="Confirm password"
              placeholderTextColor={colors.mutedForeground}
              autoComplete="new-password"
            />
            {confirm && newPassword !== confirm ? <Text style={{ fontSize: 12, color: colors.destructive }}>The passwords do not match.</Text> : null}
            <Pressable
              style={[s.fill, (changePassword.isPending || newPassword.length < 8 || newPassword !== confirm) && { opacity: 0.5 }]}
              disabled={changePassword.isPending || newPassword.length < 8 || newPassword !== confirm}
              onPress={() => void onSetPassword()}
              testID="button-set-password"
            >
              <Text style={s.fillText}>Set password</Text>
            </Pressable>
          </View>
        )}
      </View>
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
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    strong: { fontSize: 14, fontWeight: "600", color: colors.foreground },
    muted: { fontSize: 12.5, color: colors.mutedForeground, lineHeight: 18, marginTop: 2 },
    divider: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14, gap: 4 },
    outline: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
    outlineText: { fontSize: 13, fontWeight: "600", color: colors.darkGreen },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.foreground,
    },
    fill: { alignSelf: "flex-start", backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
    fillText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  });
}
