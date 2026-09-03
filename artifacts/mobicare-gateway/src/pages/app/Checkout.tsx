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
} from "lucide-react";
import {
  usePatientCreateOrder,
  usePatientUploadPrescription,
  usePatientPayOrder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useCart } from "@/patient/cart";
import { formatLeones, EmptyState } from "@/pages/hq/shared";

export default function Checkout() {
  const {
    cart,
    setQuantity,
    removeItem,
    clear,
    drugTotalLeones,
    serviceFeeLeones,
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
  const [rxDataUrl, setRxDataUrl] = useState<string | null>(null);
  const [rxFileName, setRxFileName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const uploadMutation = usePatientUploadPrescription();
  const createMutation = usePatientCreateOrder();
  const payMutation = usePatientPayOrder();
  const busy =
    uploadMutation.isPending ||
    createMutation.isPending ||
    payMutation.isPending;

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
      if (effectiveFulfillment === "delivery" && address.trim().length < 5) {
        toast({
          title: "Delivery address needed",
          description: "Tell us where to deliver (at least 5 characters).",
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
          expectedTotalMinor: Math.round(totalLeones * 100),
          ...(effectiveFulfillment === "delivery"
            ? { deliveryAddress: address.trim() }
            : {}),
          ...(prescriptionImageKey ? { prescriptionImageKey } : {}),
          items: cart!.items.map((i) => ({
            inventoryId: i.inventoryId,
            quantity: i.quantity,
          })),
        },
      });

      // Record the mobile-money payment (no live gateway yet).
      await payMutation.mutateAsync({ id: order.id });

      clear();
      await queryClient.invalidateQueries();
      toast({
        title: "Order placed",
        description:
          "Payment recorded — the pharmacy will confirm your order shortly.",
      });
      navigate(`/app/orders/${order.id}`);
    } catch (err: any) {
      toast({
        title: "Could not place order",
        description:
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
          <span className="font-medium text-foreground">
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

      {effectiveFulfillment === "delivery" && (
        <div className="space-y-1.5">
          <Label htmlFor="address">Delivery address</Label>
          <Input
            id="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Street, area, town"
            data-testid="input-address"
          />
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
              <Smartphone className="w-4 h-4 text-orange-money" /> Orange Money
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Drug price</span>
            <span className="font-medium">{formatLeones(drugTotalLeones)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Service fee (5%)</span>
            <span className="font-medium">{formatLeones(serviceFeeLeones)}</span>
          </div>
          <div className="flex items-center justify-between border-t pt-3">
            <span className="font-medium">Total payable</span>
            <span
              className="font-display font-bold text-xl text-dark-green"
              data-testid="text-total"
            >
              {formatLeones(totalLeones)}
            </span>
          </div>
          <Button
            className="w-full rounded-full h-12 text-base"
            onClick={placeOrder}
            disabled={busy || deliveryBlocked || collectionBlocked}
            data-testid="button-place-order"
          >
            {busy
              ? "Placing order…"
              : `Pay ${formatLeones(totalLeones)} & place order`}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            Mobile-money payment is recorded with your order — you'll confirm on
            your phone when live payments launch.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
