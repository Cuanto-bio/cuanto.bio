import { CLASSIFICATIONS_MAX_IDS } from '$lib/inat';
import type { Classification } from '$lib/targets.svelte';

/**
 * Fetches Darwin Core classifications for iNat taxon ids from
 * /api/taxa/classifications, CLASSIFICATIONS_MAX_IDS at a time. If a request
 * fails, stops there but still returns what the earlier requests found, with
 * `error` saying why: 'signedOut' when the author's session has lapsed (so they
 * can be told to sign in again, not that iNat failed), else 'failed'.
 */
export async function fetchClassifications(ids: number[]): Promise<{
  classifications: Map<number, Classification>;
  error: 'signedOut' | 'failed' | null;
}> {
  const classifications = new Map<number, Classification>();
  for (let i = 0; i < ids.length; i += CLASSIFICATIONS_MAX_IDS) {
    const chunk = ids.slice(i, i + CLASSIFICATIONS_MAX_IDS);
    try {
      const resp = await fetch(
        `/api/taxa/classifications?ids=${chunk.join(',')}`,
      );
      if (resp.status === 401) return { classifications, error: 'signedOut' };
      if (!resp.ok) return { classifications, error: 'failed' };
      const data = (await resp.json()) as {
        results: Record<string, Classification>;
      };
      for (const [id, classification] of Object.entries(data.results)) {
        classifications.set(Number(id), classification);
      }
    } catch {
      return { classifications, error: 'failed' };
    }
  }
  return { classifications, error: null };
}
