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
  const { user, updateUser } = useAuth();
  const [nameDraft, setNameDraft] = useState<string | null>(null);
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
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Profile updated", "Your name has been saved.");
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
  const photoUrl = absoluteImageUrl(profile?.profileImageUrl);

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
              <Text style={s.label}>Age</Text>
              <View style={s.readOnlyRow}>
                <Feather name="calendar" size={17} color={colors.mutedForeground} />
                <Text style={s.readOnlyText}>{profile.age}</Text>
              </View>
              <Pressable
                style={[
                  s.saveButton,
                  (updateProfile.isPending || currentName.trim().length < 2 || currentName.trim() === profile.name) &&
                    s.saveButtonDisabled,
                ]}
                disabled={
                  updateProfile.isPending ||
                  currentName.trim().length < 2 ||
                  currentName.trim() === profile.name
                }
                onPress={() => updateProfile.mutate({ data: { name: currentName.trim() } })}
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
    readOnlyRow: { height: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: colors.radius, backgroundColor: colors.muted },
    readOnlyText: { color: colors.mutedForeground, fontSize: 15 },
    saveButton: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: colors.radius, backgroundColor: colors.primary, marginTop: 12 },
    saveButtonDisabled: { opacity: 0.45 },
    saveText: { color: "#FFF", fontSize: 15, fontWeight: "800" },
  });
}