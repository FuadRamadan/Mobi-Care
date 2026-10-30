import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { useCreatePrescriptionRequest, usePatientUploadPrescription } from "@workspace/api-client-react";
import { MobiCareHeader } from "@/components/MobiCareHeader";
import { LocationPicker, currentPosition, type LatLng } from "@/components/LocationPicker";
import { useColors } from "@/hooks/useColors";
import { exportCovered, type Box } from "@/lib/coverExport";
import { notify } from "@/lib/dialogs";
import { errorText } from "@/lib/format";
import { pickPhoto, toJpegDataUrl, type PickedPhoto } from "@/lib/photos";

type Colors = ReturnType<typeof useColors>;
type Step = "photo" | "cover" | "send";

/**
 * Send a prescription photo to the pharmacies nearby (as the web app's
 * PrescriptionSend). The patient covers their name and other details first:
 * that covered copy is what every pharmacy sees, and the full photo goes only
 * to the pharmacy that takes the prescription.
 */
export default function PrescriptionSendScreen() {
  const colors = useColors();
  const s = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("photo");
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [coveredUrl, setCoveredUrl] = useState<string | null>(null);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const coverView = useRef<View>(null);

  const upload = usePatientUploadPrescription();
  const create = useCreatePrescriptionRequest();
  const busy = upload.isPending || create.isPending;

  // Asked as soon as the patient starts, so it is ready by the last step.
  useEffect(() => {
    setLocating(true);
    currentPosition()
      .then((p) => {
        setPin(p);
        setLocationError(null);
      })
      .catch((e: Error) => setLocationError(e.message))
      .finally(() => setLocating(false));
  }, []);

  async function choose(source: "camera" | "library") {
    const picked = await pickPhoto(source);
    if (!picked) return;
    setPhoto(picked);
    setBoxes([]);
    setStep("cover");
  }

  async function finishCovering(skip: boolean) {
    if (!photo) return;
    if (skip) {
      setCoveredUrl(null);
      setStep("send");
      return;
    }
    setPreparing(true);
    try {
      setCoveredUrl(await exportCovered({ view: coverView, photo, boxes }));
      setStep("send");
    } catch (e) {
      notify("Photo not ready", e instanceof Error ? e.message : "Try again.");
    } finally {
      setPreparing(false);
    }
  }

  async function send() {
    if (!photo) return;
    if (!pin) {
      notify("Location needed", "Use your location or tap the map, so we can find pharmacies near you.");
      return;
    }
    try {
      const original = await upload.mutateAsync({ data: { image: await toJpegDataUrl(photo) } });
      const covered = coveredUrl ? await upload.mutateAsync({ data: { image: coveredUrl } }) : null;
      const request = await create.mutateAsync({
        data: {
          imageKey: original.imageKey,
          ...(covered ? { coveredImageKey: covered.imageKey } : {}),
          latitude: pin.latitude,
          longitude: pin.longitude,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      await queryClient.invalidateQueries();
      router.replace(`/prescription/${request.id}`);
    } catch (err) {
      notify("Not sent", errorText(err, "Check your connection and try again."));
    }
  }

  const back = () => (step === "photo" ? router.back() : setStep(step === "send" ? "cover" : "photo"));

  return (
    <View style={s.container}>
      <MobiCareHeader />
      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        scrollEnabled={!drawing}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <Pressable onPress={back} style={s.back} hitSlop={8} testID="button-back">
            <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
            <Text style={s.backText}>Back</Text>
          </Pressable>
          <Text style={s.title}>Upload prescription</Text>
          <Text style={s.subtitle}>Pharmacies near you see it, and the first one that has your medicines takes it.</Text>
        </View>

        <View style={s.steps}>
          {(["photo", "cover", "send"] as const).map((key, i) => (
            <View key={key} style={[s.step, key === step && s.stepOn]}>
              <Text style={[s.stepText, key === step && s.stepTextOn]}>
                {i + 1}. {key === "photo" ? "Photo" : key === "cover" ? "Cover name" : "Send"}
              </Text>
            </View>
          ))}
        </View>

        {step === "photo" ? (
          <View style={{ gap: 12 }}>
            <Pressable style={s.take} onPress={() => void choose("camera")} testID="button-take-photo">
              <MaterialCommunityIcons name="camera-outline" size={32} color={colors.primary} />
              <Text style={s.bold}>Take a photo of your prescription</Text>
              <Text style={s.meta}>Flat on a table, in good light, the whole page in view</Text>
            </Pressable>
            <Pressable style={s.outline} onPress={() => void choose("library")} testID="button-choose-photo">
              <Feather name="image" size={15} color={colors.darkGreen} />
              <Text style={s.outlineText}>Choose from your photos</Text>
            </Pressable>
          </View>
        ) : null}

        {step === "cover" && photo ? (
          <CoverStep
            photo={photo}
            boxes={boxes}
            onChange={setBoxes}
            onDrawing={setDrawing}
            viewRef={coverView}
            onDone={(skip) => void finishCovering(skip)}
            preparing={preparing}
            colors={colors}
          />
        ) : null}

        {step === "send" && photo ? (
          <View style={{ gap: 16 }}>
            <View style={[s.card, { flexDirection: "row", gap: 12, alignItems: "center" }]}>
              <Image source={{ uri: coveredUrl ?? photo.uri }} style={s.preview} testID="img-preview" />
              <Text style={[s.meta, { flex: 1 }]}>
                {coveredUrl
                  ? "Pharmacies near you will see this covered copy. Only the pharmacy that takes your prescription sees the full photo and your name."
                  : "You did not cover anything, so pharmacies near you will see the whole photo."}
              </Text>
            </View>

            <View style={{ gap: 6 }}>
              <Text style={s.label}>Your location</Text>
              {pin && !locationError ? (
                <View style={[s.card, { flexDirection: "row", alignItems: "center", gap: 8 }]} testID="text-location">
                  <Feather name="map-pin" size={15} color={colors.primary} />
                  <Text style={[s.bodyText, { flex: 1 }]}>Using your current location</Text>
                  <Text style={s.link} onPress={() => setLocationError("Tap the map to move the pin.")}>
                    Change
                  </Text>
                </View>
              ) : (
                <>
                  {locating ? <Text style={s.meta}>Finding your location…</Text> : null}
                  {locationError ? <Text style={s.meta}>{locationError}</Text> : null}
                  <LocationPicker value={pin} onChange={setPin} height={220} testID="map-request-location" />
                </>
              )}
            </View>

            <View style={{ gap: 6 }}>
              <Text style={s.label}>Anything the pharmacist should know? (optional)</Text>
              <TextInput
                style={[s.input, { minHeight: 64 }]}
                value={note}
                onChangeText={setNote}
                maxLength={300}
                multiline
                placeholder="e.g. I need it today, or I prefer a particular brand"
                placeholderTextColor={colors.mutedForeground}
                testID="input-note"
              />
            </View>

            <Pressable
              style={[s.primary, (busy || !pin) && { opacity: 0.5 }]}
              disabled={busy || !pin}
              onPress={() => void send()}
              testID="button-send-request"
            >
              {busy ? <ActivityIndicator color="#FFF" /> : null}
              <Text style={s.primaryText}>{busy ? "Sending…" : "Send to pharmacies near me"}</Text>
            </Pressable>
            <Text style={[s.meta, { textAlign: "center" }]}>
              Nothing is paid yet. You choose quantities and pay after a pharmacist confirms your medicines.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Draw boxes over the name, phone number and address on the photo. */
function CoverStep({
  photo,
  boxes,
  onChange,
  onDrawing,
  viewRef,
  onDone,
  preparing,
  colors,
}: {
  photo: PickedPhoto;
  boxes: Box[];
  onChange: (boxes: Box[]) => void;
  onDrawing: (drawing: boolean) => void;
  viewRef: React.RefObject<View | null>;
  onDone: (skip: boolean) => void;
  preparing: boolean;
  colors: Colors;
}) {
  const s = makeStyles(colors);
  const [width, setWidth] = useState(0);
  const [draft, setDraft] = useState<Box | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Screen points → the photo's own pixels.
  const ratio = width > 0 ? photo.width / width : 1;
  const height = width > 0 ? (width * photo.height) / photo.width : 0;
  const latest = useRef({ boxes, ratio, onChange, onDrawing });
  latest.current = { boxes, ratio, onChange, onDrawing };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        const { locationX, locationY } = event.nativeEvent;
        start.current = { x: locationX, y: locationY };
        latest.current.onDrawing(true);
      },
      onPanResponderMove: (_, gesture) => {
        if (!start.current) return;
        setDraft(normalise(start.current, { x: start.current.x + gesture.dx, y: start.current.y + gesture.dy }));
      },
      onPanResponderRelease: (_, gesture) => {
        const { boxes: current, ratio: r, onChange: change, onDrawing: drawingChanged } = latest.current;
        drawingChanged(false);
        if (!start.current) return;
        const box = normalise(start.current, { x: start.current.x + gesture.dx, y: start.current.y + gesture.dy });
        start.current = null;
        setDraft(null);
        const inPhoto = { x: box.x * r, y: box.y * r, w: box.w * r, h: box.h * r };
        // A tap is not a box: ignore anything smaller than 1% of the photo.
        if (inPhoto.w > photo.width / 100 && inPhoto.h > photo.height / 100) change([...current, inPhoto]);
      },
      onPanResponderTerminate: () => {
        start.current = null;
        setDraft(null);
        latest.current.onDrawing(false);
      },
    }),
  ).current;

  return (
    <View style={{ gap: 12 }}>
      <View style={s.tip}>
        <Feather name="shield" size={18} color={colors.primary} />
        <Text style={[s.bodyText, { flex: 1 }]}>
          Drag a box over your <Text style={s.bold}>name, phone number and address</Text>. Pharmacies nearby see the
          covered copy; only the one that takes your prescription sees the full photo.
        </Text>
      </View>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={s.coverWrap}>
        {width > 0 ? (
          <View ref={viewRef} collapsable={false} style={{ width, height }} {...responder.panHandlers} testID="canvas-cover">
            <Image source={{ uri: photo.uri }} style={{ width, height }} resizeMode="stretch" />
            {boxes.map((b, i) => (
              <View
                key={i}
                pointerEvents="none"
                style={[s.box, { left: b.x / ratio, top: b.y / ratio, width: b.w / ratio, height: b.h / ratio }]}
              />
            ))}
            {draft ? (
              <View pointerEvents="none" style={[s.box, s.draft, { left: draft.x, top: draft.y, width: draft.w, height: draft.h }]} />
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <Pressable
          style={[s.smallBtn, boxes.length === 0 && { opacity: 0.4 }]}
          disabled={boxes.length === 0}
          onPress={() => onChange(boxes.slice(0, -1))}
          testID="button-undo-box"
        >
          <Feather name="corner-up-left" size={14} color={colors.darkGreen} />
          <Text style={s.smallBtnText}>Undo</Text>
        </Pressable>
        <Pressable
          style={[s.smallBtn, boxes.length === 0 && { opacity: 0.4 }]}
          disabled={boxes.length === 0}
          onPress={() => onChange([])}
          testID="button-clear-boxes"
        >
          <Feather name="x-circle" size={14} color={colors.darkGreen} />
          <Text style={s.smallBtnText}>Clear</Text>
        </Pressable>
        <Text style={[s.meta, { marginLeft: "auto" }]}>
          {boxes.length === 0 ? "Nothing covered yet" : `${boxes.length} covered`}
        </Text>
      </View>
      <Pressable
        style={[s.primary, (boxes.length === 0 || preparing) && { opacity: 0.5 }]}
        disabled={boxes.length === 0 || preparing}
        onPress={() => onDone(false)}
        testID="button-cover-done"
      >
        {preparing ? <ActivityIndicator color="#FFF" /> : null}
        <Text style={s.primaryText}>Continue</Text>
      </Pressable>
      <Pressable onPress={() => onDone(true)} hitSlop={6} testID="button-skip-cover">
        <Text style={[s.meta, { textAlign: "center", textDecorationLine: "underline" }]}>Send without covering anything</Text>
      </Pressable>
    </View>
  );
}

function normalise(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 18 },
    back: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8, alignSelf: "flex-start" },
    backText: { fontSize: 14, color: colors.mutedForeground },
    title: { fontSize: 24, fontWeight: "700", color: colors.darkGreen },
    subtitle: { fontSize: 13, color: colors.mutedForeground, marginTop: 2, lineHeight: 19 },
    steps: { flexDirection: "row", gap: 8 },
    step: {
      flex: 1,
      borderRadius: 999,
      paddingVertical: 7,
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    stepOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    stepText: { fontSize: 12, fontWeight: "600", color: colors.mutedForeground },
    stepTextOn: { color: "#FFFFFF" },
    take: {
      borderWidth: 2,
      borderStyle: "dashed",
      borderColor: "#8CC9B5",
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 24,
      alignItems: "center",
      gap: 6,
    },
    bold: { fontSize: 14, fontWeight: "700", color: colors.foreground },
    bodyText: { fontSize: 13.5, color: colors.foreground, lineHeight: 19 },
    meta: { fontSize: 12.5, color: colors.mutedForeground, lineHeight: 18 },
    label: { fontSize: 14, fontWeight: "600", color: colors.foreground },
    link: { fontSize: 12.5, color: colors.primary, fontWeight: "600" },
    outline: {
      flexDirection: "row",
      gap: 8,
      height: 46,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      alignItems: "center",
      justifyContent: "center",
    },
    outlineText: { color: colors.darkGreen, fontWeight: "600", fontSize: 14 },
    tip: {
      flexDirection: "row",
      gap: 8,
      borderWidth: 1,
      borderColor: "#BFE3D6",
      backgroundColor: "#F0F8F4",
      borderRadius: 12,
      padding: 12,
    },
    coverWrap: { borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    box: { position: "absolute", backgroundColor: "#111111" },
    draft: { backgroundColor: "rgba(17,17,17,0.6)" },
    smallBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
      backgroundColor: colors.card,
    },
    smallBtnText: { fontSize: 13, fontWeight: "600", color: colors.darkGreen },
    primary: {
      flexDirection: "row",
      gap: 8,
      height: 50,
      borderRadius: 999,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15.5 },
    card: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 14, padding: 12 },
    preview: { width: 80, height: 96, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14.5,
      color: colors.foreground,
      backgroundColor: colors.card,
      textAlignVertical: "top",
    },
  });
}
