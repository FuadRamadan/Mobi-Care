import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

const CART_KEY = "mc_pt_cart";

/** One line in the cart. An order is always for a single pharmacy. */
export interface CartItem {
  inventoryId: string;
  drugId: string;
  drugName: string;
  strength: string;
  form: string;
  unitOfSale: string;
  tier: "1" | "2" | "3";
  maxUnitsPerOrder: number | null;
  prescriptionRequired: boolean;
  collectionOnly: boolean;
  priceLeones: number;
  quantity: number;
  availableForDelivery: boolean;
  availableForCollection: boolean;
}

export interface CartState {
  pharmacyId: string;
  pharmacyName: string;
  pharmacyAddress: string | null;
  mobileMoneyNumber?: string | null;
  mobileMoneyProvider?: string | null;
  mobileMoneyAccountName?: string | null;
  items: CartItem[];
}

interface CartValue {
  cart: CartState | null;
  /** Add (or bump) an item. Returns false when the cart belongs to another pharmacy. */
  addItem: (
    pharmacy: { id: string; name: string; address: string | null; mobileMoneyNumber?: string | null; mobileMoneyProvider?: string | null; mobileMoneyAccountName?: string | null },
    item: Omit<CartItem, "quantity">,
    opts?: { replacePharmacy?: boolean },
  ) => boolean;
  setQuantity: (inventoryId: string, quantity: number) => void;
  removeItem: (inventoryId: string) => void;
  clear: () => void;
  subtotalLeones: number;
  serviceFeeLeones: number;
  totalLeones: number;
  itemCount: number;
  prescriptionRequired: boolean;
  collectionOnly: boolean;
}

const CartContext = createContext<CartValue | null>(null);

function readStoredCart(): CartState | null {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as CartState) : null;
  } catch {
    return null;
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState | null>(readStoredCart);

  useEffect(() => {
    if (cart && cart.items.length > 0)
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    else localStorage.removeItem(CART_KEY);
  }, [cart]);

  const addItem = useCallback<CartValue["addItem"]>((pharmacy, item, opts) => {
    let ok = true;
    setCart((prev) => {
      if (
        prev &&
        prev.pharmacyId !== pharmacy.id &&
        prev.items.length > 0 &&
        !opts?.replacePharmacy
      ) {
        ok = false;
        return prev;
      }
      const base: CartState =
        prev && prev.pharmacyId === pharmacy.id && !opts?.replacePharmacy
          ? prev
          : {
              pharmacyId: pharmacy.id,
              pharmacyName: pharmacy.name,
              pharmacyAddress: pharmacy.address,
              mobileMoneyNumber: pharmacy.mobileMoneyNumber,
              mobileMoneyProvider: pharmacy.mobileMoneyProvider,
              mobileMoneyAccountName: pharmacy.mobileMoneyAccountName,
              items: [],
            };
      const existing = base.items.find(
        (i) => i.inventoryId === item.inventoryId,
      );
      const items = existing
        ? base.items.map((i) =>
            i.inventoryId === item.inventoryId
              ? {
                  ...i,
                  quantity: Math.min(i.quantity + 1, i.maxUnitsPerOrder ?? 999),
                }
              : i,
          )
        : [...base.items, { ...item, quantity: 1 }];
      return { ...base, items };
    });
    return ok;
  }, []);

  const setQuantity = useCallback((inventoryId: string, quantity: number) => {
    setCart((prev) => {
      if (!prev) return prev;
      const items = prev.items
        .map((i) =>
          i.inventoryId === inventoryId
            ? {
                ...i,
                quantity: Math.max(
                  1,
                  Math.min(quantity, i.maxUnitsPerOrder ?? 999),
                ),
              }
            : i,
        )
        .filter((i) => i.quantity > 0);
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
  const subtotalMinor = items.reduce(
    (sum, item) => sum + Math.round(item.priceLeones * 100) * item.quantity,
    0,
  );
  const serviceFeeMinor = Math.round((subtotalMinor * 5) / 100);
  const subtotalLeones = subtotalMinor / 100;
  const serviceFeeLeones = serviceFeeMinor / 100;
  const totalLeones = (subtotalMinor + serviceFeeMinor) / 100;
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);
  const prescriptionRequired = items.some((i) => i.prescriptionRequired);
  const collectionOnly = items.some((i) => i.collectionOnly);

  return (
    <CartContext.Provider
      value={{
        cart,
        addItem,
        setQuantity,
        removeItem,
        clear,
        subtotalLeones,
        serviceFeeLeones,
        totalLeones,
        itemCount,
        prescriptionRequired,
        collectionOnly,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
