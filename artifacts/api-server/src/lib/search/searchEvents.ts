/**
 * Counting patient searches for HQ's figures.
 *
 * The patient app searches as the patient types, a moment after each pause,
 * and searches again when the phone's location arrives. Counting every one of
 * those made a single search for "paracetamol" count as three or four
 * ("parac", "paracet", "paracetamol"...). A search that continues or trims the
 * patient's previous one within a short time is the same search: it replaces
 * that one instead of being counted again.
 */

/** How long after a search a related one still counts as the same search. */
export const SAME_SEARCH_WINDOW_MS = 2 * 60_000;

/** Lower case, trimmed, single spaces: how searches are stored and compared. */
export function normaliseSearch(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Whether `next` is the same search as `previous`, made `elapsedMs` later:
 * one is the other typed further, trimmed back, or repeated.
 */
export function isSameSearch(previous: string, next: string, elapsedMs: number): boolean {
  if (elapsedMs < 0 || elapsedMs > SAME_SEARCH_WINDOW_MS) return false;
  const a = normaliseSearch(previous);
  const b = normaliseSearch(next);
  if (!a || !b) return false;
  return a.startsWith(b) || b.startsWith(a);
}
