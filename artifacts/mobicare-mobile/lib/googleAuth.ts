/**
 * "Continue with Google" on phones: Google's own account picker on the phone
 * (Google Play services), never a password typed into MobiCare.
 *
 * Google is asked for an ID token for MobiCare's web Client ID (the one the
 * server returns from /auth/google/config), so the server checks it exactly as
 * it checks the web app's. Android also needs an "Android" OAuth client for
 * this app's package name and signing certificate in the same Google Cloud
 * project; without it Google refuses with DEVELOPER_ERROR.
 *
 * The native module exists only in a development or store build, not in Expo
 * Go, so it is loaded when first needed.
 */

export class GoogleCancelled extends Error {}

type GoogleModule = typeof import("@react-native-google-signin/google-signin");

let module: GoogleModule | null = null;
let configuredFor: string | null = null;

function load(): GoogleModule {
  if (module) return module;
  try {
    module = require("@react-native-google-signin/google-signin") as GoogleModule;
    return module;
  } catch {
    throw new Error("Google sign-in needs the full MobiCare app. Use your phone number and password here.");
  }
}

/** A fresh Google ID token for MobiCare, or GoogleCancelled if the patient backed out. */
export async function googleIdToken(webClientId: string): Promise<string> {
  const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = load();
  if (configuredFor !== webClientId) {
    GoogleSignin.configure({ webClientId });
    configuredFor = webClientId;
  }
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Always offer the account picker, rather than reusing the last account.
    await GoogleSignin.signOut().catch(() => {});
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) throw new GoogleCancelled();
    if (!response.data.idToken) throw new Error("Google did not confirm your account. Try again.");
    return response.data.idToken;
  } catch (err) {
    if (err instanceof GoogleCancelled) throw err;
    if (isErrorWithCode(err)) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) throw new GoogleCancelled();
      if (err.code === statusCodes.IN_PROGRESS) throw new GoogleCancelled();
      if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error("Google Play services is missing or out of date on this phone.");
      }
    }
    throw new Error("Google sign-in did not work. Try again, or use your phone number.");
  }
}
