/**
 * Expo push notification sender.
 *
 * Sends via Expo's public push HTTP API — no credentials needed for
 * Expo push tokens. Errors are logged, never thrown (fire-and-forget).
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Extra data delivered to the app (e.g. { url: "/order/<id>" } for deep links). */
  data?: Record<string, unknown>;
}

export interface PushSendOptions {
  /**
   * Called when Expo reports that the device no longer accepts pushes.
   * The caller owns persistence of the token because this transport helper
   * does not know which patient record it belongs to.
   */
  onDeviceNotRegistered?: () => Promise<void> | void;
}

/** Basic sanity check that a string looks like an Expo push token. */
export function isExpoPushToken(token: string): boolean {
  return /^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(token);
}

/**
 * Send a push notification through Expo. Swallows all errors.
 * Returns true if Expo accepted the message ticket.
 */
export async function sendExpoPush(
  message: PushMessage,
  options?: PushSendOptions
): Promise<boolean> {
  if (!isExpoPushToken(message.to)) {
    console.warn("[push] Skipping invalid Expo push token");
    return false;
  }
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify([
        {
          to: message.to,
          title: message.title,
          body: message.body,
          data: message.data ?? {},
          sound: "default",
          priority: "high",
        },
      ]),
    });
    if (!res.ok) {
      console.error(`[push] Expo push API returned ${res.status}`);
      return false;
    }
    const json = (await res.json()) as {
      data?: Array<{ status: string; message?: string; details?: { error?: string } }>;
    };
    const ticket = json.data?.[0];
    if (ticket && ticket.status !== "ok") {
      console.error(
        `[push] Push ticket error: ${ticket.details?.error ?? ""} ${ticket.message ?? ""}`
      );
      if (ticket.details?.error === "DeviceNotRegistered") {
        try {
          await options?.onDeviceNotRegistered?.();
        } catch (err) {
          console.error("[push] Failed to clear unregistered device token:", err);
        }
      }
      return false;
    }
    return true;
  } catch (err) {
    console.error("[push] Expo push send failed:", err);
    return false;
  }
}
