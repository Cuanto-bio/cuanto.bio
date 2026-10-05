export const ssr = false;

import { redirect } from '@sveltejs/kit';
import { invalidateAll } from '$app/navigation';
import { page } from '$app/state';
import { isSignInPath, signInPath } from '$lib/auth/signin';
import { failFastWhenUnreachable } from '$lib/composables/online.svelte';
import {
  clearIdbUser,
  getIdbUser,
  type IdbUser,
  saveIdbUser,
} from '$lib/offline/db';
import { withIdbDeadline } from '$lib/offline/idbDeadline';
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

interface MeResponse {
  did: string;
  handle: string;
  avatarUrl?: string;
  needsLexiconMigration?: boolean;
}

// The server's answer from a background check that contradicted the cached
// user, handed to the re-run of `load` that check triggers and used up by it.
// Handing the answer over, rather than letting the re-run read the cache
// again, means a cache write or clear that didn't take (IDB can wedge, see
// https://tangled.org/cuanto.bio/cuanto.bio/issues/68) can't make the re-run
// reach the same stale user and loop.
let serverAnswer: MeResponse | 'signed-out' | undefined;

/**
 * Re-runs the loads with the server's answer, but only if the page on screen
 * is still the one `loadedUrl`'s load was for. It isn't when
 * - that load was a link preload (app.html preloads on hover): redirecting
 *   the page being shown because the pointer crossed a link would throw away
 *   e.g. a survey form in progress;
 * - the user has since moved on, to sign-in or out of /app: an answer left
 *   waiting would be picked up by some later, unrelated load, e.g. bouncing
 *   them back out right after they sign in again.
 * Either way the cache has been corrected by then, which is all the next
 * load of that page needs.
 */
function rerunLoadsWith(answer: MeResponse | 'signed-out', loadedUrl: URL) {
  if (
    page.url.pathname !== loadedUrl.pathname ||
    page.url.search !== loadedUrl.search
  ) {
    return;
  }
  serverAnswer = answer;
  void invalidateAll();
}

/**
 * Checks /api/me without holding up the navigation, for when the guard has
 * already answered from the cached user: refreshes that cached user for the
 * next navigation, syncs, and clears the cache if the session was revoked.
 * Resolves (never rejects) to the server's needsLexiconMigration, or undefined
 * if the server didn't say.
 */
async function checkMeInBackground(
  fetchFn: typeof fetch,
  cached: IdbUser,
  loadedUrl: URL,
): Promise<boolean | undefined> {
  try {
    // failFastWhenUnreachable: once the ping has found the server
    // unreachable there's no point holding a request open for the full
    // timeout, and any answer marks the server reachable again.
    const res = await fetchMe(
      failFastWhenUnreachable(fetchFn),
      RETRY_TIMEOUT_MS,
    );
    if (res.ok) {
      const user = (await res.json()) as MeResponse;
      // This runs on every /app navigation, so an unconditional write here
      // is one IndexedDB write per navigation, almost always rewriting a
      // byte-identical record. Write only on a real change.
      // https://tangled.org/cuanto.bio/cuanto.bio/issues/70
      // Compare did, handle *and* avatarUrl: the avatar can change
      // server-side, and comparing only did would pin a stale one forever.
      // needsLexiconMigration stays out of it (and out of the write) as a
      // live server signal.
      if (
        cached.did !== user.did ||
        cached.handle !== user.handle ||
        cached.avatarUrl !== user.avatarUrl
      ) {
        try {
          await withIdbDeadline(
            saveIdbUser({
              did: user.did,
              handle: user.handle,
              avatarUrl: user.avatarUrl,
            }),
            'saveIdbUser',
          );
        } catch {
          // Refreshing the local cache is best-effort. The server's answer
          // stands either way, so a write hiccup must not skip what follows.
        }
      }
      syncOfflineData(fetchFn); // intentionally not awaited
      // A different account entirely (e.g. the session expired and someone
      // else signed in, with no sign-out in between): the page is rendering
      // as the wrong user, which gets ownership checks wrong, so this can't
      // wait for the next navigation the way a new handle or avatar can.
      if (cached.did !== user.did) rerunLoadsWith(user, loadedUrl);
      return user.needsLexiconMigration;
    }
    if (res.status === 401) {
      // Signed out server-side, but the page already rendered from the
      // cache: clear it and re-run the guard to hit the sign-in wall.
      try {
        await withIdbDeadline(clearIdbUser(), 'clearIdbUser');
      } catch {
        // Best-effort, as above: the re-run goes by the server's answer.
      }
      rerunLoadsWith('signed-out', loadedUrl);
    }
  } catch {
    // Unreachable; the page keeps the cached user.
  }
  return undefined;
}

