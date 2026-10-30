import type { RefObject } from "react";
import type { View } from "react-native";
import { captureRef } from "react-native-view-shot";
import { MAX_EDGE, type PickedPhoto } from "@/lib/photos";

/** A box the patient drew, in the photo's own pixels. */
export type Box = { x: number; y: number; w: number; h: number };

/**
 * The covered copy of the prescription: the photo with the boxes painted over
 * it, as a JPEG data URL no larger than MAX_EDGE. On phones the on-screen view
 * (photo plus black boxes) is captured at the photo's own resolution.
 */
export async function exportCovered({
  view,
  photo,
}: {
  view: RefObject<View | null>;
  photo: PickedPhoto;
  boxes: Box[];
}): Promise<string> {
  const scale = Math.min(1, MAX_EDGE / Math.max(photo.width, photo.height));
  return captureRef(view, {
    format: "jpg",
    quality: 0.85,
    result: "data-uri",
    width: Math.round(photo.width * scale),
    height: Math.round(photo.height * scale),
  });
}
