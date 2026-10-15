import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useLocation } from "wouter";
import { Camera, ImageUp, Undo2, Eraser, MapPin, ShieldCheck, ArrowLeft } from "lucide-react";
import {
  usePatientUploadPrescription,
  useCreatePrescriptionRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { LocationPicker } from "@/components/map/LocationPicker";
import { currentPosition, type LatLng } from "@/components/map/mapConfig";

/** A box the patient drew, in the photo's own pixels. */
type Box = { x: number; y: number; w: number; h: number };

/** Long edge of the photos sent: sharp enough to read, well under the 5 MB limit. */
const MAX_EDGE = 1600;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("This photo could not be opened. Try another one."));
    img.src = url;
  });
}

/** The photo as a JPEG data URL, scaled down, with the boxes painted over it. */
function exportJpeg(img: HTMLImageElement, boxes: Box[]): string {
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111";
  for (const b of boxes) ctx.fillRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function normalise(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/**
 * Send a prescription photo to the pharmacies nearby. The patient covers their
 * name and other details first: that covered copy is what every pharmacy sees,
 * and the full photo goes only to the pharmacy that takes the prescription.
 */
export default function PrescriptionSend() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"photo" | "cover" | "send">("photo");
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [coveredUrl, setCoveredUrl] = useState<string | null>(null);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  const upload = usePatientUploadPrescription();
  const create = useCreatePrescriptionRequest();
  const busy = upload.isPending || create.isPending;

  // The location is asked for as soon as the patient starts, so it is ready
  // (or the map is showing) by the time they reach the last step.
  useEffect(() => {
    setLocating(true);
    currentPosition()
      .then((p) => { setPin(p); setLocationError(null); })
      .catch((e: Error) => setLocationError(e.message))
      .finally(() => setLocating(false));
  }, []);

  async function onPick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Not a photo", description: "Choose a photo of your prescription.", variant: "destructive" });
      return;
    }
    try {
      setImage(await loadImage(file));
      setBoxes([]);
      setStep("cover");
    } catch (e) {
      toast({ title: "Photo not opened", description: (e as Error).message, variant: "destructive" });
    }
  }

  function finishCovering(skip: boolean) {
    if (!image) return;
    setCoveredUrl(skip ? null : exportJpeg(image, boxes));
    setStep("send");
  }

  async function send() {
    if (!image) return;
    if (!pin) {
      toast({ title: "Location needed", description: "Use your location or tap the map, so we can find pharmacies near you.", variant: "destructive" });
      return;
    }
    try {
      const original = await upload.mutateAsync({ data: { image: exportJpeg(image, []) } });
      const covered = coveredUrl ? await upload.mutateAsync({ data: { image: coveredUrl } }) : null;
      const request = await create.mutateAsync({
        data: {
          imageKey: original.imageKey,
          ...(covered ? { coveredImageKey: covered.imageKey } : {}),
          latitude: pin.latitude,
          longitude: pin.longitude,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      await queryClient.invalidateQueries();
      navigate(`/app/prescription/${request.id}`);
    } catch (err) {
      const e = err as { data?: { error?: string } | null; message?: string };
      toast({ title: "Not sent", description: e?.data?.error ?? e?.message ?? "Check your connection and try again.", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <button
          type="button"
          onClick={() => (step === "photo" ? navigate("/app/search") : setStep(step === "send" ? "cover" : "photo"))}
          className="text-sm text-muted-foreground inline-flex items-center gap-1 mb-2"
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="font-display font-bold text-2xl text-dark-green mb-1">Upload prescription</h1>
        <p className="text-sm text-muted-foreground">
          Pharmacies near you see it, and the first one that has your medicines takes it.
        </p>
      </div>

      <ol className="flex gap-2 text-xs" aria-label="Steps">
        {(["photo", "cover", "send"] as const).map((s, i) => (
          <li
            key={s}
            className={`flex-1 rounded-full px-3 py-1.5 text-center font-medium ${
              s === step ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground border"
            }`}
          >
            {i + 1}. {s === "photo" ? "Photo" : s === "cover" ? "Cover name" : "Send"}
          </li>
        ))}
      </ol>

      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-camera" />
      <input ref={galleryInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
        onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-gallery" />

      {step === "photo" && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => cameraInput.current?.click()}
            className="w-full border-2 border-dashed border-primary/40 bg-card rounded-2xl p-6 flex flex-col items-center gap-2 text-sm"
            data-testid="button-take-photo"
          >
            <Camera className="w-8 h-8 text-primary" />
            <span className="font-medium">Take a photo of your prescription</span>
            <span className="text-xs text-muted-foreground">Flat on a table, in good light, the whole page in view</span>
          </button>
          <Button variant="outline" className="w-full rounded-full" onClick={() => galleryInput.current?.click()} data-testid="button-choose-photo">
            <ImageUp className="w-4 h-4 mr-2" /> Choose from your photos
          </Button>
        </div>
      )}

      {step === "cover" && image && (
        <CoverStep image={image} boxes={boxes} onChange={setBoxes} onDone={finishCovering} />
      )}

      {step === "send" && image && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-3 flex gap-3 items-center">
              <img
                src={coveredUrl ?? image.src}
                alt="Your prescription"
                className="w-20 h-24 object-cover rounded-lg border shrink-0"
                data-testid="img-preview"
              />
              <p className="text-xs text-muted-foreground">
                {coveredUrl
                  ? "Pharmacies near you will see this covered copy. Only the pharmacy that takes your prescription sees the full photo and your name."
                  : "You did not cover anything, so pharmacies near you will see the whole photo."}
              </p>
            </CardContent>
          </Card>

          <div className="space-y-1.5">
            <Label>Your location</Label>
            {pin && !locationError ? (
              <div className="text-sm rounded-xl border bg-card p-3 flex items-center gap-2" data-testid="text-location">
                <MapPin className="w-4 h-4 text-primary shrink-0" />
                <span className="flex-1">Using your current location</span>
                <button type="button" className="text-xs text-primary font-medium" onClick={() => setLocationError("Tap the map to move the pin.")}>
                  Change
                </button>
              </div>
            ) : (
              <>
                {locating && <p className="text-xs text-muted-foreground">Finding your location…</p>}
                {locationError && <p className="text-xs text-muted-foreground">{locationError}</p>}
                <LocationPicker value={pin} onChange={setPin} height={220} testId="map-request-location" />
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Anything the pharmacist should know? (optional)</Label>
            <Textarea
              id="note"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. I need it today, or I prefer a particular brand"
              rows={2}
              data-testid="input-note"
            />
          </div>

          <Button className="w-full rounded-full h-12 text-base" disabled={busy || !pin} onClick={send} data-testid="button-send-request">
            {busy ? "Sending…" : "Send to pharmacies near me"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Nothing is paid yet. You choose quantities and pay after a pharmacist confirms your medicines.
          </p>
        </div>
      )}
    </div>
  );
}

/** Draw boxes over the name, phone number and address on the photo. */
function CoverStep({
  image,
  boxes,
  onChange,
  onDone,
}: {
  image: HTMLImageElement;
  boxes: Box[];
  onChange: (boxes: Box[]) => void;
  onDone: (skip: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [drawing, setDrawing] = useState<Box | null>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    c.width = Math.round(image.naturalWidth * scale);
    c.height = Math.round(image.naturalHeight * scale);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(image, 0, 0, c.width, c.height);
    ctx.fillStyle = "#111";
    for (const b of boxes) ctx.fillRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
    if (drawing) {
      ctx.fillStyle = "rgba(17,17,17,0.6)";
      ctx.fillRect(drawing.x * scale, drawing.y * scale, drawing.w * scale, drawing.h * scale);
    }
  }, [image, boxes, drawing]);

  /** The pointer's position in the photo's own pixels. */
  function point(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * image.naturalWidth,
      y: ((e.clientY - rect.top) / rect.height) * image.naturalHeight,
    };
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 text-sm flex gap-2">
        <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
        <span>
          Drag a box over your <span className="font-medium">name, phone number and address</span>. Pharmacies nearby see the covered copy; only the one that takes your prescription sees the full photo.
        </span>
      </div>
      <canvas
        ref={canvas}
        className="w-full h-auto rounded-xl border bg-card touch-none cursor-crosshair select-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = point(e);
        }}
        onPointerMove={(e) => {
          if (start.current) setDrawing(normalise(start.current, point(e)));
        }}
        onPointerUp={(e) => {
          if (!start.current) return;
          const box = normalise(start.current, point(e));
          start.current = null;
          setDrawing(null);
          // A tap is not a box: ignore anything smaller than 1% of the photo.
          if (box.w > image.naturalWidth / 100 && box.h > image.naturalHeight / 100) onChange([...boxes, box]);
        }}
        onPointerCancel={() => { start.current = null; setDrawing(null); }}
        data-testid="canvas-cover"
      />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="rounded-full" disabled={boxes.length === 0} onClick={() => onChange(boxes.slice(0, -1))} data-testid="button-undo-box">
          <Undo2 className="w-4 h-4 mr-1.5" /> Undo
        </Button>
        <Button variant="outline" size="sm" className="rounded-full" disabled={boxes.length === 0} onClick={() => onChange([])} data-testid="button-clear-boxes">
          <Eraser className="w-4 h-4 mr-1.5" /> Clear
        </Button>
        <span className="ml-auto self-center text-xs text-muted-foreground">
          {boxes.length === 0 ? "Nothing covered yet" : `${boxes.length} covered`}
        </span>
      </div>
      <Button className="w-full rounded-full h-11" disabled={boxes.length === 0} onClick={() => onDone(false)} data-testid="button-cover-done">
        Continue
      </Button>
      <button type="button" className="w-full text-xs text-muted-foreground underline underline-offset-2" onClick={() => onDone(true)} data-testid="button-skip-cover">
        Send without covering anything
      </button>
    </div>
  );
}
