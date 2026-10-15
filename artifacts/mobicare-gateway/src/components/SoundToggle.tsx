import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useSoundEnabled } from "@/lib/notificationSound";

/** Switch the new-notification chime on or off on this device. */
export function SoundToggle({ size = "sm", className }: { size?: "sm" | "default"; className?: string }) {
  const [on, setOn] = useSoundEnabled();
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={className}
      onClick={() => setOn(!on)}
      aria-pressed={on}
      title={on ? "A sound plays when a notification arrives. Tap to mute." : "Notification sound is off. Tap to turn it on."}
      data-testid="button-notification-sound"
    >
      {on ? <Volume2 className="w-4 h-4 mr-2" /> : <VolumeX className="w-4 h-4 mr-2" />}
      {on ? "Sound on" : "Sound off"}
    </Button>
  );
}

/** The same setting as a labelled switch, for settings pages such as Profile. */
export function SoundSetting({ className }: { className?: string }) {
  const [on, setOn] = useSoundEnabled();
  return (
    <div className={`flex items-center justify-between gap-4 ${className ?? ""}`}>
      <label htmlFor="notification-sound" className="min-w-0 cursor-pointer">
        <span className="font-medium text-sm flex items-center gap-2">
          {on ? <Volume2 className="w-4 h-4 text-primary" /> : <VolumeX className="w-4 h-4 text-muted-foreground" />}
          Notification sound
        </span>
        <span className="block text-xs text-muted-foreground mt-0.5">
          A short chime when a new notification arrives on this device.
        </span>
      </label>
      <Switch id="notification-sound" checked={on} onCheckedChange={setOn} data-testid="switch-notification-sound" />
    </div>
  );
}
