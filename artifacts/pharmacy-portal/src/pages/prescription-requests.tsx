import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPharmacyPrescriptionRequests,
  getListPharmacyPrescriptionRequestsQueryKey,
  useAcceptPrescriptionRequest,
  useDeclinePrescriptionRequest,
  useConfirmPrescriptionRequest,
  useRejectPrescriptionRequest,
  useListInventory,
  PrescriptionRequestRejectionReason,
  type PharmacyOpenPrescriptionRequest,
  type PharmacyAcceptedPrescriptionRequest,
  type InventoryItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle2, Clock, MapPin, Minus, Phone, Plus, Search, User, X } from "lucide-react";
import { formatLeones as formatCurrency } from "@/lib/format";
import { freshAccessToken } from "@/lib/session";
import { SoundToggle } from "@/components/SoundToggle";
import { orderNumber } from "@/lib/orderNumber";
import { PushNudge } from "@/components/PushSetting";

const REASONS: Array<[PrescriptionRequestRejectionReason, string]> = [
  [PrescriptionRequestRejectionReason.illegible_image, "Photo can't be read"],
  [PrescriptionRequestRejectionReason.expired_prescription, "Prescription has expired"],
  [PrescriptionRequestRejectionReason.invalid_prescription, "Not a valid prescription"],
  [PrescriptionRequestRejectionReason.drug_unavailable, "Medicines not available"],
  [PrescriptionRequestRejectionReason.controlled_substance_not_authorized, "Controlled medicine, not authorised"],
  [PrescriptionRequestRejectionReason.patient_mismatch, "Prescription is for someone else"],
  [PrescriptionRequestRejectionReason.quantity_exceeded, "Quantity more than allowed"],
];

/** The request's photo, fetched with the pharmacy's sign-in (covered before accepting). */
function RequestPhoto({ id, version, className }: { id: string; version: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let href: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const base = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
        const token = await freshAccessToken();
        const r = await fetch(`${base}/api/pharmacy/prescription-requests/${encodeURIComponent(id)}/photo`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" });
        if (!r.ok) throw new Error();
        href = URL.createObjectURL(await r.blob());
        if (!cancelled) setUrl(href);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; if (href) URL.revokeObjectURL(href); };
  }, [id, version]);
  if (failed) return <div className={`flex items-center justify-center bg-muted text-sm text-muted-foreground ${className}`}>Photo not available</div>;
  if (!url) return <div className={`animate-pulse bg-muted ${className}`} />;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Prescription photo" className={`object-contain bg-white ${className}`} data-testid={`img-request-${id}`} /></a>;
}

function useCountdown(iso: string | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!iso) return null;
  const s = Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function PrescriptionRequests() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useListPharmacyPrescriptionRequests({ query: { queryKey: getListPharmacyPrescriptionRequestsQueryKey(), refetchInterval: 5_000 } });
  const open = data?.open ?? [];
  const mine = data?.mine ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: getListPharmacyPrescriptionRequestsQueryKey() });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Prescription requests</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">Patients nearby sent a photo of their prescription. The first pharmacy to accept gets it. Names are covered until you accept.</p>
        </div>
        <SoundToggle size="default" />
      </div>

      <PushNudge />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">New requests near you {open.length > 0 && <Badge className="ml-2">{open.length}</Badge>}</h2>
        {isLoading ? <div className="h-40 rounded-xl bg-muted animate-pulse" /> : open.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">No new requests. Keep this page open: new ones appear here within seconds.</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{open.map((r) => <OpenCard key={r.id} request={r} onDone={refresh} />)}</div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Accepted by you</h2>
        {mine.length === 0 ? <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Requests you accept appear here, with the full prescription and the patient's details.</div>
          : <div className="space-y-4">{mine.map((r) => <AcceptedCard key={r.id} request={r} onDone={refresh} />)}</div>}
      </section>
    </div>
  );
}

