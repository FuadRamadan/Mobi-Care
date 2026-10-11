import { freshAccessToken } from "./session";

/** Why the image could not be shown or saved, in words for the pharmacist. */
export class PrescriptionFileError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * The prescription image, fetched with the pharmacy's own sign-in.
 *
 * Fetched rather than opened in a new window: browsers block a window that
 * opens after waiting on the network, which on a slow connection meant the
 * image never appeared.
 *
 * `download` saves the pharmacy's own copy and starts the 15 minutes after
 * which MobiCare deletes the image.
 */
export async function fetchPrescriptionFile(
  id: string,
  download: boolean,
): Promise<{ blob: Blob; filename: string }> {
  const base = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
  const token = await freshAccessToken();
  let response: Response;
  try {
    response = await fetch(
      `${base}/api/pharmacy/prescriptions/${encodeURIComponent(id)}/file${download ? "?download=1" : ""}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" },
    );
  } catch {
    throw new PrescriptionFileError("Could not reach MobiCare. Check the internet connection and try again.", null, 0);
  }
  if (!response.ok) {
    let message = "The prescription image could not be loaded. Try again.";
    let code: string | null = null;
    try {
      const body = (await response.json()) as { error?: string; code?: string };
      if (body.error) message = body.error;
      code = body.code ?? null;
    } catch {
      // Not JSON: keep the general message.
    }
    if (response.status === 401) message = "Your session has ended. Sign in again.";
    throw new PrescriptionFileError(message, code, response.status);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? `MobiCare-prescription-${id.slice(0, 8)}`;
  return { blob: await response.blob(), filename };
}

/** Hand a file to the browser's own download, as if from a link. */
export function saveToComputer(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before letting go.
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}
