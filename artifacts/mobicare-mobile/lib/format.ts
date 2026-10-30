/** "Le 1,250" — leones as the patient sees them everywhere in the app. */
export function formatLeones(n: number) {
  return `Le ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** The API's error body, when a request was refused (see ApiError in the API client). */
export function errorBody(err: unknown): { status?: number; code?: string; error?: string; deliveryFeeMinor?: number } {
  const e = err as { status?: number; data?: { code?: string; error?: string; deliveryFeeMinor?: number } | null };
  return { status: e?.status, ...(e?.data ?? {}) };
}

/** The server's own words for a refusal, or a fallback. */
export function errorText(err: unknown, fallback = "Something went wrong. Please try again.") {
  return errorBody(err).error ?? fallback;
}
