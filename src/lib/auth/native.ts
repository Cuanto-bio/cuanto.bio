import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { setToken } from '$lib/auth/token';

/**
 * The native side of the sign-in handoff. Server side lives in
 * `src/lib/server/native-auth.ts`, which explains the PKCE reasoning.
 *
 *  1. Generate a verifier, keep it here, open the server's sign-in page in the
 *     *system* browser with S256(verifier) as the challenge. It has to be the
 *     system browser: the PDS authorization is a third-party origin, and doing
 *     it inside our own webview would both break atproto's expectations and
 *     train users to type credentials into an app-controlled view.
 *  2. atproto OAuth runs there and the server redirects to
 *     `bio.cuanto.app://auth?code=…`, which iOS routes back to us.
 *  3. Exchange the code plus the verifier for a bearer token.
 */

const CALLBACK_SCHEME = 'bio.cuanto.app';

let pendingVerifier: string | null = null;
let listenerAttached = false;
// The current sign-in handlers. The single appUrlOpen listener routes through
// this, so a remount of the sign-in page (which registers fresh closures) is
// served by the live component instead of the first mount's destroyed one.
let handlers: NativeAuthHandlers | null = null;

/** RFC 7636 verifier: 32 bytes of CSPRNG, base64url. */
function randomVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

async function exchange(code: string): Promise<void> {
  const verifier = pendingVerifier;
  // Single-use: a second callback for the same flow must not be able to replay
  // the verifier against another code.
  pendingVerifier = null;
  if (!verifier) {
    // The app was relaunched between opening the browser and the callback
    // arriving, so the verifier this code is bound to is gone. Recoverable by
    // signing in again, but the user has to be told rather than left looking at
    // a sign-in screen after a successful sign-in.
    throw new Error(
      'Sign-in could not be completed because the app restarted. Please try again.',
    );
  }

  const res = await fetch('/api/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, verifier, label: 'ios-app' }),
  });
  if (!res.ok) {
    // Include the status: 401 means the code was rejected (expired, replayed,
    // wrong verifier), anything else points at the transport or the origin.
    throw new Error(`Token exchange failed (HTTP ${res.status})`);
  }

  const { token } = (await res.json()) as { token: string };
  setToken(token);
}

export interface NativeAuthHandlers {
  onSignedIn: () => void;
  /**
   * Called when the callback arrived but sign-in did not complete.
   *
   * Required, not optional. An earlier version swallowed these, which produced
   * the worst possible symptom: the user signs in successfully in the browser,
   * returns to the app, and is still signed out with nothing on screen
   * explaining why. Every failure here happens *after* the user believes they
   * have succeeded, so silence is never the right response.
   */
  onError: (message: string) => void;
}

/**
 * Registers the callback listener. Idempotent, and safe to call before any
 * sign-in: iOS delivers the URL whenever it arrives, including on a cold launch
 * where the listener must already exist by the time the event fires.
 */
export function initNativeAuth(next: NativeAuthHandlers): void {
  // Always adopt the latest handlers, even when the listener is already
  // attached, so a remount is served by the current component.
  handlers = next;
  if (listenerAttached) return;
  listenerAttached = true;

  App.addListener('appUrlOpen', async ({ url }) => {
    if (!url.startsWith(`${CALLBACK_SCHEME}://`)) return;
    // Close the system browser as soon as we have the code, so the user is not
    // left staring at a redirect page.
    await Browser.close().catch(() => {});

    let code: string | null = null;
    try {
      code = new URL(url).searchParams.get('code');
    } catch {
      handlers?.onError(`Callback URL could not be parsed: ${url}`);
      return;
    }
    if (!code) {
      handlers?.onError(`Callback carried no code: ${url}`);
      return;
    }

    try {
      await exchange(code);
      handlers?.onSignedIn();
    } catch (err) {
      handlers?.onError(String(err));
    }
  });
}

/** Opens the system browser to begin sign-in. */
export async function startNativeSignIn(): Promise<void> {
  const verifier = randomVerifier();
  pendingVerifier = verifier;
  const challenge = await challengeFor(verifier);
  // Absolute, not relative: this opens in the *system* browser, which has no
  // origin context. location.origin is the site the wrapper is loaded from, so
  // it is correct at runtime with no build-time config — the whole point of
  // being genuinely same-origin now.
  const url = `${location.origin}/auth/signin?client=native&challenge=${encodeURIComponent(challenge)}`;
  await Browser.open({ url });
}
