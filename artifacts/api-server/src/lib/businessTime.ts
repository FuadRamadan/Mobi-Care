/** Dates are counted in Freetown time, never the server's clock. */
export const BUSINESS_TIMEZONE = "Africa/Freetown";
export const COMPLETED_ORDER_STATUSES = ["delivered", "collected"] as const;

/** Today's date (YYYY-MM-DD) in the business timezone. */
export function businessDateNow(timezone = BUSINESS_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(new Date())
    .reduce((result, part) => {
      if (part.type === "year") result.year = part.value;
      if (part.type === "month") result.month = part.value;
      if (part.type === "day") result.day = part.value;
      return result;
    }, {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
