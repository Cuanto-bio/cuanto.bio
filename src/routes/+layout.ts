import { browser } from '$app/environment';
import { getIdbUser } from '$lib/offline/db';
import type { LayoutLoad } from './$types';

// No root server layout exists, so this load only runs client-side.
// When offline, fall back to the IDB user record so the sidebar can
// display the handle without a network round trip.
export const load: LayoutLoad = async () => {
  if (browser && !navigator.onLine) {
    try {
      const user = await getIdbUser();
      if (user) return { did: user.did, handle: user.handle };
    } catch {
      // IDB unavailable — fall through
    }
  }
  return { did: undefined, handle: null as string | null };
};
