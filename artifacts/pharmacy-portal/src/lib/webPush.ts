/**
 * Notifications that drop down on the computer or phone even when the portal is closed
 * (Web Push). The server sends them (api-server lib/webPush.ts); public/sw.js
 * shows them.
 *
 * The patient app has its own copy (mobicare-gateway/src/lib/webPush.ts) with its own
 * worker and server routes: keep the two in step.
 */
import { useCallback, useEffect, useState } from "react";
import {
  getWebPushPublicKey,
  savePharmacyPushSubscription,
  removePharmacyPushSubscription,
} from "@workspace/api-client-react";

const WORKER_URL = "/pharmacy-portal/sw.js";
const SCOPE = "/pharmacy-portal/";
const save = (sub: PushSubscriptionJSON) => savePharmacyPushSubscription(sub as never);
const remove = (endpoint: string) => removePharmacyPushSubscription({ endpoint });

/** "on" for this device once the person turned notifications on here. */
const PREF_KEY = "mc_portal_push";

/**
 * on / off: can be switched. denied: blocked in the browser's settings.
 * needs-install: an iPhone or iPad, where only an app added to the Home
 * Screen can receive them. unsupported: this browser cannot. unavailable: the
 * server has notifications switched off.
 */
export type PushState = "loading" | "on" | "off" | "denied" | "needs-install" | "unsupported" | "unavailable";

let keyPromise: Promise<string | null> | null = null;
function publicKey(): Promise<string | null> {
  keyPromise ??= getWebPushPublicKey().then((r) => r.publicKey ?? null).catch(() => {
    keyPromise = null;
    return null;
  });
  return keyPromise;
}

function isAppleMobile(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function installed(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function preferOn(on: boolean) {
  try { localStorage.setItem(PREF_KEY, on ? "on" : "off"); } catch { /* private mode */ }
}
function prefersOn(): boolean {
  try { return localStorage.getItem(PREF_KEY) === "on"; } catch { return false; }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(SCOPE);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function subscribe(): Promise<void> {
  const key = await publicKey();
  if (!key) throw new Error("Notifications are not available right now.");
  const registration = await navigator.serviceWorker.register(WORKER_URL, { scope: SCOPE });
  await navigator.serviceWorker.ready;
  // The browser asks its push service (Google's, Apple's…) for an address. On
  // a bad connection that can hang: give up rather than spin forever.
  const subscription = (await registration.pushManager.getSubscription())
    ?? await Promise.race([
      registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("push service timed out")), 20_000)),
    ]);
  await save(subscription.toJSON());
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return isAppleMobile() && !installed() ? "needs-install" : "unsupported";
  if (!(await publicKey())) return "unavailable";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return (await currentSubscription()) && prefersOn() ? "on" : "off";
}

/** Ask permission and turn notifications on. Call it straight from a tap. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return pushState();
  // First, while the tap still counts: browsers only ask from a tap.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  await subscribe();
  preferOn(true);
  return "on";
}

export async function disablePush(): Promise<PushState> {
  preferOn(false);
  if (supported()) {
    const subscription = await currentSubscription();
    if (subscription) {
      await remove(subscription.endpoint).catch(() => {});
      await subscription.unsubscribe().catch(() => {});
    }
  }
  return pushState();
}

/**
 * After signing in: if notifications were on for this device, link them to
 * whoever is signed in now. Never asks for permission.
 */
export async function syncPushAfterSignIn(): Promise<void> {
  try {
    if (!supported() || !prefersOn() || Notification.permission !== "granted") return;
    await subscribe();
  } catch { /* the switch in Profile shows the state */ }
}

/**
 * Before signing out: stop this device receiving the signed-out person's
 * notifications. The device keeps its preference, so the next person to sign
 * in here gets theirs.
 */
export async function unlinkPushBeforeSignOut(): Promise<void> {
  try {
    if (!supported()) return;
    const subscription = await currentSubscription();
    if (!subscription) return;
    await Promise.race([remove(subscription.endpoint), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
    await subscription.unsubscribe().catch(() => {});
  } catch { /* signing out must always work */ }
}

/** The state for a switch or a prompt, and the actions behind it. */
export function useWebPush() {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void pushState().then((s) => { if (live) setState(s); });
    return () => { live = false; };
  }, []);
  const run = useCallback(async (action: () => Promise<PushState>) => {
    setBusy(true);
    setError(null);
    try {
      setState(await action());
    } catch {
      setState(await pushState());
      setError("Notifications could not be turned on. Check your internet connection and try again.");
    } finally {
      setBusy(false);
    }
  }, []);
  return {
    state,
    busy,
    error,
    enable: () => run(enablePush),
    disable: () => run(disablePush),
  };
}
