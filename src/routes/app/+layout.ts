export const ssr = false;

import { redirect } from '@sveltejs/kit';
import { isSignInPath, signInPath } from '$lib/auth/signin';
import { clearIdbUser, getIdbUser, saveIdbUser } from '$lib/offline/db';
import { syncOfflineData } from '$lib/offline/sync';
import type { LayoutLoad } from './$types';

// /app is the wrapper's launch target (server.url in capacitor.config.ts) and
// the only route the service worker caches for offline launch
// (service-worker.ts cacheAssets() / the fetch handler's /app/* branch — `/`
// gets neither). Bouncing a signed-out visitor off it entirely would break
// that offline-launch guarantee, so unlike the rest of /app/*, the root stays
// public: +page.svelte renders the same content as `/` when `did` is unset
// instead of forcing a redirect to sign-in.
const APP_ROOT_PATH = '/app';

/**
 * Some /app/* pages have a public equivalent one path segment away — a
 * signed-out visitor landing on one of those should see that instead of a
 * forced sign-in wall. Returns the public path, or undefined if this one
 * has no such equivalent (e.g. /app/protocols/following,
 * /app/surveys/[handle]/[rkey]/edit).
 * https://tangled.org/cuanto.bio/cuanto.bio/issues/61
 * https://tangled.org/cuanto.bio/cuanto.bio/issues/63
 */
function publicEquivalentPath(pathname: string): string | undefined {
  const match = pathname.match(
    /^\/app\/(protocols|surveys)\/([^/]+)\/([^/]+)$/,
  );
  return match ? `/${match[1]}/${match[2]}/${match[3]}` : undefined;
}

// A first attempt gets this long before we give up on it — long enough to
// absorb ordinary latency without ever leaving the user waiting too long to
// find out they're signed out.
const FIRST_ATTEMPT_TIMEOUT_MS = 3000;
// A retry, once we already know the first attempt merely timed out rather
// than failing outright, gets more room — enough to ride out a cold
// server/DB after a quiet period (see
// https://tangled.org/cuanto.bio/cuanto.bio/issues/59) — before we treat it
// like a real connectivity failure.
const RETRY_TIMEOUT_MS = 12000;

/** Fetches /api/me, aborting (with an AbortError) if it takes longer than timeoutMs. */
function fetchMe(fetchFn: typeof fetch, timeoutMs: number): Promise<Response> {
  const abortCtrl = new AbortController();
  const timer = setTimeout(() => abortCtrl.abort(), timeoutMs);
  return fetchFn('/api/me', { signal: abortCtrl.signal }).finally(() =>
    clearTimeout(timer),
  );
}

export const load: LayoutLoad = async ({ fetch, url }) => {
  // The native sign-in route lives under /app (the bundle contains nothing
  // else), so it has to be exempt from the guard that would otherwise redirect
  // it to itself forever.
  if (isSignInPath(url.pathname)) {
    return { did: undefined, handle: null as unknown as string };
  }

  const isPublic = url.pathname === APP_ROOT_PATH;
  const publicPath = publicEquivalentPath(url.pathname);
  const signInRedirectTarget = publicPath
    ? `${publicPath}${url.search}`
    : signInPath();

  // The rest of /app is a signed in experience, so we check auth status
  try {
    let res: Response;
    try {
      res = await fetchMe(fetch, FIRST_ATTEMPT_TIMEOUT_MS);
    } catch (err) {
      // A timeout here only means the first attempt was slow, not that we're
      // offline or signed out — give it more room before assuming the worst.
      // Anything else (a real network error) falls through to the outer
      // catch's offline handling below, same as before.
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        throw err;
      res = await fetchMe(fetch, RETRY_TIMEOUT_MS);
    }
    if (res.ok) {
      // Server says we're signed in, make sure our local auth state is
      // up-to-date and sync data
      const user = (await res.json()) as {
        did: string;
        handle: string;
        avatarUrl?: string;
        needsLexiconMigration?: boolean;
      };
      // Don't persist the migration flag to IDB; it's a live server signal.
      await saveIdbUser({
        did: user.did,
        handle: user.handle,
        avatarUrl: user.avatarUrl,
      });
      syncOfflineData(fetch); // intentionally not awaited
      return user;
    }
    if (res.status === 401) {
      // Server does *not* think we're signed in, clear local auth data
      await clearIdbUser();
      if (isPublic)
        return { did: undefined, handle: null as unknown as string };
      redirect(302, signInRedirectTarget);
    }
  } catch {
    // offline — fall through to IDB
  }
  // Probably offline, check local auth data
  const user = await getIdbUser();
  if (!user) {
    if (isPublic) return { did: undefined, handle: null as unknown as string };
    redirect(302, signInRedirectTarget);
  }
  return user;
};
