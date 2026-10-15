import { useState } from "react";
import { BellRing, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useWebPush, type PushState } from "@/lib/webPush";

const HELP: Partial<Record<PushState, string>> = {
  "needs-install": "On iPhone or iPad: tap Share, then “Add to Home Screen”, and open MobiCare from your Home Screen. Then turn this on.",
  denied: "Notifications are blocked for MobiCare in this browser. Allow them in the browser's site settings, then come back.",
  unsupported: "This browser cannot show notifications. Try Chrome, or the latest Safari.",
};

/** Profile switch: alerts that drop down on the phone, even with MobiCare closed. */
export function PushSetting({ className }: { className?: string }) {
  const { state, busy, error, enable, disable } = useWebPush();
  if (state === "loading" || state === "unavailable") return null;
  const switchable = state === "on" || state === "off";
  return (
    <div className={className} data-testid="setting-push">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="push-notifications" className="min-w-0 cursor-pointer">
          <span className="font-medium text-sm flex items-center gap-2">
            <BellRing className={`w-4 h-4 ${state === "on" ? "text-primary" : "text-muted-foreground"}`} />
            Phone notifications
          </span>
          <span className="block text-xs text-muted-foreground mt-0.5">
            Alerts drop down on your phone when your order or prescription moves on, even when MobiCare is closed.
          </span>
        </label>
        <Switch
          id="push-notifications"
          checked={state === "on"}
          disabled={!switchable || busy}
          onCheckedChange={(on) => void (on ? enable() : disable())}
          data-testid="switch-push"
        />
      </div>
      {HELP[state] && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-3">{HELP[state]}</p>}
      {error && <p className="text-xs text-destructive mt-2" role="alert">{error}</p>}
    </div>
  );
}

const DISMISS_KEY = "mc_push_prompt_dismissed";

/**
 * Shown while the patient waits on a pharmacy or HQ: they can turn
 * notifications on and leave the app. Hidden once on, or once dismissed.
 */
export function PushPrompt({ when }: { when: string }) {
  const { state, busy, error, enable } = useWebPush();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  if (dismissed || (state !== "off" && state !== "needs-install")) return null;
  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode */ }
  };
  return (
    <div className="rounded-2xl border border-primary/30 bg-card p-4 flex gap-3" data-testid="prompt-push">
      <BellRing className="w-5 h-5 text-primary shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-sm font-medium">No need to keep MobiCare open</p>
        <p className="text-xs text-muted-foreground">
          {state === "needs-install"
            ? `To get an alert ${when}, add MobiCare to your Home Screen (Share, then “Add to Home Screen”) and open it from there.`
            : `Turn on notifications and we'll alert you on this phone ${when}.`}
        </p>
        {state === "off" && (
          <Button size="sm" className="rounded-full" disabled={busy} onClick={() => void enable()} data-testid="button-enable-push">
            Turn on notifications
          </Button>
        )}
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      </div>
      <button type="button" onClick={dismiss} className="text-muted-foreground self-start" aria-label="Not now">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
