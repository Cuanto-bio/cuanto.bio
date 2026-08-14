import { signInPath } from '$lib/auth/signin';
import { clearToken } from '$lib/auth/token';
import { isNative } from '$lib/platform';

export async function signOut() {
  const { clearIdb } = await import('$lib/offline/db');
  await clearIdb();

  if (isNative()) {
    // Bearer clients have no cookie to delete, so /auth/signout (which just
    // clears the `did` cookie) does nothing for them. Revoke the token
    // server-side — hooks.client.ts's fetch wrapper attaches it automatically
    // — and drop it locally either way: a failed revoke must not leave sign
    // out doing nothing, since the local token is what /app/+layout.ts's
    // guard actually checks via /api/me on the next launch.
    await fetch('/api/auth/signout', { method: 'POST' }).catch(() => {});
    clearToken();
    window.location.href = signInPath();
    return;
  }

  window.location.href = '/auth/signout';
}
