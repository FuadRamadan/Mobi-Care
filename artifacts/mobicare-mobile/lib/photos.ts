import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { notify } from "@/lib/dialogs";

/** Long edge of the photos sent: sharp enough to read, well under the 5 MB limit (as on the web app). */
export const MAX_EDGE = 1600;

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

/** A photo from the camera or the gallery, or null if the patient changed their mind. */
export async function pickPhoto(source: "camera" | "library"): Promise<PickedPhoto | null> {
  if (Platform.OS !== "web") {
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      notify(
        "Permission needed",
        source === "camera"
          ? "Allow camera access to take a photo of your prescription."
          : "Allow access to your photos to choose your prescription.",
      );
      return null;
    }
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1 };
  const result =
    source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

/** The photo as a JPEG data URL, scaled down to MAX_EDGE, ready to upload. */
export async function toJpegDataUrl(photo: PickedPhoto): Promise<string> {
  const context = ImageManipulator.manipulate(photo.uri);
  const longEdge = Math.max(photo.width, photo.height);
  if (longEdge > MAX_EDGE) {
    context.resize(photo.width >= photo.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
  if (!saved.base64) throw new Error("This photo could not be read. Try another one.");
  return `data:image/jpeg;base64,${saved.base64}`;
}
