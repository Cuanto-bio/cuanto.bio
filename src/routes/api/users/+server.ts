import { json } from '@sveltejs/kit';
import { searchUsers } from '$lib/server/db/users';
import type { RequestHandler } from './$types';

// `?q=…` searches handles and returns the thin {results} shape (did/handle)
// that UserAutocomplete wants. No `q` returns no results rather than listing
// every user, since there's no use case yet for browsing the full collection.
export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (!q) return json({ results: [] });
  const results = await searchUsers(q, 10);
  return json({ results });
};
