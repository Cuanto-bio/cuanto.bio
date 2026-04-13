import { json } from '@sveltejs/kit';
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

  const resp = await fetch(`https://api.inaturalist.org/v2/taxa?${params}`, {
    headers: { 'User-Agent': 'cuanto.bio/0.1 (prototype)' },
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
