import { json } from '@sveltejs/kit';
import {
  getProtocolsPage,
  searchProtocols,
} from '$lib/server/db/survey-protocols';
import type { RequestHandler } from './$types';

// Two modes on one collection endpoint:
//
// - `?q=…` searches titles and returns the thin {results} shape
//   (atUri/handle/title) that ProtocolAutocomplete wants. Deliberately does not
//   include targets, which would be a lot of payload for a typeahead.
// - no `q` lists the collection as a bare Protocol[] (targets included),
//   matching /api/protocols/following. This exists so /app/protocols can load
//   client-side instead of through a +page.server.ts, which adapter-static
//   cannot build.
//
// The shapes differ because the consumers genuinely want different things; the
// response is an array for the list and an object for search, so callers can
// never confuse the two.
export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (!q) return json(await getProtocolsPage());
  const results = await searchProtocols(q, 10);
  return json({ results });
};
