/**
 * Stubbed SMS sender — logs to console until a real gateway (e.g. Vonage, Africa's
 * Talking) is wired in. Drop-in replacement: implement the same signature with
 * a real HTTP call to activate live SMS.
 */
export async function sendSms(to: string, body: string): Promise<void> {
  // TODO: replace with real SMS gateway call when one is chosen.
  console.log(`[SMS stub] To: ${to} | Message: ${body}`);
}
