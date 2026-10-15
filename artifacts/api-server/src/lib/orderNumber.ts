/**
 * The order number people quote: the first 8 characters of the order's id,
 * in capitals (e.g. 100D4484). The same number is shown in the patient app,
 * the pharmacy portal, HQ, on Monime's payment page and in text messages, so
 * anyone can find the order from it. Keep the apps' copies in step.
 */
export function orderNumber(orderId: string): string {
  return orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
}
