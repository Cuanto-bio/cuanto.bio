/**
 * The native app's bearer token.
 *
 * Persisted in `localStorage`, which in the app-bound WKWebView is origin-scoped
 * to cuanto.bio, survives a webview reload and app relaunch (proven in the
 * Stage A spike), and is reachable only by our own origin's JS — not by other
 * apps and not backed up in plaintext the way `@capacitor/preferences`
 * (UserDefaults) would be. Its security posture is roughly that of the `did`
 * cookie minus httpOnly: an XSS on our own trusted site could read it, which is
 * the accepted trade for not shipping a native Keychain plugin.
 *
 * Kept synchronous on purpose: the fetch wrapper in hooks.client reads it on
 * every request, so an async store would either block fetch or race the token
 * in behind the first `/api/me`.
 */
const KEY = 'cuanto:native-token';

function storage(): Storage | null {
  // Guard SSR / any context without localStorage; the token only exists in the
  // native client anyway.
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function setToken(value: string | null): void {
  const s = storage();
  if (!s) return;
  if (value === null) s.removeItem(KEY);
  else s.setItem(KEY, value);
}

export function getToken(): string | null {
  return storage()?.getItem(KEY) ?? null;
}

export function clearToken(): void {
  storage()?.removeItem(KEY);
}
