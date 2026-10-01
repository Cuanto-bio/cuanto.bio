import {
  CLASSIFICATION_RANKS,
  type Classification,
  type ClassificationRank,
} from '$lib/targets.svelte';

// iNat v1 caps per_page at 500 for observations/species_counts. Shared so the
// import-preview UI can't silently drift from the server's actual page size.
export const INAT_SPECIES_PAGE_CAP = 500;

// The most iNat taxon ids /api/taxa/classifications accepts per request. Shared
// so the protocol form's backfill can't drift from what the endpoint allows.
export const CLASSIFICATIONS_MAX_IDS = 500;

/**
 * Maps an iNat taxon's ancestors (highest first) to Darwin Core rank fields and
 * a dwc:higherClassification of every ancestor's name. iNat's root, "Life"
 * (rank stateofmatter), is left out of the lineage. Names are stored as iNat
 * gives them.
 */
export function classificationFromAncestors(
  ancestors: { rank: string; name: string }[] | undefined,
): Classification {
  const classification: Classification = {};
  const lineage: string[] = [];
  for (const { rank, name } of ancestors ?? []) {
    if (rank === 'stateofmatter') continue;
    lineage.push(name);
    if ((CLASSIFICATION_RANKS as readonly string[]).includes(rank)) {
      classification[rank as ClassificationRank] = name;
    }
  }
  if (lineage.length > 0) {
    classification.higherClassification = lineage.join(' | ');
  }
  return classification;
}
