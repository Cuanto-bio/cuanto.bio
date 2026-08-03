import { browser } from '$app/environment';
import { getIdbUser } from '$lib/offline/db';
import { isNative } from '$lib/platform';

export type LayoutUser = {
  did: string | undefined;
  handle: string | null;
  avatarUrl: string | null;
};

/**
 * Resolve the signed-in user for a server-rendered page whose server load reads
 * it from the `did` cookie, so the sidebar and page content reflect the real
 * session.
 *
 * On the web the cookie is visible to that server load, so `data` already
 * carries the user and this returns it untouched — SSR paints the signed-in
 * state with no flash. The native wrapper has no cookie (it authenticates with a
 * bearer token the server never sees on a document or __data.json load), so
 * `data` arrives signed-out; on the native client we fill it in from the user
 * that /app cached to IndexedDB on sign-in.
 *
 * The fill is gated to the native client on purpose. The web stays
 * cookie-authoritative: a stale cached user must never resurrect a signed-in
 * sidebar after the server already said signed-out.
 *
 * Generic over the server load's shape so page loads that return more than the
 * user (e.g. /lexicons returns diagram data alongside it) keep their extra
 * fields — only the user keys are overwritten.
 */
export async function fillUserFromCache<T extends LayoutUser>(
  data: T,
): Promise<T> {
  if (data.did || !browser || !isNative()) return data;
  try {
    const user = await getIdbUser();
    if (user) {
      // The spread preserves any non-user fields; we only overwrite the
      // LayoutUser keys with compatible types, so the cast past TS's
      // generic-spread limitation is sound.
      return {
        ...data,
        did: user.did,
        handle: user.handle,
        avatarUrl: user.avatarUrl ?? null,
      } as T;
    }
  } catch {
    // IndexedDB unavailable — leave the signed-out data as-is.
  }
  return data;
}
