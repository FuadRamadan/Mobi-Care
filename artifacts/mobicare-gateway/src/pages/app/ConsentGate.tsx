/**
 * Asks patients who registered before consent existed — and everyone again
 * whenever the policy text materially changes.
 *
 * Not dismissible, because it is not a notice: it is the decision that makes it
 * lawful to keep holding this person's prescriptions. But it is also not a
 * lock-out. The rest of the app stays readable behind it, and the server only
 * refuses to create anything new (see lib/patientConsent.ts) — someone who
 * wants to read their orders, export their data or delete their account must
 * still be able to, especially if what they are declining is us keeping it.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePatientAuth } from "@/patient/auth";
import { ConsentChoices, EMPTY_CONSENT, type ConsentChoiceState } from "@/patient/ConsentChoices";
import { apiUrl } from "@/lib/apiUrl";
import { PT_ACCESS_KEY } from "@/lib/portalToken";

export function ConsentGate() {
  const { user } = usePatientAuth();
  const [needed, setNeeded] = useState(false);
  const [choices, setChoices] = useState<ConsentChoiceState>(EMPTY_CONSENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(apiUrl("/api/patient/privacy"), {
          headers: { Authorization: `Bearer ${localStorage.getItem(PT_ACCESS_KEY)}` },
        });
        if (!response.ok) return;
        const state = await response.json() as { needsConsent: boolean; mayRecordAnalytics: boolean };
        if (cancelled) return;
        setNeeded(state.needsConsent);
        // Carry a previous "yes" forward as the starting position, but never a
        // previous "no" into a tick — a decision to opt in is made once, here.
        setChoices({ termsAndPrivacy: false, researchAnalytics: state.mayRecordAnalytics });
      } catch {
        // A failed check must not block the app. The server is the real gate.
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(apiUrl("/api/patient/privacy/consent"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem(PT_ACCESS_KEY)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          termsAndPrivacy: true,
          researchAnalytics: choices.researchAnalytics,
        }),
      });
      if (!response.ok) throw new Error();
      setNeeded(false);
    } catch {
      setError("Could not save that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!user || !needed) return null;

  return (
    <Dialog open>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto [&>button]:hidden"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Before you continue</DialogTitle>
          <DialogDescription>
            We have set out clearly how MobiCare handles your information. Please
            read and agree to carry on ordering.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ConsentChoices value={choices} onChange={setChoices} disabled={busy} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            className="w-full rounded-full"
            disabled={busy || !choices.termsAndPrivacy}
            onClick={() => void submit()}
            data-testid="button-accept-consent"
          >
            {busy ? "Saving…" : "Agree and continue"}
          </Button>
          <p className="text-xs text-muted-foreground">
            You can still view your orders and download or delete your data
            without agreeing — see Profile.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
