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
