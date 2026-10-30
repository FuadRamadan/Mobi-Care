import type { RefObject } from "react";
import type { View } from "react-native";
import { MAX_EDGE, type PickedPhoto } from "@/lib/photos";

/** A box the patient drew, in the photo's own pixels. */
export type Box = { x: number; y: number; w: number; h: number };

/** The web test build paints the boxes on a canvas, as the web app does. */
export async function exportCovered({
  photo,
  boxes,
}: {
  view: RefObject<View | null>;
  photo: PickedPhoto;
  boxes: Box[];
}): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("This photo could not be opened. Try another one."));
    image.src = photo.uri;
  });
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111";
  const ratio = img.naturalWidth / photo.width;
  for (const b of boxes) ctx.fillRect(b.x * ratio * scale, b.y * ratio * scale, b.w * ratio * scale, b.h * ratio * scale);
  return canvas.toDataURL("image/jpeg", 0.85);
}
