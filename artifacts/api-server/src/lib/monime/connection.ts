import { createMonimeClient, type MonimeClient } from "./client.js";
import { monimeConfig, type MonimeConfig } from "./config.js";

let clientOverride: MonimeClient | null = null;
let client: MonimeClient | null = null;

/** The Monime settings and client, or null when Monime payments are off. */
export function monime(): { config: MonimeConfig; client: MonimeClient } | null {
  const config = monimeConfig();
  if (!config) return null;
  client ??= clientOverride ?? createMonimeClient(config);
  return { config, client };
}

/** Tests only. */
export function setMonimeClientForTests(next: MonimeClient | null): void {
  clientOverride = next;
  client = next;
}
