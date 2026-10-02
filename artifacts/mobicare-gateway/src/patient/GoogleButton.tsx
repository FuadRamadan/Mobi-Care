import { useEffect, useRef, useState } from 'react';
import { useGetGoogleSignInConfig } from '@workspace/api-client-react';

/**
 * Google's own "Sign in with Google" button (Google Identity Services).
 *
 * Google draws the button and runs the account picker; when the patient picks
 * an account, Google gives this page a signed ID token, which is passed to
 * `onCredential` and checked by the MobiCare server. MobiCare never sees the
 * patient's Google password.
 *
 * Renders nothing until HQ has set up a Google Client ID, so the patient app
 * works exactly as before without it.
 */

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';

interface GoogleAccountsId {
  initialize(options: { client_id: string; callback: (response: { credential: string }) => void; ux_mode?: 'popup'; context?: string }): void;
  renderButton(element: HTMLElement, options: Record<string, unknown>): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

let scriptLoading: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error('Google sign-in could not be loaded'));
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

export function GoogleButton({
  onCredential,
  text = 'continue_with',
}: {
  onCredential: (credential: string) => void;
  /** Google's wording on the button. */
  text?: 'continue_with' | 'signin_with' | 'signup_with';
}) {
  const { data: config } = useGetGoogleSignInConfig();
  const clientId = config?.clientId ?? null;
  const container = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        const element = container.current;
        if (cancelled || !element || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          callback: (response) => callback.current(response.credential),
        });
        window.google.accounts.id.renderButton(element, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text,
          logo_alignment: 'center',
          width: Math.min(element.clientWidth || 320, 400),
        });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [clientId, text]);

  if (!clientId) return null;
  if (failed) {
    return (
      <p className="text-xs text-muted-foreground text-center">
        Google sign-in could not load. Check your connection, or use your phone number and password.
      </p>
    );
  }
  return <div ref={container} className="flex justify-center min-h-[44px]" data-testid="button-google" />;
}

/** "or" between Google and the phone form, shown only when the button is. */
export function GoogleDivider() {
  const { data: config } = useGetGoogleSignInConfig();
  if (!config?.clientId) return null;
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
