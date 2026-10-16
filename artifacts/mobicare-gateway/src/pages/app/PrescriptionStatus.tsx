import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { Bike, CheckCircle2, Clock, FileX, Loader2, MapPinOff, Store, ArrowLeft } from "lucide-react";
import {
  useGetPatientPrescriptionRequest,
  getGetPatientPrescriptionRequestQueryKey,
  useCancelPrescriptionRequest,
  useAskPrescriptionRequestFurther,
  type PatientPrescriptionRequest,
  type PrescriptionRequestDelivery,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useCart } from "@/patient/cart";
import { formatLeones, EmptyState } from "@/pages/hq/shared";
import { PushPrompt } from "@/components/PushSetting";

const REJECT_REASONS: Record<string, string> = {
  illegible_image: "The photo could not be read clearly.",
  expired_prescription: "The prescription has expired.",
  invalid_prescription: "The prescription could not be accepted.",
  drug_unavailable: "The pharmacy does not have these medicines.",
  controlled_substance_not_authorized: "It includes a controlled medicine this pharmacy cannot dispense.",
  patient_mismatch: "The prescription appears to be for someone else.",
  quantity_exceeded: "The quantity is more than is allowed.",
};

/** "4:12" until the given time, ticking every second; null once it has passed. */
function useCountdown(until: string | null | undefined): string | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const ms = new Date(until).getTime() - now;
  if (ms <= 0) return null;
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What delivery from the pharmacy that took it costs, so the patient knows before ordering. */
function DeliveryLine({ delivery }: { delivery: PrescriptionRequestDelivery | null | undefined }) {
  if (!delivery) return null;
  const km = delivery.distanceKm == null ? null : delivery.distanceEstimated ? `about ${delivery.distanceKm} km` : `${delivery.distanceKm} km by road`;
  return (
    <div className="rounded-2xl border bg-card p-4 flex gap-3 text-left" data-testid="request-delivery">
      {delivery.available ? <Bike className="w-5 h-5 text-primary shrink-0 mt-0.5" /> : <MapPinOff className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
      <div className="min-w-0">
        {delivery.available ? (
          <>
            <p className="font-medium text-sm">Delivery {formatLeones(delivery.feeLeones ?? 0)}{km ? ` · ${km}` : ""}</p>
            <p className="text-xs text-muted-foreground mt-0.5">To where you sent your prescription from. Or collect it from the pharmacy at no delivery charge.</p>
          </>
        ) : (
          <>
            <p className="font-medium text-sm">Collection only</p>
            <p className="text-xs text-muted-foreground mt-0.5">{delivery.message}</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Follow a prescription sent to the pharmacies nearby, and order once it is confirmed. */
export default function PrescriptionStatus() {
  const [, params] = useRoute("/app/prescription/:id");
  const id = params?.id ?? "";
  const [, navigate] = useLocation();
  const { data: request, isLoading } = useGetPatientPrescriptionRequest(id, {
    query: {
      enabled: Boolean(id),
      queryKey: getGetPatientPrescriptionRequestQueryKey(id),
      // Poll while a pharmacy may still act on it.
      refetchInterval: (q) => {
        const status = (q.state.data as PatientPrescriptionRequest | undefined)?.status;
        return status === "searching" || status === "accepted" ? 5000 : status === "out_of_range" ? 30_000 : false;
      },
    },
  });

  if (isLoading) return <EmptyState>Loading…</EmptyState>;
  if (!request) return <EmptyState>This prescription request was not found.</EmptyState>;

  return (
    <div className="space-y-5">
      <div>
        <button
          type="button"
          onClick={() => navigate("/app/search")}
          className="text-sm text-muted-foreground inline-flex items-center gap-1 mb-2"
        >
          <ArrowLeft className="w-4 h-4" /> Search
        </button>
        <h1 className="font-display font-bold text-2xl text-dark-green">Your prescription</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Sent {new Date(request.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          {request.areaName ? ` · ${request.areaName}` : ""}
        </p>
      </div>
      <StatusBody request={request} />
    </div>
  );
}

function StatusBody({ request }: { request: PatientPrescriptionRequest }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const cancel = useCancelPrescriptionRequest();
  const further = useAskPrescriptionRequestFurther();
  const { cart, startFromRequest, clear } = useCart();
  const left = useCountdown(request.status === "searching" ? request.roundEndsAt : null);
  const choiceLeft = useCountdown(request.status === "out_of_range" ? request.choiceEndsAt : null);

  async function onAskFurther() {
    try {
      await further.mutateAsync({ id: request.id });
      await queryClient.invalidateQueries();
    } catch (err) {
      const e = err as { data?: { error?: string } | null };
      toast({ title: "Not sent", description: e?.data?.error ?? "Try again.", variant: "destructive" });
      await queryClient.invalidateQueries();
    }
  }

  async function onCancel() {
    try {
      await cancel.mutateAsync({ id: request.id });
      if (cart?.prescriptionRequestId === request.id) clear();
      await queryClient.invalidateQueries();
    } catch (err) {
      const e = err as { data?: { error?: string } | null };
      toast({ title: "Not cancelled", description: e?.data?.error ?? "Try again.", variant: "destructive" });
    }
  }

  const cancelButton = (
    <Button variant="ghost" className="w-full text-muted-foreground" disabled={cancel.isPending} onClick={onCancel} data-testid="button-cancel-request">
      Cancel this request
    </Button>
  );

  switch (request.status) {
    case "searching":
      return (
        <>
          <Card data-testid="status-searching">
            <CardContent className="p-6 text-center space-y-3">
              <div className="relative mx-auto w-16 h-16">
                <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping motion-reduce:animate-none" />
                <span className="relative flex w-16 h-16 items-center justify-center rounded-full bg-primary/10">
                  <Store className="w-7 h-7 text-primary" />
                </span>
              </div>
              <p className="font-display font-semibold text-lg">Looking for a pharmacy</p>
              <p className="text-sm text-muted-foreground">
                {request.collectionOnly
                  ? "Pharmacies beyond delivery range can see your prescription now. You'll collect from the one that takes it."
                  : request.round <= 1
                    ? "The pharmacies nearest to you can see your prescription now."
                    : "No one nearby took it yet, so pharmacies a little further away can see it now. All of them can deliver to you."}
              </p>
              <p className="text-xs text-muted-foreground">
                {request.collectionOnly ? "Pharmacies further away" : `Search ${request.round} of ${request.maxRounds}`}
                {left ? (request.round >= request.maxRounds ? ` · ends in ${left}` : ` · widening in ${left}`) : ""}
              </p>
            </CardContent>
          </Card>
          <PushPrompt when="as soon as a pharmacy takes your prescription" />
          <p className="text-xs text-muted-foreground text-center">
            We'll send you a notification when a pharmacy takes it. You can leave this page.
          </p>
          {cancelButton}
        </>
      );

    case "out_of_range":
      return (
        <>
          <Card data-testid="status-out-of-range">
            <CardContent className="p-6 text-center space-y-3">
              <MapPinOff className="w-8 h-8 text-amber-600 mx-auto" />
              <p className="font-display font-semibold text-lg">No pharmacy within delivery range took it</p>
              <p className="text-sm text-muted-foreground">
                Pharmacies further away are open and can be asked too. They can't deliver that far, so you would collect
                your medicines from the one that takes it.
              </p>
              <div className="flex flex-col gap-2 pt-1">
                <Button className="rounded-full" disabled={further.isPending} onClick={onAskFurther} data-testid="button-ask-further">
                  Ask pharmacies further away · I'll collect
                </Button>
                <Button variant="outline" className="rounded-full" onClick={() => navigate("/app/search")}>Search medicines instead</Button>
              </div>
              {choiceLeft && <p className="text-xs text-muted-foreground">You have {choiceLeft} to choose. After that the request closes and the photo is deleted.</p>}
            </CardContent>
          </Card>
          {cancelButton}
        </>
      );

    case "accepted":
      return (
        <>
          <Card data-testid="status-accepted">
            <CardContent className="p-6 text-center space-y-2">
              <Loader2 className="w-8 h-8 text-primary mx-auto animate-spin motion-reduce:animate-none" />
              <p className="font-display font-semibold text-lg">{request.pharmacy?.name ?? "A pharmacy"} is checking your prescription</p>
              <p className="text-sm text-muted-foreground">They are choosing the medicines they have for you. This usually takes a few minutes.</p>
            </CardContent>
          </Card>
          <DeliveryLine delivery={request.delivery} />
          <PushPrompt when={`as soon as ${request.pharmacy?.name ?? "the pharmacy"} confirms your medicines`} />
          {cancelButton}
        </>
      );

    case "ready": {
      const items = request.items.filter((i) => i.maxQuantity > 0);
      const goToCheckout = () => {
        if (!request.pharmacy) return;
        startFromRequest(
          request.id,
          { id: request.pharmacy.id, name: request.pharmacy.name, address: request.pharmacy.address ?? null, mobileMoneyLines: request.pharmacy.mobileMoneyLines, mobileMoneyAccountName: request.pharmacy.mobileMoneyAccountName },
          items.map((i) => ({
            inventoryId: i.inventoryId,
            drugId: i.drugId,
            drugName: i.drugName,
            strength: i.strength,
            form: i.form,
            unitOfSale: i.unitOfSale,
            tier: i.tier,
            // The pharmacist's limit is this cart's ceiling.
            maxUnitsPerOrder: i.maxQuantity,
            prescriptionRequired: i.prescriptionRequired,
            collectionOnly: i.collectionOnly,
            priceLeones: i.priceLeones,
            brand: i.brand ?? null,
            manufacturer: i.manufacturer ?? null,
            countryOfOrigin: i.countryOfOrigin ?? null,
            quantity: i.maxQuantity,
            availableForDelivery: i.availableForDelivery,
            availableForCollection: i.availableForCollection,
          })),
          { collection: request.delivery?.available === false },
        );
        navigate("/app/checkout");
      };
      return (
        <>
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 flex gap-3" data-testid="status-ready">
            <CheckCircle2 className="w-6 h-6 text-primary shrink-0" />
            <div>
              <p className="font-medium">{request.pharmacy?.name} has your medicines</p>
              <p className="text-xs text-muted-foreground">
                {request.pharmacy?.address ? `${request.pharmacy.address} · ` : ""}The pharmacist checked your prescription.
              </p>
            </div>
          </div>
          {items.length === 0 ? (
            <EmptyState>These medicines have just run out at the pharmacy. Please send your prescription again.</EmptyState>
          ) : (
            <Card>
              <CardContent className="p-0 divide-y">
                {items.map((i) => (
                  <div key={i.inventoryId} className="p-4 flex items-start gap-3" data-testid={`request-item-${i.inventoryId}`}>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm">{i.drugName}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {[i.strength, i.form, i.brand].filter(Boolean).join(" · ")}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatLeones(i.priceLeones)} per {i.unitOfSale} · up to {i.maxQuantity}
                        {i.collectionOnly && " · collection + ID only"}
                      </div>
                    </div>
                    <div className="text-sm font-medium tabular-nums">{formatLeones(i.priceLeones * i.maxQuantity)}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {items.length > 0 && <DeliveryLine delivery={request.delivery} />}
          {items.length > 0 && (
            <Button className="w-full rounded-full h-12 text-base" onClick={goToCheckout} data-testid="button-request-checkout">
              Continue to checkout
            </Button>
          )}
          <p className="text-xs text-muted-foreground text-center">
            {request.delivery?.available === false
              ? "At checkout you can lower a quantity and pay, then collect from the pharmacy."
              : "At checkout you can lower a quantity, choose delivery or collection, and pay."}
          </p>
          {cancelButton}
        </>
      );
    }

    case "ordered":
      return (
        <Card data-testid="status-ordered">
          <CardContent className="p-6 text-center space-y-3">
            <CheckCircle2 className="w-8 h-8 text-primary mx-auto" />
            <p className="font-display font-semibold text-lg">Ordered</p>
            {request.orderId && (
              <Button className="rounded-full" onClick={() => navigate(`/app/orders/${request.orderId}`)}>View your order</Button>
            )}
          </CardContent>
        </Card>
      );

    default: {
      const rejected = request.status === "rejected";
      const expired = request.status === "expired";
      return (
        <Card data-testid={`status-${request.status}`}>
          <CardContent className="p-6 text-center space-y-3">
            {rejected ? <FileX className="w-8 h-8 text-destructive mx-auto" /> : <Clock className="w-8 h-8 text-muted-foreground mx-auto" />}
            <p className="font-display font-semibold text-lg">
              {rejected ? "The pharmacist could not accept it" : expired ? "No pharmacy took it in time" : "Cancelled"}
            </p>
            <p className="text-sm text-muted-foreground">
              {rejected
                ? REJECT_REASONS[request.rejectReason ?? ""] ?? "The prescription was not accepted."
                : expired
                  ? "No pharmacy near you confirmed your medicines this time. You can send it again, or search for the medicines by name."
                  : "This request was cancelled and the photo deleted."}
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <Button className="rounded-full" onClick={() => navigate("/app/prescription")} data-testid="button-send-again">Upload prescription</Button>
              <Button variant="outline" className="rounded-full" onClick={() => navigate("/app/search")}>Search medicines</Button>
            </div>
          </CardContent>
        </Card>
      );
    }
  }
}
