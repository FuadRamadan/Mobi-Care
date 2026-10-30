import * as WebBrowser from "expo-web-browser";

/**
 * Opens Monime's secure payment page and waits until the patient comes back
 * to the app. The app then asks the server whether the payment went through:
 * it never trusts the return itself (see OrderPayment).
 */
export async function openPaymentPage(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url, {
      toolbarColor: "#0B3D2E",
      controlsColor: "#FFFFFF",
      dismissButtonStyle: "done",
    });
  } catch {
    // Some phones have no in-app browser: nothing to wait for.
  }
}