// This tangle is to try to ensure our local copy of the signed in user record
// is always up-to-date, without slowing down navigation. Not clear if it's
// as complicated as it needs to be.
export const load: LayoutLoad = async ({ fetch, url }) => {
  // Used up by whichever load runs next, before any early return, so it can
  // never outlive the re-run it was meant for.
  const answer = serverAnswer;
  serverAnswer = undefined;

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

  // A background check just contradicted the cached user and re-ran us: go
  // with what the server said.
  if (answer === 'signed-out') {
    if (isPublic) return { did: undefined, handle: null as unknown as string };
    redirect(302, signInRedirectTarget);
  }
  if (answer) return answer;

  // With a user already cached, answer from it right away and check /api/me
  // in the background, rather than making every /app navigation wait on the
  // server. A server that's down behind a proxy hangs rather than refusing
  // the connection, so each navigation used to sit out both timeouts below
  // (~15s) only to land on this same cached user. The cost is that a changed
  // handle or avatar shows up one navigation late, and that a revoked session
  // or a different account renders briefly from the cache before the
  // background check re-runs the loads (see rerunLoadsWith).
  // https://tangled.org/cuanto.bio/cuanto.bio/issues/83
  let cached: IdbUser | undefined;
  // False when IDB is not answering at all, which is not the same as "nothing
  // cached": see the write below.
  let cacheReadable = true;
  try {
    // throwOnTimeout: a wedged read means IDB is not answering at all, so
    // treat that like any other read failure rather than as "nothing cached".
    cached = await withIdbDeadline(getIdbUser(), 'getIdbUser', {
      throwOnTimeout: true,
    });
  } catch {
    cacheReadable = false;
  }
  if (cached) {
    return {
      ...cached,
      // Streamed: a live server signal that is never cached, so it arrives
      // when the background check does.
      needsLexiconMigration: checkMeInBackground(fetch, cached, url),
    };
  }

  // Nothing cached, so there is nothing to show until the server says who the
  // signed in user is. The rest of /app is a signed in experience, so we
  // check auth status
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
      const user = (await res.json()) as MeResponse;
      // Nothing was cached (or we'd have returned above), so cache this user.
      // Unless the read above failed: firing a write at an IDB that is not
      // answering would double how long the guard blocks, on every
      // navigation while IDB is down. Per #68 a readonly transaction keeps
      // working even when writes are wedged, so the read is the safer probe.
      // https://tangled.org/cuanto.bio/cuanto.bio/issues/70
      const next: IdbUser = {
        did: user.did,
        handle: user.handle,
        avatarUrl: user.avatarUrl,
      };
      try {
        if (cacheReadable) {
          await withIdbDeadline(saveIdbUser(next), 'saveIdbUser');
        }
      } catch {
        // Refreshing the local cache is best-effort. The server's 200 already
        // proves we're signed in, so a write hiccup here must not fall
        // through to the offline branch below and bounce us to sign-in.
      }
      syncOfflineData(fetch); // intentionally not awaited
      return user;
    }
    if (res.status === 401) {
      // Server does *not* think we're signed in, clear local auth data.
      // Same deadline as the other IDB awaits here: clearIdbUser is a
      // readwrite delete and can hang the same way, and this guard runs on
      // every /app navigation.
      await withIdbDeadline(clearIdbUser(), 'clearIdbUser');
      if (isPublic)
        return { did: undefined, handle: null as unknown as string };
      redirect(302, signInRedirectTarget);
    }
  } catch {
    // offline — fall through
  }
  // Probably offline, and we already know there's no local auth data
  if (isPublic) return { did: undefined, handle: null as unknown as string };
  redirect(302, signInRedirectTarget);
};
