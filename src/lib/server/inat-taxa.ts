import { classificationFromAncestors } from '$lib/inat';
import logger from '$lib/logger';
import {
  applyClassifications,
  type Classification,
  inatIdsNeedingClassification,
} from '$lib/targets.svelte';
import { INAT_MOCK_ANCESTORS } from './inat-mock';

const log = logger.child({ component: 'inat-taxa' });

const INAT_TAXA_URL = 'https://api.inaturalist.org/v2/taxa';

// The v2 taxa search accepts up to 500 ids per request (verified 2026-09-28).
// The path form (/v2/taxa/<ids>) returns ancestors directly but caps at 30 ids,
// and the search form ignores `ancestors` in `fields`, so classifications take
// two searches: the taxa's ancestor_ids, then those ancestors' names and ranks.
const MAX_IDS_PER_REQUEST = 500;

// How long a whole classification lookup (all of its requests) may take before
// it's abandoned. A protocol save waits on this, so it has to give up rather
// than hang if iNat stops responding.
const INAT_TIMEOUT_MS = 15_000;

async function searchTaxa<T>(
  ids: number[],
  fields: string,
  signal: AbortSignal,
  extraParams: Record<string, string> = {},
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
    const chunk = ids.slice(i, i + MAX_IDS_PER_REQUEST);
    const params = new URLSearchParams({
      id: chunk.join(','),
      per_page: String(chunk.length),
      fields,
      ...extraParams,
    });
    const resp = await fetch(`${INAT_TAXA_URL}?${params}`, {
      headers: { 'User-Agent': 'cuanto.bio/0.1 (prototype)' },
      signal,
    });
    if (!resp.ok) {
      throw new Error(`iNat taxa request failed with ${resp.status}`);
    }
    const data = (await resp.json()) as { results: T[] };
    results.push(...data.results);
  }
  return results;
}

/**
 * searchTaxa, plus a second search for any ids it didn't return. The search
 * only returns active taxa by default, but a target, or one of its ancestors,
 * can be a taxon iNat has since made inactive (e.g. a synonym). is_active
 * accepts true or false, not both.
 */
async function searchTaxaIncludingInactive<T extends { id: number }>(
  ids: number[],
  fields: string,
  signal: AbortSignal,
): Promise<T[]> {
  const results = await searchTaxa<T>(ids, fields, signal);
  const found = new Set(results.map((t) => t.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    results.push(
      ...(await searchTaxa<T>(missing, fields, signal, {
        is_active: 'false',
      })),
    );
  }
  return results;
}

/**
 * Fetches the Darwin Core classification of each iNat taxon id. Ids iNat does
 * not return are absent from the result. Throws if iNat responds with an error
 * or takes longer than INAT_TIMEOUT_MS.
 *
 * When INAT_MOCK=true, answers from INAT_MOCK_ANCESTORS without any HTTP call.
 * This exists because Playwright integration tests run the app as a live
 * server process, so the server's requests to iNat can't be intercepted from
 * the test layer (page.route only sees the browser's requests). See the same
 * note on PDS_MOCK in $lib/server/pds.
 */
export async function fetchInatClassifications(
  ids: number[],
): Promise<Map<number, Classification>> {
  const uniqueIds = [...new Set(ids)];
  if (process.env.INAT_MOCK === 'true') {
    return new Map(
      uniqueIds
        .filter((id) => INAT_MOCK_ANCESTORS[id])
        .map((id) => [
          id,
          classificationFromAncestors(INAT_MOCK_ANCESTORS[id]),
        ]),
    );
  }
  if (uniqueIds.length === 0) return new Map();

  const signal = AbortSignal.timeout(INAT_TIMEOUT_MS);
  const taxa = await searchTaxaIncludingInactive<{
    id: number;
    ancestor_ids?: number[];
  }>(uniqueIds, 'id,ancestor_ids', signal);
  const ancestorIds = [...new Set(taxa.flatMap((t) => t.ancestor_ids ?? []))];
  const ancestors = new Map(
    (
      await searchTaxaIncludingInactive<{
        id: number;
        name: string;
        rank: string;
      }>(ancestorIds, 'id,name,rank', signal)
    ).map((a) => [a.id, a]),
  );
  return new Map(
    taxa.map((t) => [
      t.id,
      classificationFromAncestors(
        // ancestor_ids ends with the taxon itself
        (t.ancestor_ids ?? [])
          .filter((id) => id !== t.id)
          .flatMap((id) => ancestors.get(id) ?? []),
      ),
    ]),
  );
}

/**
 * Adds classification to the targets that need it (see needsClassification),
 * leaving every other target as it is. Never fails: if iNat can't be reached,
 * or is too slow, logs a warning and returns the targets unchanged, so a
 * protocol save doesn't depend on iNat being up.
 */
export async function classifyTargets<T extends { scope: unknown[] }>(
  targets: T[],
): Promise<T[]> {
  const ids = inatIdsNeedingClassification(targets);
  if (ids.length === 0) return targets;

  let classifications: Map<number, Classification>;
  try {
    classifications = await fetchInatClassifications(ids);
  } catch (err) {
    log.warn({ err }, 'Failed to fetch target classifications from iNat');
    return targets;
  }
  return applyClassifications(targets, classifications);
}
