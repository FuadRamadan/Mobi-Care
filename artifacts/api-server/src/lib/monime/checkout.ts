import type { CreateCheckoutSessionBody, MonimeLineItem } from "./client.js";
import type { MonimeConfig } from "./config.js";

/**
 * Builds the payment link request for an order, from what is saved in our
 * database, never from anything the patient's browser sends.
 *
 * Monime allows 16 lines per link. Two are kept for the service fee and
 * delivery, so up to 14 medicines are listed one by one; an order with more
 * becomes one combined "Medicines from <pharmacy> (N items)" line (decided
 * 3 Oct 2026). The full list stays in the MobiCare app and receipt.
 */

export const MONIME_MAX_LINE_ITEMS = 16;
export const MAX_ITEMISED_MEDICINES = MONIME_MAX_LINE_ITEMS - 2;
export const MOBICARE_GREEN = "#1a8f6a";

export interface CheckoutOrder {
  id: string;
  pharmacyId: string;
  pharmacyName: string;
  totalMinor: number;
  patientServiceFeeMinor: number;
  serviceFeeBasisPoints: number;
  deliveryFeeMinor: number;
  deliveryZoneName: string | null;
  items: {
    id: string;
    drugName: string;
    brand: string | null;
    unitPriceMinor: number;
    quantity: number;
  }[];
}

export class CheckoutTotalMismatch extends Error {
  constructor(readonly linesMinor: number, readonly orderMinor: number) {
    super(
      `Payment link lines add up to ${linesMinor} but the order total is ${orderMinor}`,
    );
    this.name = "CheckoutTotalMismatch";
  }
}

const cut = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const sle = (value: number) => ({ currency: "SLE", value });

/** A short, readable order number for the payment page: first 8 characters. */
export const shortOrderNumber = (orderId: string) =>
  orderId.replace(/-/g, "").slice(0, 8).toUpperCase();

export function buildLineItems(order: CheckoutOrder): MonimeLineItem[] {
  const lines: MonimeLineItem[] = [];
  if (order.items.length <= MAX_ITEMISED_MEDICINES) {
    for (const item of order.items) {
      lines.push({
        type: "custom",
        name: cut(item.brand ? `${item.drugName} (${item.brand})` : item.drugName, 100),
        price: sle(item.unitPriceMinor),
        quantity: item.quantity,
        reference: item.id,
      });
    }
  } else {
    const medicinesMinor = order.items.reduce(
      (sum, item) => sum + item.unitPriceMinor * item.quantity,
      0,
    );
    lines.push({
      type: "custom",
      name: cut(`Medicines from ${order.pharmacyName} (${order.items.length} items)`, 100),
      price: sle(medicinesMinor),
      quantity: 1,
      reference: "medicines",
    });
  }
  if (order.patientServiceFeeMinor > 0) {
    const percent = order.serviceFeeBasisPoints / 100;
    lines.push({
      type: "custom",
      name: `MobiCare service fee (${percent}%)`,
      price: sle(order.patientServiceFeeMinor),
      quantity: 1,
      reference: "service-fee",
    });
  }
  if (order.deliveryFeeMinor > 0) {
    lines.push({
      type: "custom",
      name: cut(order.deliveryZoneName ? `Delivery (${order.deliveryZoneName})` : "Delivery", 100),
      price: sle(order.deliveryFeeMinor),
      quantity: 1,
      reference: "delivery",
    });
  }
  return lines;
}

/**
 * The full create-session request. Refuses to build one whose lines don't add
 * up to the order total, so a patient is never charged a different amount
 * from the one the app showed.
 */
export function buildCheckoutSessionBody(
  order: CheckoutOrder,
  attempt: number,
  config: Pick<MonimeConfig, "mode" | "holdingAccountId" | "publicAppUrl">,
): CreateCheckoutSessionBody {
  const lineItems = buildLineItems(order);
  if (lineItems.length > MONIME_MAX_LINE_ITEMS) {
    throw new Error(`A payment link can have at most ${MONIME_MAX_LINE_ITEMS} lines`);
  }
  const linesMinor = lineItems.reduce(
    (sum, line) => sum + line.price.value * line.quantity,
    0,
  );
  if (linesMinor !== order.totalMinor) {
    throw new CheckoutTotalMismatch(linesMinor, order.totalMinor);
  }
  const orderPage = `${config.publicAppUrl}/app/orders/${order.id}`;
  return {
    name: `MobiCare order ${shortOrderNumber(order.id)}`,
    reference: order.id,
    successUrl: `${orderPage}?payment=return`,
    cancelUrl: `${orderPage}?payment=cancelled`,
    ...(config.holdingAccountId ? { financialAccountId: config.holdingAccountId } : {}),
    lineItems,
    brandingOptions: { primaryColor: MOBICARE_GREEN },
    // Our IDs only: no names, phone numbers or medicines (see the design notes).
    metadata: {
      mc_order_id: order.id,
      mc_pharmacy_id: order.pharmacyId,
      mc_attempt: String(attempt),
      mc_env: config.mode,
    },
  };
}
