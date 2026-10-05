import { json } from '@sveltejs/kit';
import { inatFetch } from '$lib/server/inat';
import type { RequestHandler } from './$types';

type InatTaxon = {
  id: number;
  name: string;
  rank: string;
  preferred_common_name?: string;
  ancestors?: { rank: string; name: string }[];
};

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q');
  if (!q || q.trim().length < 2) {
    return json({ results: [] });
  }

  const params = new URLSearchParams({
    q,
    per_page: '10',
    is_active: 'true',
    fields: 'id,name,rank,preferred_common_name,ancestors.rank,ancestors.name',
  });

  // Autocomplete fails fast on a 429 rather than back off mid-keystroke. A
  // caller that isn't keystroke-driven (matching a pasted list of names) asks
  // for retries with retry=true.
  const resp = await inatFetch(`/v2/taxa?${params}`, {
    retry: url.searchParams.get('retry') === 'true',
  });

  if (!resp.ok) {
    return json({ error: 'iNat API error' }, { status: 502 });
  }

  const data = (await resp.json()) as { results: InatTaxon[] };

  const results = data.results.map((t) => ({
    inatId: t.id,
    scientificName: t.name,
    taxonRank: t.rank,
    commonName: t.preferred_common_name ?? null,
    kingdom: t.ancestors?.find((a) => a.rank === 'kingdom')?.name ?? null,
    taxonID: `https://www.inaturalist.org/taxa/${t.id}`,
  }));

  return json({ results });
};
