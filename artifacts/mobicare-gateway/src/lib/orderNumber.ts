/**
 * The order number people quote: the first 8 characters of the order's id,
 * in capitals (e.g. 100D4484). The pharmacy portal, HQ, Monime's payment page
 * and text messages show the same number (api-server lib/orderNumber.ts).
 */
export const orderNumber = (orderId: string) => orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
