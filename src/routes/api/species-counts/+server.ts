import { json } from '@sveltejs/kit';
import { INAT_SPECIES_PAGE_CAP } from '$lib/inat';
import type { RequestHandler } from './$types';

// A taxon observed within a place (optionally under a parent taxon), returned by
// iNaturalist's observations/species_counts endpoint.
type InatSpeciesCount = {
  taxon: {
    id: number;
    name: string;
    rank: string;
    preferred_common_name?: string;
  };
};

// Populates a protocol's targets from the species actually observed at an iNat
// place, optionally narrowed to a parent taxon (issue #9). The result shape
// matches GET /api/taxa so the client can add each taxon with the same code
// path. `kingdom` is not populated here: species_counts does not reliably carry
// ancestor names, and kingdom is optional on a taxon target.
//
// `count=true` previews how many species match without fetching them: it asks
// iNat for per_page=0, which still returns `total_results` but no rows, so the
// UI can show a count before the (potentially large) import request.
export const GET: RequestHandler = async ({ url }) => {
  const placeId = url.searchParams.get('place_id');
  const taxonId = url.searchParams.get('taxon_id');
  const countOnly = url.searchParams.get('count') === 'true';

  // place_id is required and must be a positive integer iNat place id.
  if (!placeId || !/^\d+$/.test(placeId)) {
    return json({ error: 'place_id is required' }, { status: 422 });
  }
  if (taxonId && !/^\d+$/.test(taxonId)) {
    return json({ error: 'taxon_id must be an integer' }, { status: 422 });
  }

  const params = new URLSearchParams({
    place_id: placeId,
    quality_grade: 'research',
    // A protocol can legitimately want many targets, so request the max in
    // one page (pagination beyond the cap is intentionally out of scope for
    // now; the vast majority of place/taxon combinations return fewer) —
    // unless this is just a count preview, which needs no rows at all.
    per_page: countOnly ? '0' : String(INAT_SPECIES_PAGE_CAP),
  });
  if (taxonId) params.set('taxon_id', taxonId);

  const resp = await fetch(
    `https://api.inaturalist.org/v1/observations/species_counts?${params}`,
    { headers: { 'User-Agent': 'cuanto.bio/0.1 (prototype)' } },
  );

  if (!resp.ok) {
    return json({ error: 'iNat API error' }, { status: 502 });
  }

  if (countOnly) {
    const data = (await resp.json()) as { total_results: number };
    return json({ total: data.total_results });
  }

  const data = (await resp.json()) as { results: InatSpeciesCount[] };

  const results = data.results
    .filter((r) => r.taxon)
    .map((r) => ({
      inatId: r.taxon.id,
      scientificName: r.taxon.name,
      taxonRank: r.taxon.rank,
      commonName: r.taxon.preferred_common_name ?? null,
      kingdom: null,
      taxonID: `https://www.inaturalist.org/taxa/${r.taxon.id}`,
    }));

  return json({ results });
};