function OpenCard({ request, onDone }: { request: PharmacyOpenPrescriptionRequest; onDone: () => void }) {
  const accept = useAcceptPrescriptionRequest();
  const decline = useDeclinePrescriptionRequest();
  const left = useCountdown(request.roundEndsAt);
  return (
    <div className="rounded-xl border bg-card overflow-hidden flex flex-col" data-testid={`card-open-${request.id}`}>
      <RequestPhoto id={request.id} version="covered" className="w-full h-64 border-b" />
      <div className="p-4 space-y-3 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-3 text-sm">
          <span className="flex items-start gap-1.5 min-w-0">
            <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <span>
              <span className="font-medium block">{request.areaName ?? "Nearby"}</span>
              {request.distanceKm != null && <span className="text-muted-foreground text-xs">About {request.distanceKm} km from you</span>}
            </span>
          </span>
          {left && <span className="flex items-center gap-1 text-amber-700 shrink-0 tabular-nums" title="Time left before pharmacies further away are asked too"><Clock className="w-4 h-4" />{left}</span>}
        </div>
        {request.collectionOnly && (
          <p className="text-xs rounded-md bg-amber-50 border border-amber-200 text-amber-900 px-2.5 py-1.5" data-testid={`collection-only-${request.id}`}>
            <strong>Collection only.</strong> The patient is beyond delivery range and will come to your pharmacy.
          </p>
        )}
        <p className="text-xs text-muted-foreground">{request.hasCoveredPhoto ? "The patient covered their name. You'll see the full prescription and their details when you accept." : "Patient details are shown when you accept."}</p>
        <div className="grid grid-cols-2 gap-2 mt-auto pt-2">
          <Button variant="outline" disabled={decline.isPending} onClick={async () => { await decline.mutateAsync({ id: request.id }).catch(() => {}); onDone(); }} data-testid={`button-decline-${request.id}`}>Not available</Button>
          <Button disabled={accept.isPending} onClick={async () => {
            try { await accept.mutateAsync({ id: request.id }); toast.success("Accepted. Choose the medicines you can supply."); }
            catch (e: any) { toast.error(e?.data?.error ?? e?.message ?? "Could not accept"); }
            onDone();
          }} data-testid={`button-accept-${request.id}`}>Accept</Button>
        </div>
      </div>
    </div>
  );
}

