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

export const load: LayoutLoad = async ({ fetch, url }) => {
  // The native sign-in route lives under /app (the bundle contains nothing
  // else), so it has to be exempt from the guard that would otherwise redirect
  // it to itself forever.
  if (isSignInPath(url.pathname)) {
    return { did: undefined, handle: null as unknown as string };
  }

  const isPublic = url.pathname === APP_ROOT_PATH;

  // The rest of /app is a signed in experience, so we check auth status
  try {
    const abortCtrl = new AbortController();
    const timer = setTimeout(() => abortCtrl.abort(), 3000);
    const res = await fetch('/api/me', { signal: abortCtrl.signal });
    clearTimeout(timer);
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
      redirect(302, signInPath());
    }
  } catch {
    // offline — fall through to IDB
  }
  // Probably offline, check local auth data
  const user = await getIdbUser();
  if (!user) {
    if (isPublic) return { did: undefined, handle: null as unknown as string };
    redirect(302, signInPath());
  }
  return user;
};
