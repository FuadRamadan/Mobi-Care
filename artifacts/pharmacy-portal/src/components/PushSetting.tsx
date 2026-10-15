import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useWebPush, type PushState } from "@/lib/webPush";

const HELP: Partial<Record<PushState, string>> = {
  "needs-install": "On iPhone or iPad: tap Share, then “Add to Home Screen”, and open the portal from your Home Screen. Then turn this on.",
  denied: "Notifications are blocked for this site in your browser. Allow them in the browser's site settings, then come back.",
  unsupported: "This browser cannot show notifications. Use Chrome, Edge or the latest Safari.",
};

/** Profile switch: alerts that drop down on this computer, even with the portal in the background. */
export function PushSetting() {
  const { state, busy, error, enable, disable } = useWebPush();
  if (state === "loading" || state === "unavailable") return null;
  const switchable = state === "on" || state === "off";
  return (
    <div data-testid="setting-push">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="push-notifications" className="min-w-0 cursor-pointer">
          <span className="font-medium text-sm flex items-center gap-2">
            <BellRing className={`w-4 h-4 ${state === "on" ? "text-primary" : "text-muted-foreground"}`} />
            Pop-up notifications
          </span>
          <span className="block text-xs text-muted-foreground mt-0.5">
            New orders and prescription requests pop up on this computer, even when the portal is in the background.
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
      {HELP[state] && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2 mt-3">{HELP[state]}</p>}
      {error && <p className="text-xs text-destructive mt-2" role="alert">{error}</p>}
    </div>
  );
}

/** A one-line nudge on pages where speed matters (prescription requests). */
export function PushNudge() {
  const { state, busy, error, enable } = useWebPush();
  if (state !== "off") return null;
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex flex-wrap items-center gap-3 text-sm" data-testid="prompt-push">
      <BellRing className="w-4 h-4 text-primary shrink-0" />
      <span className="flex-1 min-w-0">
        Turn on pop-up notifications so you see new requests even while working in another window.
        {error && <span className="block text-xs text-destructive mt-1" role="alert">{error}</span>}
      </span>
      <Button size="sm" disabled={busy} onClick={() => void enable()} data-testid="button-enable-push">Turn on</Button>
    </div>
  );
}
