import { json } from '@sveltejs/kit';
import type { InatPlace } from '$lib/places';
import { inatFetch } from '$lib/server/inat';
import type { RequestHandler } from './$types';

// The raw place shape from iNaturalist's places/autocomplete endpoint, before
// normalizing to InatPlace.
type InatAutocompleteResult = {
  id: number;
  name: string;
  display_name?: string;
};

// Autocomplete iNaturalist places so a protocol author can pick the place whose
// observed species should seed the protocol's targets.
export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q');
  if (!q || q.trim().length < 2) {
    return json({ results: [] });
  }

  const params = new URLSearchParams({
    q: q.trim(),
    per_page: '10',
  });

  // Autocomplete: fail fast on a 429 rather than back off mid-keystroke
  const resp = await inatFetch(`/v1/places/autocomplete?${params}`, {
    retry: false,
  });

  if (!resp.ok) {
    return json({ error: 'iNat API error' }, { status: 502 });
  }

  const data = (await resp.json()) as { results: InatAutocompleteResult[] };

  const results: InatPlace[] = data.results.map((p) => ({
    id: p.id,
    name: p.name,
    displayName: p.display_name ?? p.name,
  }));

  return json({ results });
};
