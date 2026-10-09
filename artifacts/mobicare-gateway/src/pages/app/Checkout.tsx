import { useState, useRef } from "react";
import { useLocation } from "wouter";
import {
  Minus,
  Plus,
  Trash2,
  Truck,
  Store,
  FileText,
  Smartphone,
  MapPin,
} from "lucide-react";
import {
  usePatientCreateOrder,
  usePatientUploadPrescription,
  usePatientStartCheckout,
  usePatientDeliveryCoverage,
  usePatientDeliveryQuote,
  type DeliveryQuote,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useCart } from "@/patient/cart";
import { formatLeones, EmptyState } from "@/pages/hq/shared";
import { LocationPicker } from "@/components/map/LocationPicker";
import type { LatLng, ZoneOutline } from "@/components/map/mapConfig";

/** The API's error body, when a request was refused. */
function errorBody(err: unknown): { status?: number; code?: string; error?: string; deliveryFeeMinor?: number } {
  const e = err as { status?: number; data?: { code?: string; error?: string; deliveryFeeMinor?: number } | null };
  return { status: e?.status, ...(e?.data ?? {}) };
}

export default function Checkout() {
  const {
    cart,
    setQuantity,
    removeItem,
    clear,
    subtotalLeones,
    serviceFeeLeones,
    serviceFeeBasisPoints,
    paymentsAvailable,
    totalLeones,
    prescriptionRequired,
    collectionOnly,
  } = useCart();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [fulfillment, setFulfillment] = useState<"delivery" | "collection">(
    collectionOnly ? "collection" : "delivery",
  );
  const [address, setAddress] = useState("");
  const [pin, setPin] = useState<LatLng | null>(null);
  const [quote, setQuote] = useState<DeliveryQuote | null>(null);
  const [rxDataUrl, setRxDataUrl] = useState<string | null>(null);
  const [rxFileName, setRxFileName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const uploadMutation = usePatientUploadPrescription();
  const createMutation = usePatientCreateOrder();
  const checkoutMutation = usePatientStartCheckout();
  const quoteMutation = usePatientDeliveryQuote();
  const { data: coverage } = usePatientDeliveryCoverage();
  const busy =
    uploadMutation.isPending ||
    createMutation.isPending ||
    checkoutMutation.isPending;

  if (!cart || cart.items.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="font-display font-bold text-2xl text-dark-green">
          Your cart
        </h1>
        <EmptyState>
          Your cart is empty.{" "}
          <button
            className="text-primary font-medium"
            onClick={() => navigate("/app/search")}
          >
            Search medicines
          </button>{" "}
          to get started.
        </EmptyState>
      </div>
    );
  }

  const effectiveFulfillment = collectionOnly ? "collection" : fulfillment;
  const deliveryBlocked =
    effectiveFulfillment === "delivery" &&
    cart.items.some((i) => !i.availableForDelivery);
  const collectionBlocked =
    effectiveFulfillment === "collection" &&
    cart.items.some((i) => !i.availableForCollection);

  // The fee is worked out on the server from the pin; the one shown here is
  // sent back with the order so a change in between is caught, not charged.
  const isDelivery = effectiveFulfillment === "delivery";
  const deliveryFeeLeones =
    isDelivery && quote?.available && quote.deliveryFeeMinor != null
      ? quote.deliveryFeeMinor / 100
      : 0;
  const payableLeones = totalLeones + deliveryFeeLeones;
  const deliveryNotReady =
    isDelivery && (!pin || quoteMutation.isPending || !quote?.available);

  async function onPin(next: LatLng) {
    setPin(next);
    setQuote(null);
    try {
      const result = await quoteMutation.mutateAsync({
        data: {
          pharmacyId: cart!.pharmacyId,
          latitude: next.latitude,
          longitude: next.longitude,
        },
      });
      setQuote(result);
    } catch {
      setQuote({
        available: false,
        deliveryFeeMinor: null,
        zoneName: null,
        fromZoneName: null,
        message: "The delivery fee could not be worked out. Check your connection and move the pin to try again.",
      });
    }
  }

  function onPickFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "Image too large",
        description: "Prescription photo must be under 5 MB.",
        variant: "destructive",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setRxDataUrl(reader.result as string);
      setRxFileName(file.name);
    };
    reader.readAsDataURL(file);
  }

  async function placeOrder() {
    try {
      if (isDelivery && !pin) {
        toast({
          title: "Delivery location needed",
          description: "Drop a pin on the map, or use your location, so we can work out the delivery fee.",
          variant: "destructive",
        });
        return;
      }
      if (isDelivery && address.trim().length < 5) {
        toast({
          title: "Landmark needed",
          description: "Tell the rider how to find you — a landmark or directions (at least 5 characters).",
          variant: "destructive",
        });
        return;
      }
      if (prescriptionRequired && !rxDataUrl) {
        toast({
          title: "Prescription needed",
          description: "Upload a photo of your prescription to continue.",
          variant: "destructive",
        });
        return;
      }

      let prescriptionImageKey: string | undefined;
      if (prescriptionRequired && rxDataUrl) {
        const up = await uploadMutation.mutateAsync({
          data: { image: rxDataUrl },
        });
        prescriptionImageKey = up.imageKey;
      }

      const order = await createMutation.mutateAsync({
        data: {
          pharmacyId: cart!.pharmacyId,
          fulfillmentType: effectiveFulfillment,
          ...(isDelivery && pin
            ? {
                deliveryAddress: address.trim(),
                deliveryLocation: pin,
                ...(quote?.deliveryFeeMinor != null
                  ? { quotedDeliveryFeeMinor: quote.deliveryFeeMinor }
                  : {}),
              }
            : {}),
          ...(prescriptionImageKey ? { prescriptionImageKey } : {}),
          items: cart!.items.map((i) => ({
            inventoryId: i.inventoryId,
            quantity: i.quantity,
          })),
        },
      });

      // Pay through Monime. The order is saved first; the payment link is
      // made on the server from the saved order.
      clear();
      await queryClient.invalidateQueries();
      if (prescriptionRequired) {
        toast({
          title: "Order placed",
          description: "A pharmacist will check your prescription first. We'll let you know when you can pay.",
        });
        navigate(`/app/orders/${order.id}`);
        return;
      }
      try {
        const link = await checkoutMutation.mutateAsync({ id: order.id });
        if (link.status === "pending" && link.redirectUrl) {
          window.location.assign(link.redirectUrl);
          return;
        }
      } catch (err) {
        toast({
          title: "Order saved: payment not started",
          description: errorBody(err).error ?? "Open the order and tap Pay to try again.",
          variant: "destructive",
        });
      }
      navigate(`/app/orders/${order.id}`);
    } catch (err: any) {
      const body = errorBody(err);
      if (body.code === "DELIVERY_FEE_CHANGED" && body.deliveryFeeMinor != null) {
        setQuote((current) => ({
          available: true,
          zoneName: current?.zoneName ?? null,
          fromZoneName: current?.fromZoneName ?? null,
          message: null,
          deliveryFeeMinor: body.deliveryFeeMinor!,
        }));
        toast({
          title: "Delivery fee updated",
          description: `The delivery fee is now ${formatLeones(body.deliveryFeeMinor / 100)}. Check the new total, then place your order again.`,
          variant: "destructive",
        });
        return;
      }
      if (body.code === "DELIVERY_UNAVAILABLE") {
        setQuote({ available: false, deliveryFeeMinor: null, zoneName: null, fromZoneName: null, message: body.error ?? null });
      }
      toast({
        title: "Could not place order",
        description:
          body.error ??
          err?.message ??
          "Something went wrong — please review your cart and try again.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display font-bold text-2xl text-dark-green mb-1">
          Your cart
        </h1>
        <p className="text-sm text-muted-foreground">
          Ordering from{" "}
          <span className="font-bold text-foreground">
            {cart.pharmacyName}
          </span>
          {cart.pharmacyAddress ? ` · ${cart.pharmacyAddress}` : ""}
        </p>
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
          {cart.items.map((item) => (
            <div
              key={item.inventoryId}
              className="flex items-center gap-3 p-4"
              data-testid={`cart-item-${item.inventoryId}`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">{item.drugName}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {item.strength} {item.form}
                </div>
                {item.brand && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {[item.brand, item.manufacturer, item.countryOfOrigin].filter(Boolean).join(" · ")}
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-0.5">
                  {formatLeones(item.priceLeones)} per {item.unitOfSale}
                  {item.prescriptionRequired && " · prescription"}
                  {item.collectionOnly && " · collection + ID only"}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7 rounded-full"
                  onClick={() =>
                    item.quantity <= 1
                      ? removeItem(item.inventoryId)
                      : setQuantity(item.inventoryId, item.quantity - 1)
                  }
                  data-testid={`button-minus-${item.inventoryId}`}
                >
                  <Minus className="w-3 h-3" />
                </Button>
                <span
                  className="w-6 text-center text-sm font-medium"
                  data-testid={`text-qty-${item.inventoryId}`}
                >
                  {item.quantity}
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7 rounded-full"
                  onClick={() =>
                    setQuantity(item.inventoryId, item.quantity + 1)
                  }
                  disabled={
                    item.maxUnitsPerOrder != null &&
                    item.quantity >= item.maxUnitsPerOrder
                  }
                  data-testid={`button-plus-${item.inventoryId}`}
                >
                  <Plus className="w-3 h-3" />
                </Button>
                <button
                  className="text-muted-foreground hover:text-destructive ml-1"
                  onClick={() => removeItem(item.inventoryId)}
                  aria-label="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Fulfillment */}
      <div className="space-y-2">
        <Label>How do you want to get it?</Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={collectionOnly}
            onClick={() => setFulfillment("delivery")}
            className={`border rounded-2xl p-3 text-left text-sm flex items-start gap-2 transition-colors ${
              effectiveFulfillment === "delivery"
                ? "border-primary bg-primary/5"
                : "bg-card"
            } ${collectionOnly ? "opacity-40 cursor-not-allowed" : ""}`}
            data-testid="option-delivery"
          >
            <Truck className="w-4 h-4 mt-0.5 text-primary" />
            <span>
              <span className="font-medium block">Delivery</span>
              <span className="text-xs text-muted-foreground">
                A rider brings it to you
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setFulfillment("collection")}
            className={`border rounded-2xl p-3 text-left text-sm flex items-start gap-2 transition-colors ${
              effectiveFulfillment === "collection"
                ? "border-primary bg-primary/5"
                : "bg-card"
            }`}
            data-testid="option-collection"
          >
            <Store className="w-4 h-4 mt-0.5 text-primary" />
            <span>
              <span className="font-medium block">Collection</span>
              <span className="text-xs text-muted-foreground">
                Pick up at the pharmacy
              </span>
            </span>
          </button>
        </div>
        {collectionOnly && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
            Your cart contains a controlled medicine — collection with an
            in-person ID check is required.
          </p>
        )}
        {(deliveryBlocked || collectionBlocked) && (
          <p className="text-xs text-destructive">
            Some items are not available for {effectiveFulfillment} from this
            pharmacy.
          </p>
        )}
      </div>

      {isDelivery && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Where should we deliver?</Label>
            <LocationPicker
              value={pin}
              onChange={onPin}
              areas={(coverage ?? []).map((zone) => ({
                name: zone.name,
                boundary: zone.boundary as unknown as ZoneOutline,
              }))}
              testId="map-delivery-location"
            />
            {pin && (
              <div
                className={`text-sm rounded-xl border p-3 flex items-start gap-2 ${
                  quote && !quote.available
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "bg-card"
                }`}
                data-testid="text-delivery-quote"
              >
                <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                {quoteMutation.isPending || !quote ? (
                  <span className="text-muted-foreground">Working out the delivery fee…</span>
                ) : quote.available ? (
                  <span>
                    Delivery to <span className="font-medium">{quote.zoneName}</span>
                    {quote.fromZoneName && <> from {quote.fromZoneName}</>}:{" "}
                    <span className="font-medium">{formatLeones(deliveryFeeLeones)}</span>
                    {quote.fromZoneName && (
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        The pharmacy is in another zone, so the higher of the two zones' fees applies.
                      </span>
                    )}
                  </span>
                ) : (
                  <span>
                    {quote.message}{" "}
                    <button
                      type="button"
                      className="font-medium underline"
                      onClick={() => setFulfillment("collection")}
                    >
                      Collect instead
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">Landmark or directions</Label>
            <Input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. Blue gate opposite Lumley police station"
              data-testid="input-address"
            />
          </div>
        </div>
      )}

      {prescriptionRequired && (
        <div className="space-y-2">
          <Label>Prescription photo</Label>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => onPickFile(e.target.files?.[0])}
            data-testid="input-prescription"
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className={`w-full border-2 border-dashed rounded-2xl p-4 text-sm flex items-center gap-3 ${
              rxDataUrl
                ? "border-primary bg-primary/5"
                : "bg-card text-muted-foreground"
            }`}
            data-testid="button-upload-prescription"
          >
            <FileText className="w-5 h-5 text-primary shrink-0" />
            {rxDataUrl ? (
              <span className="text-foreground font-medium truncate">
                {rxFileName} — tap to change
              </span>
            ) : (
              <span>
                Your order includes prescription medicines. Tap to upload a
                photo of your prescription.
              </span>
            )}
          </button>
        </div>
      )}

      {/* Payment + total */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Payment method</span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Smartphone className="w-4 h-4 text-orange-money" />{" "}
              Mobile money, card or bank
            </span>
          </div>
          <div className="space-y-1.5 pt-2 border-t">
            {cart.items.map((item) => (
              <div key={item.inventoryId} className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {item.quantity} × {item.drugName}
                  {item.brand ? ` (${item.brand})` : ""}
                </span>
                <span>{formatLeones(item.priceLeones * item.quantity)}</span>
              </div>
            ))}
            {serviceFeeLeones > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Service fee ({serviceFeeBasisPoints / 100}%)</span>
                <span>{formatLeones(serviceFeeLeones)}</span>
              </div>
            )}
            {isDelivery && (
              <div className="flex justify-between text-sm" data-testid="text-delivery-fee">
                <span className="text-muted-foreground">
                  Delivery{quote?.available && quote.zoneName ? ` · ${quote.zoneName}` : ""}
                </span>
                <span>
                  {quote?.available ? formatLeones(deliveryFeeLeones) : "—"}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between pt-2 border-t">
            <span className="font-medium">Total payable</span>
            <span
              className="font-display font-bold text-xl text-dark-green"
              data-testid="text-total"
            >
              {formatLeones(payableLeones)}
            </span>
          </div>
          <div className="pt-2" data-testid="text-pay-online">
            <p className="text-sm font-medium mb-1">Pay securely online</p>
            <p className="text-xs text-muted-foreground">
              {prescriptionRequired
                ? "A pharmacist checks your prescription first. Then you pay online with Orange Money, AfriMoney, a card or a bank account."
                : "Next you'll pay on Monime's secure page with Orange Money, AfriMoney, a card or a bank account. Someone else can pay the link for you too."}
            </p>
            {!paymentsAvailable && (
              <p className="text-xs text-destructive mt-2">
                Online payment is unavailable right now. Please try again in a few minutes.
              </p>
            )}
          </div>
          <Button
            className="w-full rounded-full h-12 text-base mt-2"
            onClick={placeOrder}
            disabled={busy || deliveryBlocked || collectionBlocked || deliveryNotReady || !paymentsAvailable}
            data-testid="button-place-order"
          >
            {busy
              ? "Opening payment…"
              : !prescriptionRequired ? `Place order and pay ${formatLeones(payableLeones)}` : "Place order"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
