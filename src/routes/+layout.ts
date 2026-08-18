import { browser } from '$app/environment';
import { fillUserFromCache } from '$lib/auth/fillUserFromCache';
import type { LayoutLoad } from './$types';

// No root server layout exists, so this load only runs client-side.
export const load: LayoutLoad = async ({ url }) => {
  const signedOut = {
    did: undefined,
    handle: null as string | null,
    avatarUrl: null as string | null,
  };
  if (!browser) return signedOut;

  // /app resolves the user itself in app/+layout.ts, which is authoritative
  // there — it asks /api/me and clears the cache on a 401 — so a fallback here
  // would only add a staler answer that its data overrides anyway.
  //
  // Reading url.pathname also makes SvelteKit re-run this load on every
  // client-side navigation. That matters as much as the branch: without a
  // tracked dependency it runs once per hard page load, so a session that
  // started online would still be answering "signed out" here when a later
  // navigation fails offline — and this layout's data is all the error boundary
  // has left to render the sidebar and nav from.
  // https://tangled.org/cuanto.bio/cuanto.bio/issues/54
  if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
    return signedOut;
  }

  return fillUserFromCache(signedOut);
};
