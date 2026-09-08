/**
 * The patient's own controls: what they have agreed to, a copy of everything
 * held about them, and the right to have it erased.
 *
 * Deliberately in the app rather than in a policy document somewhere. A right
 * that requires emailing someone is not a right most people will ever use.
 */

import { useEffect, useState } from "react";
import { Download, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { usePatientAuth } from "@/patient/auth";
import { apiUrl } from "@/lib/apiUrl";
import { PT_ACCESS_KEY } from "@/lib/portalToken";

const ERASURE_PHRASE = "DELETE MY ACCOUNT";

interface ConsentDecision {
  granted: boolean;
  policyVersion: string | null;
  recordedAt: string | null;
  outdated: boolean;
}

interface ConsentState {
  policyVersion: string;
  termsAndPrivacy: ConsentDecision;
  researchAnalytics: ConsentDecision;
  needsConsent: boolean;
  mayRecordAnalytics: boolean;
}

const authHeaders = (): HeadersInit => ({
  Authorization: `Bearer ${localStorage.getItem(PT_ACCESS_KEY)}`,
});

export function PrivacyPanel() {
  const { logout } = usePatientAuth();
  const { toast } = useToast();

  const [state, setState] = useState<ConsentState | null>(null);
  const [analytics, setAnalytics] = useState(false);
  const [saving, setSaving] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [erasing, setErasing] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const response = await fetch(apiUrl("/api/patient/privacy"), { headers: authHeaders() });
    if (!response.ok) return;
    const next = await response.json() as ConsentState;
    setState(next);
    setAnalytics(next.mayRecordAnalytics);
  };

  useEffect(() => { void load(); }, []);

  const saveAnalytics = async (granted: boolean) => {
    setAnalytics(granted);
    setSaving(true);
    try {
      const response = await fetch(apiUrl("/api/patient/privacy/consent"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        // The required consent is not touched here — this control is only the
        // optional one. Withdrawing the other belongs with deleting the account.
        body: JSON.stringify({ termsAndPrivacy: true, researchAnalytics: granted }),
      });
      if (!response.ok) throw new Error();
      setState(await response.json() as ConsentState);
      toast({
        title: granted ? "Thank you — your searches will be counted" : "Your searches will not be recorded",
      });
    } catch {
      setAnalytics(!granted);
      toast({ title: "Could not save that. Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const download = async () => {
    const response = await fetch(apiUrl("/api/patient/privacy/export"), { headers: authHeaders() });
    if (!response.ok) {
      toast({ title: "Could not prepare your data. Please try again.", variant: "destructive" });
      return;
    }
    const href = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = href;
    link.download = "mobicare-my-data.json";
    link.click();
    URL.revokeObjectURL(href);
  };

  const erase = async () => {
    setErasing(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/api/patient/privacy/erase"), {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm: ERASURE_PHRASE }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Could not delete your account. Nothing has been changed.");
        return;
      }
      // Nothing to return to: the account is gone.
      logout();
    } catch {
      setError("Could not reach the server. Nothing has been changed.");
    } finally {
      setErasing(false);
    }
  };

  return (
    <section className="rounded-2xl border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-primary" />
        <h2 className="font-semibold">Your data</h2>
      </div>

      <label className="flex gap-3 items-start cursor-pointer">
        <Checkbox
          checked={analytics}
          disabled={saving || state === null}
          onCheckedChange={(checked) => void saveAnalytics(checked === true)}
          className="mt-0.5"
          data-testid="checkbox-analytics-consent"
        />
        <span className="text-xs leading-relaxed">
          <span className="font-medium">Help improve medicine access.</span>{" "}
          <span className="text-muted-foreground">
            Let your searches count towards the anonymous figures that show where
            medicines are hard to find. Never your name, prescriptions or orders.
            Turning this off stops the recording — it does not affect your orders.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void download()} data-testid="button-download-my-data">
          <Download className="w-3.5 h-3.5" />
          Download my data
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-destructive border-destructive/40 hover:bg-destructive/5"
          onClick={() => { setEraseOpen(true); setPassword(""); setTyped(""); setError(""); }}
          data-testid="button-delete-account"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete my account
        </Button>
      </div>

      <Dialog open={eraseOpen} onOpenChange={(next) => { if (!next) setEraseOpen(false); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <div>
              <p className="font-medium">Removed</p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground space-y-0.5">
                <li>Your name, phone number, address and photo</li>
                <li>Your search history and notifications</li>
                <li>Prescription photos you uploaded but never used</li>
                <li>Every device you are signed in on</li>
              </ul>
            </div>
            <div>
              <p className="font-medium">Kept, without your name on it</p>
              <p className="mt-1 text-muted-foreground">
                Orders you placed, and any prescription a pharmacist reviewed for
                them. A pharmacy has to keep a record of the medicine it
                dispensed — but after this it no longer says who it was for.
              </p>
            </div>

            {error && <p className="text-destructive">{error}</p>}

            <label className="block">
              Your password
              <Input
                type="password"
                className="mt-1"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                data-testid="input-erase-password"
              />
            </label>

            <label className="block">
              Type <code className="rounded bg-muted px-1 font-mono">{ERASURE_PHRASE}</code> to confirm
              <Input
                className="mt-1"
                value={typed}
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
                data-testid="input-erase-confirm"
              />
            </label>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEraseOpen(false)} disabled={erasing}>
                Keep my account
              </Button>
              <Button
                variant="destructive"
                disabled={erasing || password.length === 0 || typed.trim() !== ERASURE_PHRASE}
                onClick={() => void erase()}
                data-testid="button-confirm-erase"
              >
                {erasing ? "Deleting…" : "Delete my account"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
