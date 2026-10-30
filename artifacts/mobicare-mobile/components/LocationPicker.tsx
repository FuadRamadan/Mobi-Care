import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { MapFrame, type MapFrameHandle } from "@/components/MapFrame";
import { useColors } from "@/hooks/useColors";

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** GeoJSON order: [longitude, latitude]. */
type Position = [number, number];
export type ZoneOutline =
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

/** The outer ring of each part of a zone, as [lat, lng] points for the map. */
function outlineRings(outline: ZoneOutline): Array<Array<[number, number]>> {
  const rings = outline.type === "Polygon" ? [outline.coordinates[0]] : outline.coordinates.map((p) => p[0]);
  return rings
    .filter((ring): ring is Position[] => Array.isArray(ring))
    .map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number]));
}

/** Asks the phone for where it is now. */
export async function currentPosition(): Promise<LatLng> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Location permission was refused. Tap the map to place the pin instead.");
  }
  try {
    // A fresh fix: a cached one from a minute ago may be the wrong street.
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return { latitude: position.coords.latitude, longitude: position.coords.longitude };
  } catch {
    throw new Error("Your location could not be found. Tap the map to place the pin instead.");
  }
}

/**
 * A map to put one pin on, as on the web app: tap to place it, drag to adjust,
 * or use the phone's location. Served areas can be shaded so people see where
 * the pin needs to go.
 */
export function LocationPicker({
  value,
  onChange,
  areas = [],
  locateLabel = "Use my location",
  height = 260,
  testID,
}: {
  value: LatLng | null;
  onChange: (value: LatLng) => void;
  areas?: Array<{ name: string; boundary: ZoneOutline }>;
  locateLabel?: string;
  height?: number;
  testID?: string;
}) {
  const colors = useColors();
  const map = useRef<MapFrameHandle>(null);
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!ready) return;
    map.current?.send({
      target: "mc-map",
      type: "set",
      value,
      areas: areas.map((area) => ({ name: area.name, rings: outlineRings(area.boundary) })),
    });
  }, [ready, value?.latitude, value?.longitude, areas]);

  async function locate() {
    setLocating(true);
    setLocateError(null);
    try {
      const position = await currentPosition();
      onChangeRef.current(position);
      map.current?.send({ target: "mc-map", type: "center", value: position });
    } catch (error) {
      setLocateError(error instanceof Error ? error.message : "Your location could not be found.");
    } finally {
      setLocating(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <MapFrame
        ref={map}
        height={height}
        testID={testID}
        onMessage={(message) => {
          if (message?.type === "ready") setReady(true);
          if (message?.type === "pick") onChangeRef.current({ latitude: message.latitude, longitude: message.longitude });
        }}
      />
      <View style={styles.row}>
        <Pressable
          style={[styles.locate, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={() => void locate()}
          disabled={locating}
          testID="button-use-my-location"
        >
          {locating ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="crosshair" size={15} color={colors.darkGreen} />
          )}
          <Text style={[styles.locateText, { color: colors.darkGreen }]}>{locateLabel}</Text>
        </Pressable>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          {value ? "Drag the pin to adjust." : "Or tap the map to drop a pin."}
        </Text>
      </View>
      {locateError ? <Text style={[styles.hint, { color: colors.destructive }]}>{locateError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  locate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  locateText: { fontSize: 13, fontWeight: "600" },
  hint: { fontSize: 12, flexShrink: 1 },
});
