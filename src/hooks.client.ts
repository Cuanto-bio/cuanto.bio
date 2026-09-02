import type { ClientInit } from '@sveltejs/kit';
import { clearDeadCredential } from '$lib/auth/clearDeadCredential';
import { getToken } from '$lib/auth/token';
import { installVibrateBridge } from '$lib/haptics';
import { isNative } from '$lib/platform';

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
}

function isSameOrigin(input: RequestInfo | URL): boolean {
  try {
    const u = new URL(requestUrl(input), location.href);
    return u.protocol === location.protocol && u.host === location.host;
  } catch {
    return false;
  }
}

/**
 * Returns `init` with the native bearer token attached, or unchanged when there
 * is no token or the request is cross-origin.
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
 */
function withBearerToken(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  sameOrigin: boolean,
): RequestInit | undefined {
  const token = getToken();
  if (!token) return init;
  if (!sameOrigin) return init;

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
  return { ...init, headers };
}

// The server flags a dead PDS/OAuth session on a write with one of these shapes
// (src/lib/server/pds.ts and the follow endpoint). Left alone, the local
// credential still satisfies our own layer, so the app keeps looking signed in
// while every write silently fails — see clearDeadCredential and
// https://tangled.org/cuanto.bio/cuanto.bio/issues/65
function isDeadSessionBody(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    b.error === 'pds_session_expired' ||
    b.sessionExpired === true ||
    b.permissionRequired === true
  );
}

async function clearCredentialIfSessionDead(response: Response): Promise<void> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // Not JSON — none of our structured auth errors look like this.
    return;
  }
  // Fire-and-forget: the caller's own response must not wait on the
  // /auth/signout round-trip clearDeadCredential does on the web.
  if (isDeadSessionBody(body)) void clearDeadCredential();
}

/**
 * The native wrapper loads cuanto.bio live, so it is genuinely same-origin —
 * no URL rewriting, no CORS. But App-Bound Domains blocks the in-webview OAuth
 * redirect, so sign-in happens in the system browser and the webview never
 * receives the `did` cookie. It authenticates with the bearer token instead,
 * attached here (withBearerToken) to our own same-origin requests.
 *
 * A full page navigation still carries no header — there is no fetch to hook —
 * but SvelteKit's router turns in-app link clicks into `load`/form fetches.
 *
 * On every build, native or web, the wrapper also inspects same-origin
 * responses for a dead-session signal and clears the local credential when it
 * sees one, so a revoked grant can't leave the app stuck looking signed in.
 */
export const init: ClientInit = () => {
  const native = isNative();

  if (native) {
    // Make navigator.vibrate() fire real haptics on iOS (no-op API in WKWebView).
    installVibrateBridge();
  }

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const sameOrigin = isSameOrigin(input);
    const effectiveInit = native
      ? withBearerToken(input, init, sameOrigin)
      : init;
    const response = await originalFetch(input, effectiveInit);
    // Only our own API returns the structured session-dead markers; a
    // cross-origin 401/403 must never touch our credential. Read the check off
    // a clone so the caller still gets an untouched body.
    if (sameOrigin && (response.status === 401 || response.status === 403)) {
      await clearCredentialIfSessionDead(response.clone());
    }
    return response;
  };
};
