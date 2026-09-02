import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetPatientProfileQueryKey,
  useGetPatientProfile,
  useUpdatePatientProfile,
  useUpdatePatientProfilePhoto,
} from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { MobiCareHeader } from "@/components/MobiCareHeader";

type Colors = ReturnType<typeof import("@/hooks/useColors").useColors>;

function absoluteImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `https://${process.env.EXPO_PUBLIC_DOMAIN}${path}`;
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user, updateUser, logout } = useAuth();
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [ninDraft, setNinDraft] = useState<string | null>(null);
  const [addressDraft, setAddressDraft] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [nationalityDraft, setNationalityDraft] = useState<string | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const isWeb = Platform.OS === "web";
  const topPad = isWeb ? insets.top + 67 : insets.top;

  const { data: profile, isLoading, isError, refetch } = useGetPatientProfile({
    query: { queryKey: getGetPatientProfileQueryKey() },
  });

  const updateProfile = useUpdatePatientProfile({
    mutation: {
      onSuccess: async (updated) => {
        queryClient.setQueryData(getGetPatientProfileQueryKey(), updated);
        await updateUser({ name: updated.name });
        setNameDraft(null);
        setNinDraft(null);
        setAddressDraft(null);
        setEmailDraft(null);
        setNationalityDraft(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Profile updated", "Your patient information has been saved.");
      },
      onError: (error) => {
        Alert.alert("Could not update profile", error instanceof Error ? error.message : "Please try again.");
      },
    },
  });

  const updatePhoto = useUpdatePatientProfilePhoto({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetPatientProfileQueryKey(), updated);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      },
      onError: (error) => {
        Alert.alert("Could not update photo", error instanceof Error ? error.message : "Please try again.");
      },
    },
  });

  const selectImage = async (source: "camera" | "library") => {
    if (source === "camera" && Platform.OS !== "web") {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission needed", "Allow camera access to take a profile photo.");
        return;
      }
    }
    if (source === "library" && Platform.OS !== "web") {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission needed", "Allow photo access to choose a profile picture.");
        return;
      }
    }
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
            base64: true,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
            base64: true,
          });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) {
      if (!result.canceled) Alert.alert("Could not read photo", "Please choose another image.");
      return;
    }
    updatePhoto.mutate({
      data: {
        image: `data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}`,
      },
    });
  };

  const choosePhoto = () => {
    Alert.alert("Profile picture", "Choose a photo source.", [
      { text: "Camera", onPress: () => void selectImage("camera") },
      { text: "Photo Library", onPress: () => void selectImage("library") },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const s = makeStyles(colors);
  const currentName = nameDraft ?? profile?.name ?? user?.name ?? "";
  const currentNin = ninDraft ?? profile?.nin ?? "";
  const currentAddress = addressDraft ?? profile?.address ?? "";
  const currentEmail = emailDraft ?? profile?.email ?? "";
  const currentNationality = nationalityDraft ?? profile?.nationality ?? "";
  const photoUrl = absoluteImageUrl(profile?.profileImageUrl);
  const hasChanges = Boolean(
    profile &&
      (currentName.trim() !== profile.name ||
        currentNin.trim() !== (profile.nin ?? "") ||
        currentAddress.trim() !== (profile.address ?? "") ||
        currentEmail.trim() !== (profile.email ?? "") ||
        currentNationality.trim() !== (profile.nationality ?? "")),
  );

  const saveProfile = () => {
    updateProfile.mutate({
      data: {
        name: currentName.trim(),
        nin: currentNin.trim() || null,
        address: currentAddress.trim() || null,
        email: currentEmail.trim() || null,
        nationality: currentNationality.trim() || null,
      },
    });
  };

  const exitSession = async () => {
    setIsExiting(true);
    try {
      await logout();
    } catch {
      setIsExiting(false);
      Alert.alert("Could not exit", "Your session could not be closed. Please try again.");
    }
  };

  const confirmExit = () => {
    if (Platform.OS === "web") {
      const confirmed = window.confirm("Exit MobiCare?\n\nAre you sure you want to exit your patient session?");
      if (confirmed) void exitSession();
      return;
    }

    Alert.alert(
      "Exit MobiCare?",
      "Are you sure you want to exit your patient session?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Exit", style: "destructive", onPress: () => void exitSession() },
      ],
    );
  };

  return (
    <View style={[s.container, { paddingTop: topPad }]}>
      <MobiCareHeader />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>Profile</Text>
        <Text style={s.subtitle}>Manage your patient account information.</Text>

        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={s.loading} />
        ) : isError || !profile ? (
          <View style={s.errorCard}>
            <Text style={s.errorText}>Could not load your profile.</Text>
            <Pressable onPress={() => refetch()} style={s.retryButton}>
              <Text style={s.retryText}>Try Again</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={s.photoSection}>
              <View style={s.photoWrap}>
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={s.photo} resizeMode="cover" />
                ) : (
                  <View style={s.photoFallback}>
                    <Text style={s.initials}>
                      {profile.name
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((part) => part[0]?.toUpperCase())
                        .join("")}
                    </Text>
                  </View>
                )}
                <Pressable
                  style={s.cameraButton}
                  onPress={choosePhoto}
                  disabled={updatePhoto.isPending}
                  accessibilityLabel="Change profile picture"
                >
                  {updatePhoto.isPending ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Ionicons name="camera" size={19} color="#FFF" />
                  )}
                </Pressable>
              </View>
              <Pressable onPress={choosePhoto} disabled={updatePhoto.isPending}>
                <Text style={s.changePhotoText}>
                  {photoUrl ? "Change profile picture" : "Upload profile picture"}
                </Text>
              </Pressable>
            </View>

            <View style={s.card}>
              <Text style={s.label}>Full Name</Text>
              <TextInput
                style={s.input}
                value={currentName}
                onChangeText={setNameDraft}
                autoCapitalize="words"
                placeholder="Your full name"
                placeholderTextColor={colors.mutedForeground}
              />
              <Text style={s.label}>Phone Number</Text>
              <View style={s.readOnlyRow}>
                <Feather name="phone" size={17} color={colors.mutedForeground} />
                <Text style={s.readOnlyText}>{profile.phone}</Text>
              </View>
              <Text style={s.label}>Date of Birth</Text>
              <View style={s.readOnlyRow}>
                <Feather name="calendar" size={17} color={colors.mutedForeground} />
                <Text style={s.readOnlyText}>{profile.dateOfBirth ?? "Not available"}</Text>
              </View>
              <Text style={s.label}>Age</Text>
              <View style={s.readOnlyRow}>
                <Feather name="calendar" size={17} color={colors.mutedForeground} />
                <Text style={s.readOnlyText}>{profile.age}</Text>
              </View>
              <Text style={s.immutableHint}>Date of birth and age are fixed at registration.</Text>
              <Text style={s.label}>NIN (Optional)</Text>
              <TextInput
                style={s.input}
                value={currentNin}
                onChangeText={setNinDraft}
                autoCapitalize="characters"
                placeholder="National identification number"
                placeholderTextColor={colors.mutedForeground}
                maxLength={40}
              />
              <Text style={s.label}>Address</Text>
              <TextInput
                style={[s.input, s.addressInput]}
                value={currentAddress}
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
                value={currentEmail}
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
                value={currentNationality}
                onChangeText={setNationalityDraft}
                autoCapitalize="words"
                placeholder="Your nationality"
                placeholderTextColor={colors.mutedForeground}
                maxLength={80}
              />
              <Pressable
                style={[
                  s.saveButton,
                  (updateProfile.isPending || currentName.trim().length < 2 || !hasChanges) &&
                    s.saveButtonDisabled,
                ]}
                disabled={
                  updateProfile.isPending ||
                  currentName.trim().length < 2 ||
                  !hasChanges
                }
                onPress={saveProfile}
              >
                {updateProfile.isPending ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Feather name="save" size={17} color="#FFF" />
                    <Text style={s.saveText}>Save Changes</Text>
                  </>
                )}
              </Pressable>
            </View>

            <View style={s.sessionSection}>
              <Text style={s.sessionTitle}>Session</Text>
              <Text style={s.sessionHint}>Exit securely when you have finished using MobiCare.</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Exit patient session"
                testID="profile-exit-button"
                disabled={isExiting}
                onPress={confirmExit}
                style={({ pressed }) => [
                  s.exitButton,
                  pressed && !isExiting && s.exitButtonPressed,
                  isExiting && s.exitButtonDisabled,
                ]}
              >
                {isExiting ? (
                  <ActivityIndicator size="small" color={colors.destructive} />
                ) : (
                  <Feather name="log-out" size={18} color={colors.destructive} />
                )}
                <Text style={s.exitText}>{isExiting ? "Exiting…" : "Exit"}</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, paddingBottom: 120 },
    title: { fontSize: 26, fontWeight: "800", color: colors.darkGreen },
    subtitle: { fontSize: 14, color: colors.mutedForeground, marginTop: 4 },
    loading: { marginTop: 80 },
    errorCard: { alignItems: "center", gap: 12, marginTop: 60 },
    errorText: { color: colors.mutedForeground },
    retryButton: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: colors.radius, backgroundColor: colors.secondary },
    retryText: { color: colors.primary, fontWeight: "700" },
    photoSection: { alignItems: "center", marginVertical: 26, gap: 10 },
    photoWrap: { position: "relative" },
    photo: { width: 112, height: 112, borderRadius: 56, borderWidth: 4, borderColor: colors.card },
    photoFallback: { width: 112, height: 112, borderRadius: 56, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary, borderWidth: 4, borderColor: colors.card },
    initials: { fontSize: 34, fontWeight: "800", color: colors.primary },
    cameraButton: { position: "absolute", right: 0, bottom: 0, width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, borderWidth: 3, borderColor: colors.background },
    changePhotoText: { color: colors.primary, fontSize: 14, fontWeight: "700" },
    card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: colors.radius + 4, padding: 18, gap: 9 },
    label: { color: colors.foreground, fontSize: 13, fontWeight: "700", marginTop: 4 },
    input: { height: 50, borderWidth: 1, borderColor: colors.input, borderRadius: colors.radius, paddingHorizontal: 14, fontSize: 16, color: colors.foreground, backgroundColor: colors.background },
    addressInput: { minHeight: 86, height: "auto", paddingTop: 14, textAlignVertical: "top" },
    readOnlyRow: { height: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: colors.radius, backgroundColor: colors.muted },
    readOnlyText: { color: colors.mutedForeground, fontSize: 15 },
    immutableHint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
    saveButton: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: colors.radius, backgroundColor: colors.primary, marginTop: 12 },
    saveButtonDisabled: { opacity: 0.45 },
    saveText: { color: "#FFF", fontSize: 15, fontWeight: "800" },
    sessionSection: { marginTop: 20, padding: 18, borderWidth: 1, borderColor: colors.border, borderRadius: colors.radius + 4, backgroundColor: colors.card, gap: 7 },
    sessionTitle: { color: colors.foreground, fontSize: 15, fontWeight: "800" },
    sessionHint: { color: colors.mutedForeground, fontSize: 13, lineHeight: 18 },
    exitButton: { minHeight: 48, marginTop: 5, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: colors.destructive, borderRadius: colors.radius, backgroundColor: colors.background },
    exitButtonPressed: { opacity: 0.72 },
    exitButtonDisabled: { opacity: 0.5 },
    exitText: { color: colors.destructive, fontSize: 15, fontWeight: "800" },
  });
}