import { isNative } from '$lib/platform';

/**
 * Where an unauthenticated user gets sent.
 *
 * On the web that is the server-rendered form at `/auth/signin`. The native
 * bundle contains only `/app/*`, so redirecting there serves nothing and the
 * app shows a blank screen — the native shell needs a sign-in route that ships
 * inside the bundle and starts the system-browser flow instead.
 */
export const NATIVE_SIGNIN_PATH = '/app/signin';
export const WEB_SIGNIN_PATH = '/auth/signin';

export function signInPath(): string {
  return isNative() ? NATIVE_SIGNIN_PATH : WEB_SIGNIN_PATH;
}

/**
 * Whether a path is the sign-in route itself, so the layout's auth guard can
 * skip it rather than redirecting to it forever.
 */
export function isSignInPath(pathname: string): boolean {
  return pathname === NATIVE_SIGNIN_PATH || pathname === WEB_SIGNIN_PATH;
}

/**
 * Whether `path` is a safe same-origin destination to return to after sign-in.
 * A protocol-relative `//evil.example` or an absolute URL would let a crafted
 * link bounce the user off-site through our own sign-in flow. Same check the
 * web callback applies before honouring the `returnTo` cookie.
 */
export function isSafeReturnTo(
  path: string | null | undefined,
): path is string {
  return !!path && path.startsWith('/') && !path.startsWith('//');
}

/**
 * The href a "Sign in" link should point at, carrying where the user should
 * land afterwards.
 *
 * Native and web need different sign-in routes (see signInPath), and they read
 * `returnTo` from different places: the web form stashes the query param in a
 * cookie across the PDS round trip (src/routes/auth/signin/+page.server.ts),
 * while the native shell's /app/signin reads it straight from this query string
 * after the system-browser handoff returns. Hardcoding `/auth/signin?returnTo=`
 * instead sends a native user to a route its bundle does not contain, and the
 * in-webview OAuth redirect then escapes to the system browser — the app never
 * gets a credential. An unsafe or absent `returnTo` is dropped so the link
 * still works, just with no redirect target.
 */
export function signInHref(returnTo?: string | null): string {
  const base = signInPath();
  if (!isSafeReturnTo(returnTo)) return base;
  return `${base}?returnTo=${encodeURIComponent(returnTo)}`;
}
