/**
 * The chime played when a new notification arrives, and the setting that
 * mutes it. On by default; the choice is kept per device.
 *
 * The same file is in the pharmacy portal (src/lib/notificationSound.ts):
 * change both together.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

const KEY = "mc_sound";
const listeners = new Set<() => void>();
let context: AudioContext | null = null;
let lastPlayed = 0;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try { context = new Ctor(); } catch { return null; }
  }
  return context;
}

// Browsers keep sound blocked until the person taps or types on the page.
// The first tap unlocks it, so later notifications can play on their own.
if (typeof window !== "undefined") {
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const unlock = () => {
    const ctx = audio();
    if (!ctx) return;
    void ctx.resume().then(() => {
      if (ctx.state === "running") events.forEach((e) => window.removeEventListener(e, unlock, true));
    });
  };
  events.forEach((e) => window.addEventListener(e, unlock, { capture: true, passive: true }));
  window.addEventListener("storage", (e) => { if (e.key === KEY) listeners.forEach((l) => l()); });
}

export function soundEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}

export function setSoundEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode: stays on */ }
  listeners.forEach((l) => l());
  if (on) playNotificationSound();
}

/** A short two-note chime, made in the browser: there is no sound file to load. */
export function playNotificationSound(): void {
  if (!soundEnabled()) return;
  // Several notifications at once sound like one.
  const now = Date.now();
  if (now - lastPlayed < 1500) return;
  const ctx = audio();
  if (!ctx || ctx.state !== "running") return;
  lastPlayed = now;
  try {
    [880, 1320].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = frequency;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch { /* a missing chime must never break the page */ }
}

/** The sound setting, kept in step across every toggle and open tab. */
export function useSoundEnabled(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    soundEnabled,
    () => true,
  );
  return [on, setSoundEnabled];
}

/**
 * Chime when a count of unread notifications goes up. The first value is what
 * was already there when the page opened, so it stays quiet.
 */
export function useChimeOnIncrease(count: number | undefined): void {
  const previous = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (count === undefined) return;
    if (previous.current !== undefined && count > previous.current) playNotificationSound();
    previous.current = count;
  }, [count]);
}
