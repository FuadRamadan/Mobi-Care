import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePatientPaymentsConfig } from '@workspace/api-client-react';

/** Cart key is scoped per user so switching accounts never leaks a previous patient's cart. */
function cartKey(userId: string | null | undefined) {
  return userId ? `mc_mobile_cart_v2_${userId}` : 'mc_mobile_cart_v2_anon';
}

/** One line in the cart, as on the web app. An order is always for a single pharmacy. */
export interface CartItem {
  inventoryId: string;
  drugId: string;
  drugName: string;
  strength: string;
  form: string;
  unitOfSale: string;
  tier: '1' | '2' | '3';
  maxUnitsPerOrder: number | null;
  prescriptionRequired: boolean;
  collectionOnly: boolean;
  priceLeones: number;
  /** The version chosen, when a pharmacy stocks several. */
  brand?: string | null;
  manufacturer?: string | null;
  countryOfOrigin?: string | null;
  quantity: number;
  availableForDelivery: boolean;
  availableForCollection: boolean;
}

export interface CartState {
  pharmacyId: string;
  pharmacyName: string;
  pharmacyAddress: string | null;
  items: CartItem[];
  /**
   * Set when the cart came from a prescription request: the pharmacist has
   * already checked the prescription, and the items and their limits are theirs.
   */
  prescriptionRequestId?: string;
  /** The pharmacy is beyond delivery range of the patient: checkout starts on collection. */
  startsWithCollection?: boolean;
}

export type CartPharmacy = { id: string; name: string; address: string | null };

interface CartContextValue {
  cart: CartState | null;
  /** Add (or bump) an item. Returns false when the cart belongs to another pharmacy. */
  addItem: (pharmacy: CartPharmacy, item: Omit<CartItem, 'quantity'>, opts?: { replacePharmacy?: boolean }) => boolean;
  /** Replace the cart with the medicines a pharmacist confirmed for a prescription request. */
  startFromRequest: (requestId: string, pharmacy: CartPharmacy, items: CartItem[], opts?: { collection?: boolean }) => void;
  setQuantity: (inventoryId: string, quantity: number) => void;
  removeItem: (inventoryId: string) => void;
  clear: () => void;
  subtotalLeones: number;
  serviceFeeLeones: number;
  /** The patient service fee rate from the server: 0 during the pilot. */
  serviceFeeBasisPoints: number;
  /** False while Monime can't be reached: orders can't be paid online. */
  paymentsAvailable: boolean;
  totalLeones: number;
  itemCount: number;
  prescriptionRequired: boolean;
  collectionOnly: boolean;
}

const CartContext = createContext<CartContextValue | null>(null);

function isCart(value: unknown): value is CartState {
  const cart = value as CartState | null;
  return Boolean(cart && typeof cart.pharmacyId === 'string' && Array.isArray(cart.items) && cart.items.every((i) => typeof i.unitOfSale === 'string'));
}

/**
 * CartProvider scopes the cart to the current user ID.
 * Changing userId (login/logout) immediately loads the correct cart and prevents
 * one patient's cart from appearing for a subsequent account on the same device.
 */
