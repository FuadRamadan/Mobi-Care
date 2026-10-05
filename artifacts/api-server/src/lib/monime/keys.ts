import crypto from "node:crypto";

/**
 * A fixed idempotency key for one money movement, worked out from our own
 * records (e.g. "checkout:<orderId>:1"). The same movement always gets the
 * same key, so a retry after a crash or timeout can never become a second
 * payment. Monime wants 25 to 64 characters; this is a 36-character UUID-shaped
 * digest, and holds no personal data.
 */
export function idempotencyKey(name: string): string {
  const hex = crypto.createHash("sha256").update(`mobicare:${name}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
}

export const checkoutKey = (orderId: string, attempt: number) =>
  idempotencyKey(`checkout:${orderId}:${attempt}`);
