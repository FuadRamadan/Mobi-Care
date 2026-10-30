/** The web test build has no Google account picker; the real one is on phones (googleAuth.ts). */
export class GoogleCancelled extends Error {}

export async function googleIdToken(_webClientId: string): Promise<string> {
  throw new Error("Google sign-in works in the phone app. In this test build, use your phone number and password.");
}
