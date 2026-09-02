import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPatientProfileQueryKey,
  useGetPatientProfile,
  useUpdatePatientProfile,
} from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

type Colors = ReturnType<typeof import("@/hooks/useColors").useColors>;

export function CompleteRegistrationModal() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { user, dismissProfileCompletion } = useAuth();
  const [ninDraft, setNinDraft] = useState<string | null>(null);
  const [addressDraft, setAddressDraft] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [nationalityDraft, setNationalityDraft] = useState<string | null>(null);
  const pending = Boolean(user?.profileCompletionPending);

  const { data: profile } = useGetPatientProfile({
    query: {
      queryKey: getGetPatientProfileQueryKey(),
      enabled: pending,
    },
  });

  const updateProfile = useUpdatePatientProfile({
    mutation: {
      onSuccess: async (updated) => {
        queryClient.setQueryData(getGetPatientProfileQueryKey(), updated);
        await dismissProfileCompletion();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Registration completed", "Your patient information has been saved.");
      },
      onError: (error) => {
        Alert.alert(
          "Could not save information",
          error instanceof Error ? error.message : "Please try again.",
        );
      },
    },
  });

  if (!pending || !profile || profile.profileComplete) return null;

  const nin = ninDraft ?? profile.nin ?? "";
  const address = addressDraft ?? profile.address ?? "";
  const email = emailDraft ?? profile.email ?? "";
  const nationality = nationalityDraft ?? profile.nationality ?? "";
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSave =
    address.trim().length > 0 &&
    validEmail &&
    nationality.trim().length > 0 &&
    !updateProfile.isPending;
  const s = makeStyles(colors);

  const save = () => {
    if (!canSave) {
      Alert.alert(
        "Complete required details",
        "Enter your address, a valid email, and your nationality. NIN is optional.",
      );
      return;
    }
    updateProfile.mutate({
      data: {
        nin: nin.trim() || null,
        address: address.trim(),
        email: email.trim(),
        nationality: nationality.trim(),
      },
    });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => void dismissProfileCompletion()}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={s.modalCard}>
          <View style={s.iconWrap}>
            <Feather name="user-check" size={25} color={colors.primary} />
          </View>
          <Text style={s.title}>Complete Your Registration</Text>
          <Text style={s.subtitle}>
            Add the remaining details to keep your patient profile complete.
          </Text>
          <ScrollView
            style={s.formScroll}
            contentContainerStyle={s.form}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={s.label}>NIN (Optional)</Text>
            <TextInput
              style={s.input}
              value={nin}
              onChangeText={setNinDraft}
              autoCapitalize="characters"
              placeholder="National identification number"
              placeholderTextColor={colors.mutedForeground}
              maxLength={40}
            />
            <Text style={s.label}>Address</Text>
            <TextInput
              style={[s.input, s.addressInput]}
              value={address}
              onChangeText={setAddressDraft}
              autoCapitalize="sentences"
              placeholder="Your home address"
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={300}
            />
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={setEmailDraft}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              placeholder="you@example.com"
              placeholderTextColor={colors.mutedForeground}
            />
            <Text style={s.label}>Nationality</Text>
            <TextInput
              style={s.input}
              value={nationality}
              onChangeText={setNationalityDraft}
              autoCapitalize="words"
              placeholder="Your nationality"
              placeholderTextColor={colors.mutedForeground}
              maxLength={80}
            />
          </ScrollView>
          <Pressable
            style={[s.saveButton, !canSave && s.saveButtonDisabled]}
            onPress={save}
            disabled={updateProfile.isPending}
          >
            {updateProfile.isPending ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <>
                <Feather name="check" size={18} color={colors.primaryForeground} />
                <Text style={s.saveText}>Save Information</Text>
              </>
            )}
          </Pressable>
          <Pressable
            style={s.laterButton}
            onPress={() => void dismissProfileCompletion()}
            disabled={updateProfile.isPending}
          >
            <Text style={s.laterText}>Not Now</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: "center",
      padding: 20,
      backgroundColor: "rgba(11, 61, 46, 0.58)",
    },
    modalCard: {
      maxHeight: "90%",
      padding: 20,
      borderRadius: colors.radius + 6,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    iconWrap: {
      width: 48,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 24,
      backgroundColor: colors.secondary,
      marginBottom: 14,
    },
    title: { fontSize: 23, fontWeight: "800", color: colors.darkGreen },
    subtitle: {
      marginTop: 5,
      marginBottom: 16,
      fontSize: 14,
      lineHeight: 20,
      color: colors.mutedForeground,
    },
    formScroll: { flexGrow: 0 },
    form: { gap: 8 },
    label: { marginTop: 3, fontSize: 13, fontWeight: "700", color: colors.foreground },
    input: {
      minHeight: 48,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: colors.input,
      borderRadius: colors.radius,
      backgroundColor: colors.background,
      color: colors.foreground,
      fontSize: 15,
    },
    addressInput: {
      minHeight: 76,
      paddingTop: 13,
      textAlignVertical: "top",
    },
    saveButton: {
      minHeight: 50,
      marginTop: 18,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: colors.radius,
      backgroundColor: colors.primary,
    },
    saveButtonDisabled: { opacity: 0.45 },
    saveText: { color: colors.primaryForeground, fontSize: 15, fontWeight: "800" },
    laterButton: { alignItems: "center", paddingVertical: 13 },
    laterText: { color: colors.mutedForeground, fontSize: 14, fontWeight: "700" },
  });
}