function AcceptedCard({ request, onDone }: { request: PharmacyAcceptedPrescriptionRequest; onDone: () => void }) {
  const confirmBy = useCountdown(request.confirmBy);
  const confirm = useConfirmPrescriptionRequest();
  const reject = useRejectPrescriptionRequest();
  const { data: inventory } = useListInventory();
  const [picked, setPicked] = useState<Map<string, number>>(new Map());
  const [query, setQuery] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<PrescriptionRequestRejectionReason | "">("");

  const stock = useMemo(() => (inventory ?? []).filter((i) => i.isActive && i.stockQuantity > 0 && i.completionStatus === "complete"), [inventory]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return stock.filter((i) => [i.drug.name, i.drug.genericName, i.brand, i.manufacturer].some((v) => v?.toLowerCase().includes(q))).slice(0, 8);
  }, [stock, query]);
  const label = (i: InventoryItem) => `${i.drug.name}${i.strength ? ` ${i.strength}` : ""}${i.form ? ` ${i.form}` : ""}`;

  const statusBadge = request.status === "accepted" ? <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Choose medicines{confirmBy ? ` · ${confirmBy} left` : ""}</Badge>
    : request.status === "ready" ? <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100">Sent to patient · waiting for payment</Badge>
    : <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Ordered{request.orderId ? ` · #${orderNumber(request.orderId)}` : ""}</Badge>;

  return (
    <div className="rounded-xl border bg-card grid lg:grid-cols-[340px_1fr] overflow-hidden" data-testid={`card-mine-${request.id}`}>
      {request.status !== "ordered" ? <RequestPhoto id={request.id} version="original" className="w-full h-full min-h-72 border-r" /> : <div className="bg-muted/40 flex items-center justify-center text-sm text-muted-foreground p-6">The prescription is now with the order.</div>}
      <div className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex flex-wrap items-center gap-2">{statusBadge}{request.collectionOnly && <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Collection only</Badge>}</span><span className="text-sm text-muted-foreground flex items-center gap-1"><MapPin className="w-4 h-4" />{request.areaName}</span></div>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2"><User className="w-4 h-4 text-muted-foreground" /><span className="font-medium">{request.patientName}</span></div>
          <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-muted-foreground" /><span>{request.patientPhone}</span></div>
        </div>
        {request.note && <p className="text-sm bg-muted/40 rounded-md p-3"><span className="text-muted-foreground">Patient's note: </span>{request.note}</p>}

        {request.status === "accepted" && !rejecting && (
          <div className="space-y-3">
            <h3 className="font-semibold">Medicines you will supply</h3>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search your stock by name, generic name or brand" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="input-stock-search" />
              {matches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md max-h-64 overflow-auto">
                  {matches.map((i) => (
                    <button key={i.id} className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex justify-between gap-3" onClick={() => { setPicked(new Map(picked).set(i.id, picked.get(i.id) ?? 1)); setQuery(""); }} data-testid={`option-stock-${i.id}`}>
                      <span><span className="font-medium">{label(i)}</span><span className="text-muted-foreground"> · {i.brand ?? "Generic"}</span>{i.drug.tier === "1" && <Badge variant="destructive" className="ml-2">Controlled</Badge>}</span>
                      <span className="text-muted-foreground shrink-0">{formatCurrency(i.priceLeones)} · {i.stockQuantity} in stock</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {picked.size === 0 ? <p className="text-sm text-muted-foreground">Search above and add each medicine on the prescription.</p> : (
              <div className="divide-y rounded-md border">
                {[...picked.entries()].map(([id, qty]) => {
                  const i = stock.find((s) => s.id === id);
                  if (!i) return null;
                  return (
                    <div key={id} className="flex items-center justify-between gap-3 p-3 text-sm">
                      <div><div className="font-medium">{label(i)}</div><div className="text-muted-foreground">{i.brand ?? "Generic"} · {formatCurrency(i.priceLeones)} per {i.unitOfSale ?? "pack"}</div></div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground hidden sm:inline">Up to</span>
                        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setPicked(new Map(picked).set(id, Math.max(1, qty - 1)))}><Minus className="w-3 h-3" /></Button>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={i.stockQuantity}
                          value={qty}
                          onChange={(e) => {
                            const n = Math.floor(Number(e.target.value));
                            if (Number.isFinite(n)) setPicked(new Map(picked).set(id, Math.max(1, Math.min(i.stockQuantity, n))));
                          }}
                          className="w-16 h-8 text-center font-semibold"
                          aria-label={`Most the patient may order of ${label(i)}`}
                          data-testid={`qty-${id}`}
                        />
                        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setPicked(new Map(picked).set(id, Math.min(i.stockQuantity, qty + 1)))}><Plus className="w-3 h-3" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { const m = new Map(picked); m.delete(id); setPicked(m); }}><X className="w-4 h-4" /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-muted-foreground">"Up to" is the most the patient may order of each medicine, as the prescription allows. The patient can choose less.</p>
            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="outline" onClick={() => setRejecting(true)} data-testid="button-reject-request">Reject prescription</Button>
              <Button disabled={picked.size === 0 || confirm.isPending} onClick={async () => {
                try {
                  await confirm.mutateAsync({ id: request.id, data: { items: [...picked.entries()].map(([inventoryId, maxQuantity]) => ({ inventoryId, maxQuantity })) } });
                  toast.success("Sent to the patient. They'll choose quantities and pay.");
                } catch (e: any) { toast.error(e?.data?.error ?? e?.message ?? "Could not send"); }
                onDone();
              }} data-testid="button-send-to-patient"><CheckCircle2 className="w-4 h-4 mr-2" />Send to patient</Button>
            </div>
          </div>
        )}

        {request.status === "accepted" && rejecting && (
          <div className="space-y-3">
            <h3 className="font-semibold">Why can't you fill this prescription?</h3>
            <Select value={reason} onValueChange={(v) => setReason(v as PrescriptionRequestRejectionReason)}>
              <SelectTrigger><SelectValue placeholder="Choose a reason" /></SelectTrigger>
              <SelectContent>{REASONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setRejecting(false)}>Back</Button>
              <Button variant="destructive" disabled={!reason || reject.isPending} onClick={async () => {
                try { await reject.mutateAsync({ id: request.id, data: { reason: reason as PrescriptionRequestRejectionReason } }); toast.success("The patient has been told."); }
                catch (e: any) { toast.error(e?.data?.error ?? e?.message ?? "Could not reject"); }
                onDone();
              }}>Reject</Button>
            </div>
          </div>
        )}

        {request.status !== "accepted" && request.items.length > 0 && (
          <ul className="text-sm divide-y rounded-md border">{request.items.map((i) => <li key={i.inventoryId} className="flex justify-between p-3"><span>{i.drugName} {i.strength} · {i.brand ?? "Generic"}</span><span className="text-muted-foreground">up to {i.maxQuantity}</span></li>)}</ul>
        )}
      </div>
    </div>
  );
}
