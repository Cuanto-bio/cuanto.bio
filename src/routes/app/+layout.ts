export const ssr = false;

import { redirect } from '@sveltejs/kit';
import { clearIdbUser, getIdbUser, saveIdbUser } from '$lib/offline/db';
import { syncOfflineData } from '$lib/offline/sync';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ fetch }) => {
  // All of /app is a signed in experience, so we check auth status
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
      };
      await saveIdbUser(user);
      syncOfflineData(fetch); // intentionally not awaited
      return user;
    }
    if (res.status === 401 && navigator.onLine) {
      // Server does *not* think we're signed in, clear local auth data
      await clearIdbUser();
      redirect(302, '/auth/signin');
    }
  } catch {
    // offline — fall through to IDB
  }
  // Probably offline, check local auth data
  const user = await getIdbUser();
  if (!user) redirect(302, '/auth/signin');
  return user;
};
