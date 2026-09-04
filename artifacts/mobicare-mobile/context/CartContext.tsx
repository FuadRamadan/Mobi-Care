import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Cart key is scoped per user so switching accounts never leaks a previous patient's cart. */
function cartKey(userId: string | null | undefined) {
  return userId ? `mc_mobile_cart_${userId}` : 'mc_mobile_cart_anon';
}

export interface CartItem {
  drugId: string;
  drugName: string;
  inventoryId: string;
  quantity: number;
  maxQuantity: number;
  priceLeones: number;
  requiresPrescription: boolean;
  collectionOnly: boolean;
}

export interface PharmacyPaymentDetails {
  number?: string | null;
  provider?: string | null;
  accountName?: string | null;
}

interface CartState {
  pharmacyId: string | null;
  pharmacyName: string | null;
  pharmacyPayment?: PharmacyPaymentDetails;
  items: CartItem[];
}

const EMPTY_CART: CartState = { pharmacyId: null, pharmacyName: null, items: [] };

interface CartContextValue {
  cart: CartState;
  itemCount: number;
  totalLeones: number;
  requiresPrescription: boolean;
  requiresCollection: boolean;
  serviceFeeLeones: number;
  amountPayableLeones: number;
  /** Returns false if adding would mix pharmacies; caller should prompt user */
  addItem: (pharmacyId: string, pharmacyName: string, payment: PharmacyPaymentDetails, item: Omit<CartItem, 'quantity'>) => boolean;
  replaceCart: (pharmacyId: string, pharmacyName: string, payment: PharmacyPaymentDetails, item: Omit<CartItem, 'quantity'>) => void;
  removeItem: (inventoryId: string) => void;
  updateQty: (inventoryId: string, delta: number) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

/**
 * CartProvider scopes the cart to the current user ID.
 * Changing userId (login/logout) immediately loads the correct cart and prevents
 * one patient's cart from appearing for a subsequent account on the same device.
 */
export function CartProvider({ userId, children }: { userId?: string | null; children: React.ReactNode }) {
  const [cart, setCart] = useState<CartState>(EMPTY_CART);
  const userIdRef = useRef(userId);

  // When userId changes, load that user's persisted cart
  useEffect(() => {
    userIdRef.current = userId;
    setCart(EMPTY_CART); // clear immediately to avoid flash of previous cart
    AsyncStorage.getItem(cartKey(userId)).then((raw) => {
      if (raw) {
        try { setCart(JSON.parse(raw)); } catch { /* ignore corrupt data */ }
      }
    });
  }, [userId]);

  const persist = useCallback((next: CartState) => {
    setCart(next);
    AsyncStorage.setItem(cartKey(userIdRef.current), JSON.stringify(next)).catch(() => {});
  }, []);

  const addItem = useCallback((pharmacyId: string, pharmacyName: string, payment: PharmacyPaymentDetails, item: Omit<CartItem, 'quantity'>): boolean => {
    let result = true;
    setCart((prev) => {
      if (prev.pharmacyId && prev.pharmacyId !== pharmacyId) {
        result = false;
        return prev; // caller must confirm replacement
      }
      const idx = prev.items.findIndex((i) => i.inventoryId === item.inventoryId);
      let items: CartItem[];
      if (idx >= 0) {
        items = prev.items.map((i, n) =>
          n === idx
            ? { ...i, quantity: Math.min(i.quantity + 1, i.maxQuantity || 999) }
            : i
        );
      } else {
        items = [...prev.items, { ...item, quantity: 1 }];
      }
      const next = { pharmacyId, pharmacyName, pharmacyPayment: payment, items };
      AsyncStorage.setItem(cartKey(userIdRef.current), JSON.stringify(next)).catch(() => {});
      return next;
    });
    return result;
  }, []);

  const replaceCart = useCallback((pharmacyId: string, pharmacyName: string, payment: PharmacyPaymentDetails, item: Omit<CartItem, 'quantity'>) => {
    const next: CartState = { pharmacyId, pharmacyName, pharmacyPayment: payment, items: [{ ...item, quantity: 1 }] };
    persist(next);
  }, [persist]);

  const removeItem = useCallback((inventoryId: string) => {
    setCart((prev) => {
      const items = prev.items.filter((i) => i.inventoryId !== inventoryId);
      const next: CartState = items.length === 0 ? EMPTY_CART : { ...prev, items };
      AsyncStorage.setItem(cartKey(userIdRef.current), JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const updateQty = useCallback((inventoryId: string, delta: number) => {
    setCart((prev) => {
      const items: CartItem[] = [];
      for (const item of prev.items) {
        if (item.inventoryId !== inventoryId) { items.push(item); continue; }
        const next = item.quantity + delta;
        if (next >= 1) items.push({ ...item, quantity: Math.min(next, item.maxQuantity || 999) });
        // next < 1 → item removed from cart
      }
      const next: CartState = items.length === 0 ? EMPTY_CART : { ...prev, items };
      AsyncStorage.setItem(cartKey(userIdRef.current), JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    persist(EMPTY_CART);
  }, [persist]);

  const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);
  const totalLeones = cart.items.reduce((s, i) => s + i.priceLeones * i.quantity, 0);
  const serviceFeeLeones = Math.round(totalLeones * 5) / 100;
  const amountPayableLeones = totalLeones + serviceFeeLeones;
  const requiresPrescription = cart.items.some((i) => i.requiresPrescription);
  const requiresCollection = cart.items.some((i) => i.collectionOnly);

  return (
    <CartContext.Provider value={{
      cart, itemCount, totalLeones, serviceFeeLeones, amountPayableLeones, requiresPrescription, requiresCollection,
      addItem, replaceCart, removeItem, updateQty, clearCart,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
