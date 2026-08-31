import type { ClientInit } from '@sveltejs/kit';
import { getToken } from '$lib/auth/token';
import { installVibrateBridge } from '$lib/haptics';
import { isNative } from '$lib/platform';

/**
 * The native wrapper loads cuanto.bio live, so it is genuinely same-origin —
 * no URL rewriting, no CORS. But App-Bound Domains blocks the in-webview OAuth
 * redirect, so sign-in happens in the system browser and the webview never
 * receives the `did` cookie. It authenticates with the bearer token instead,
 * attached here to our own same-origin requests.
 *
 * Same-origin is the whole boundary: attaching the token to a cross-origin
 * request (iNaturalist, GBIF, tiles) would disclose the credential to a third
 * party, and nothing else about the destination matters. It was once narrowed
 * further, to `/api`, from back when the app was a static bundle whose only
 * traffic to us was the API. The wrapper now loads the entire site, so the
 * server-rendered routes are reachable too — SvelteKit fetches their `load`
 * data from `<path>/__data.json` and posts their forms to `<path>?/action`,
 * neither of which is under /api. Restricting the token to /api left every one
 * of those pages (the protocol editor, "New protocol") bouncing a signed-in
 * native user to sign in again.
 *
 * A full page navigation still carries no header — there is no fetch to hook —
 * but SvelteKit's router turns in-app link clicks into the fetches above.
 *
 * Web build: no-op.
 */
export const init: ClientInit = () => {
  if (!isNative()) return;

  // Make navigator.vibrate() fire real haptics on iOS (no-op API in WKWebView).
  installVibrateBridge();

  const originalFetch = globalThis.fetch;

  globalThis.fetch = (input, init) => {
    const token = getToken();
    if (!token) return originalFetch(input, init);

    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    let sameOrigin = false;
    try {
      const u = new URL(raw, location.href);
      sameOrigin = u.protocol === location.protocol && u.host === location.host;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) return originalFetch(input, init);

    // Start from any headers on a Request input, then let init's headers win
    // (that's fetch(request, init) semantics), so we neither drop the Request's
    // headers nor miss an Authorization the caller set on it.
    const headers = new Headers(
      input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      for (const [key, value] of new Headers(init.headers)) {
        headers.set(key, value);
      }
    }
    // Never clobber an Authorization a caller set deliberately.
    if (!headers.has('authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return originalFetch(input, { ...init, headers });
  };
};
