/**
 * "Good morning / afternoon / evening" by the time in Freetown, whatever the
 * phone's own time zone (the same rule as the web app's header).
 */
export function freetownGreeting(at: Date): string {
  let hour: number;
  try {
    hour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Freetown", hour: "2-digit", hourCycle: "h23" }).format(at),
    );
  } catch {
    // Sierra Leone keeps GMT all year, so UTC is right if Intl lacks time zones.
    hour = at.getUTCHours();
  }
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "Aminata Kamara" → "Aminata"; a blank name still greets. */
export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "there";
}
