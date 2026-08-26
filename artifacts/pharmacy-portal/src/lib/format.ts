import { format } from "date-fns";

export function formatLeones(amount: number): string {
  return `SLL ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function formatDate(dateStr: string): string {
  return format(new Date(dateStr), "MMM d, yyyy");
}

export function formatTime(dateStr: string): string {
  return format(new Date(dateStr), "h:mm a");
}

export function formatDateTime(dateStr: string): string {
  return format(new Date(dateStr), "MMM d, yyyy h:mm a");
}
