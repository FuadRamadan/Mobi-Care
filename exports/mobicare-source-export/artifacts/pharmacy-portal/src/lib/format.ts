import { format } from "date-fns";

export function formatLeones(amount: number): string {
  return `SLL ${Math.round(amount).toLocaleString("en-US")}`;
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