export function CartProvider({ userId, children }: { userId?: string | null; children: React.ReactNode }) {
  const [cart, setCart] = useState<CartState | null>(null);
  const userIdRef = useRef(userId);
  const loadedFor = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    userIdRef.current = userId;
    loadedFor.current = undefined;
    setCart(null); // clear immediately to avoid a flash of the previous cart
    AsyncStorage.getItem(cartKey(userId)).then((raw) => {
      if (userIdRef.current !== userId) return;
      try {
        const parsed = raw ? JSON.parse(raw) : null;
        setCart(isCart(parsed) && parsed.items.length > 0 ? parsed : null);
      } catch {
        setCart(null);
      }
      loadedFor.current = userId;
    });
  }, [userId]);

  // Saved whenever it changes, once this user's saved cart has been read.
  useEffect(() => {
    if (loadedFor.current !== userIdRef.current) return;
    const key = cartKey(userIdRef.current);
    if (cart && cart.items.length > 0) AsyncStorage.setItem(key, JSON.stringify(cart)).catch(() => {});
    else AsyncStorage.removeItem(key).catch(() => {});
  }, [cart]);

  const addItem = useCallback<CartContextValue['addItem']>((pharmacy, item, opts) => {
    let ok = true;
    setCart((prev) => {
      // A prescription request's cart holds only what the pharmacist confirmed.
      if (
        prev &&
        (prev.pharmacyId !== pharmacy.id || prev.prescriptionRequestId) &&
        prev.items.length > 0 &&
        !opts?.replacePharmacy
      ) {
        ok = false;
        return prev;
      }
      const base: CartState =
        prev && prev.pharmacyId === pharmacy.id && !prev.prescriptionRequestId && !opts?.replacePharmacy
          ? prev
          : { pharmacyId: pharmacy.id, pharmacyName: pharmacy.name, pharmacyAddress: pharmacy.address, items: [] };
      const existing = base.items.find((i) => i.inventoryId === item.inventoryId);
      const items = existing
        ? base.items.map((i) =>
            i.inventoryId === item.inventoryId
              ? { ...i, quantity: Math.min(i.quantity + 1, i.maxUnitsPerOrder ?? 999) }
              : i,
          )
        : [...base.items, { ...item, quantity: 1 }];
      return { ...base, items };
    });
    return ok;
  }, []);

  const startFromRequest = useCallback<CartContextValue['startFromRequest']>((requestId, pharmacy, items, opts) => {
    setCart({
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      pharmacyAddress: pharmacy.address,
      items,
      prescriptionRequestId: requestId,
      startsWithCollection: opts?.collection,
    });
  }, []);

  const setQuantity = useCallback((inventoryId: string, quantity: number) => {
    setCart((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((i) =>
        i.inventoryId === inventoryId
          ? { ...i, quantity: Math.max(1, Math.min(quantity, i.maxUnitsPerOrder ?? 999)) }
          : i,
      );
      return { ...prev, items };
    });
  }, []);

  const removeItem = useCallback((inventoryId: string) => {
    setCart((prev) => {
      if (!prev) return prev;
      const items = prev.items.filter((i) => i.inventoryId !== inventoryId);
      return items.length === 0 ? null : { ...prev, items };
    });
  }, []);

  const clear = useCallback(() => setCart(null), []);

  const items = cart?.items ?? [];
  const subtotalMinor = items.reduce((sum, item) => sum + Math.round(item.priceLeones * 100) * item.quantity, 0);
  // The server prices every order; the rate comes from it so the cart shows the
  // same figure in advance (0% during the pilot: patients pay no service fee).
  const { data: payments } = usePatientPaymentsConfig({
    query: { enabled: Boolean(userId), staleTime: 5 * 60_000, retry: false } as never,
  });
  const serviceFeeBasisPoints = payments?.serviceFeeBasisPoints ?? 0;
  const paymentsAvailable = payments?.available ?? true;
  const serviceFeeMinor = Math.round((subtotalMinor * serviceFeeBasisPoints) / 10_000);

  return (
    <CartContext.Provider
      value={{
        cart,
        addItem,
        startFromRequest,
        setQuantity,
        removeItem,
        clear,
        subtotalLeones: subtotalMinor / 100,
        serviceFeeLeones: serviceFeeMinor / 100,
        serviceFeeBasisPoints,
        paymentsAvailable,
        totalLeones: (subtotalMinor + serviceFeeMinor) / 100,
        itemCount: items.reduce((s, i) => s + i.quantity, 0),
        prescriptionRequired: items.some((i) => i.prescriptionRequired),
        collectionOnly: items.some((i) => i.collectionOnly),
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
