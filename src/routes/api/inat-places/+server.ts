import { json } from '@sveltejs/kit';
import type { InatPlace } from '$lib/places';
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

  const resp = await fetch(
    `https://api.inaturalist.org/v1/places/autocomplete?${params}`,
    { headers: { 'User-Agent': 'cuanto.bio/0.1 (prototype)' } },
  );

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
