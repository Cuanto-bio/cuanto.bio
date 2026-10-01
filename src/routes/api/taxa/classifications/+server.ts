import { json } from '@sveltejs/kit';
import { CLASSIFICATIONS_MAX_IDS } from '$lib/inat';
import logger from '$lib/logger';
import { fetchInatClassifications } from '$lib/server/inat-taxa';
import type { RequestHandler } from './$types';

const log = logger.child({ component: 'api-taxa-classifications' });

// Darwin Core classifications for iNat taxa, keyed by taxon id. The protocol
// edit form uses this to backfill classification on existing targets (issue
// https://tangled.org/cuanto.bio/cuanto.bio/issues/81). Ids iNat doesn't know
// are left out of the results. Signed in only: one request here becomes
// several iNat requests from this server, and only protocol authors need it.
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });
  const idsParam = url.searchParams.get('ids') ?? '';
  if (!/^\d+(,\d+)*$/.test(idsParam)) {
    return json(
      { error: 'ids must be a comma-separated list of iNat taxon ids' },
      { status: 422 },
    );
  }
  const ids = idsParam.split(',').map(Number);
  if (ids.length > CLASSIFICATIONS_MAX_IDS) {
    return json(
      { error: `ids may list at most ${CLASSIFICATIONS_MAX_IDS} taxa` },
      { status: 422 },
    );
  }

  try {
    const classifications = await fetchInatClassifications(ids);
    return json({ results: Object.fromEntries(classifications) });
  } catch (err) {
    log.warn({ err }, 'Failed to fetch classifications from iNat');
    return json({ error: 'iNat API error' }, { status: 502 });
  }
};
