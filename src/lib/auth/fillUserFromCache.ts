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
 * The other case is being offline, on any platform. Cookie-authoritative only
 * means anything while there is a server to answer: offline the server load
 * never runs, so the cache is the only witness there is. It is kept honest —
 * /app/+layout.ts clears it on a 401 and signOut() clears it outright — so the
 * rule it must not break still holds: a stale cached user never resurrects a
 * signed-in sidebar after the server has said signed-out.
 * https://tangled.org/cuanto.bio/cuanto.bio/issues/54
 *
 * Generic over the server load's shape so page loads that return more than the
 * user (e.g. /lexicons returns diagram data alongside it) keep their extra
 * fields — only the user keys are overwritten.
 */
export async function fillUserFromCache<T extends LayoutUser>(
  data: T,
): Promise<T> {
  if (data.did || !browser) return data;
  if (!isNative() && navigator.onLine) return data;
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
