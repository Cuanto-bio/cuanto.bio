import type { Target, TaxonScope, VerbatimScope } from '$lib/offline/db';

/** Sort order for a target list. `default` preserves protocol order. */
export type TargetSort = 'default' | 'scientific' | 'common';

/**
 * The parts of a target filter worth persisting across sessions. The search
 * query is deliberately excluded: it's transient typing, not a view preference.
 */
export interface TargetFilterState {
  targetSort?: TargetSort;
  onlyCounted?: boolean;
}

/** Returns true if the scope entry is a taxon scope (vs. verbatim). */
export function isTaxonScope(s: Record<string, string> | undefined): boolean {
  return !!s?.$type?.endsWith('#taxonScope');
}

/**
 * Returns a human-readable label for a target's scope array.
 * Taxon targets render as "Common name (Scientific name)" or just the
 * scientific name when no vernacular name is available. Verbatim targets
 * render as their verbatim string.
 */
export function targetLabel(
  scope: (TaxonScope | VerbatimScope | unknown)[],
): string {
  const first = scope[0] as Record<string, string> | undefined;
  if (!first) return 'Unknown target';
  if (first.$type?.endsWith('#taxonScope')) {
    return first.vernacularName
      ? `${first.vernacularName} (${first.scientificName})`
      : (first.scientificName ?? 'Unknown');
  }
  if (first.$type?.endsWith('#verbatimScope'))
    return first.verbatimTargetScope ?? 'Unknown';
  return 'Unknown target';
}

/**
 * Splits `incoming` taxa into those to add (whose `taxonID` is not already in
 * `existingTaxonIDs`) and a count skipped as duplicates. Used to seed protocol
 * targets from an iNat place/taxon query without adding a taxon that is already
 * a target (issue #9). Duplicates within `incoming` are collapsed too, and a
 * taxon with no `taxonID` is skipped (it cannot be de-duplicated safely).
 */
export function partitionNewTaxa<T extends { taxonID?: string }>(
  existingTaxonIDs: Iterable<string>,
  incoming: T[],
): { toAdd: T[]; skipped: number } {
  const seen = new Set(existingTaxonIDs);
  const toAdd: T[] = [];
  let skipped = 0;
  for (const item of incoming) {
    if (item.taxonID && !seen.has(item.taxonID)) {
      seen.add(item.taxonID);
      toAdd.push(item);
    } else {
      skipped++;
    }
  }
  return { toAdd, skipped };
}

/** Extracts the taxon ID from a target's scope, or undefined for verbatim targets. */
export function targetTaxonID(
  scope: (TaxonScope | VerbatimScope | unknown)[],
): string | undefined {
  const first = scope[0] as Record<string, string> | undefined;
  if (first?.$type?.endsWith('#taxonScope')) return first.taxonID;
  return undefined;
}

function sortTargets(targets: Target[], sort: TargetSort): Target[] {
  if (sort === 'default') return targets;
  return [...targets].sort((a, b) => {
    // Support sorting by sci name or ver name, but with support for verbatim
    // targets too
    const af = a.record.scope[0] as Record<string, string> | undefined;
    const bf = b.record.scope[0] as Record<string, string> | undefined;
    const aVal =
      sort === 'scientific'
        ? isTaxonScope(af)
          ? (af?.scientificName ?? '')
          : (af?.verbatimTargetScope ?? '')
        : isTaxonScope(af)
          ? (af?.vernacularName ?? '')
          : (af?.verbatimTargetScope ?? '');
    const bVal =
      sort === 'scientific'
        ? isTaxonScope(bf)
          ? (bf?.scientificName ?? '')
          : (bf?.verbatimTargetScope ?? '')
        : isTaxonScope(bf)
          ? (bf?.vernacularName ?? '')
          : (bf?.verbatimTargetScope ?? '');
    if (!aVal && !bVal) return 0;
    if (!aVal) return 1;
    if (!bVal) return -1;
    return aVal.localeCompare(bVal);
  });
}

/**
 * Normalize text for search comparison
 * */
export function normalizeForSearch(text: string) {
  return (
    text
      // case insensitive
      .toLowerCase()
      // ignore trailing whitespace
      .trim()
      // fold Latin/Greek/Cyrillic accents (café -> cafe) and Arabic harakat
      // (مَرْحَبًا -> مرحبا), then recompose so untouched marks (e.g. Japanese
      // dakuten) don't get treated as stray punctuation below
      .normalize('NFD')
      .replaceAll(/[\u0300-\u036f\u064b-\u0652]/g, '')
      .normalize('NFC')
      // treat hyphenated and space-separated words the same
      .replaceAll(/-/g, ' ')
      // normalize whitespace
      .replaceAll(/\s/g, ' ')
      // match regardless of punctuation, e.g. "fishers" should match "Fisher's";
      // \p{L}\p{N}\p{M} (not \w) so other scripts and their combining marks
      // (Devanagari, Thai, etc.) survive instead of being stripped as symbols
      .replaceAll(/[^\p{L}\p{N}\p{M}\s]+/gu, '')
  );
}

/**
 * Svelte 5 composable for filtering and sorting a target list.
 *
 * `getTargets` is called reactively — pass a getter that reads from `$state`
 * so the filtered list stays in sync when the protocol loads or changes.
 *
 * `isCounted` determines whether a target counts as counted for the
 * "only counted" filter. The implementation differs between the survey form
 * (checks `organismQuantities`) and survey detail (checks `survey.occurrences`),
 * so it's injected as a predicate.
 *
 * `opts.initialOnlyCounted` sets the default state of the filter toggle —
 * pass `true` on the detail page to hide unrecorded targets by default.
 *
 * `opts.restoredState` overrides those defaults with values persisted from an
 * earlier session, e.g. a resumed survey draft (issue #31). `reset()` still
 * returns to the defaults above, not to the restored values.
 */
export function createTargetFilter(
  getTargets: () => Target[],
  isCounted: (t: Target) => boolean,
  opts?: {
    initialOnlyCounted?: boolean;
    restoredState?: TargetFilterState;
  },
) {
  const defaultOnlyCounted = opts?.initialOnlyCounted ?? false;
  let filterQuery = $state('');
  let targetSort = $state<TargetSort>(
    opts?.restoredState?.targetSort ?? 'default',
  );
  let onlyCounted = $state(
    opts?.restoredState?.onlyCounted ?? defaultOnlyCounted,
  );

  const hasCounted = $derived(getTargets().some(isCounted));
  const countedCount = $derived(getTargets().filter(isCounted).length);

  const filtered = $derived.by(() => {
    const targets = getTargets().filter((t) => {
      if (onlyCounted && !isCounted(t)) return false;
      if (!filterQuery.trim()) return true;
      return normalizeForSearch(targetLabel(t.record.scope)).includes(
        normalizeForSearch(filterQuery),
      );
    });
    return sortTargets(targets, targetSort);
  });

  function reset() {
    filterQuery = '';
    targetSort = 'default';
    onlyCounted = defaultOnlyCounted;
  }

  return {
    get filterQuery() {
      return filterQuery;
    },
    set filterQuery(v: string) {
      filterQuery = v;
    },
    get targetSort() {
      return targetSort;
    },
    set targetSort(v: TargetSort) {
      targetSort = v;
    },
    get onlyCounted() {
      return onlyCounted;
    },
    set onlyCounted(v: boolean) {
      onlyCounted = v;
    },
    get hasCounted() {
      return hasCounted;
    },
    get countedCount() {
      return countedCount;
    },
    get filtered() {
      return filtered;
    },
    reset,
  };
}

export type TargetFilter = ReturnType<typeof createTargetFilter>;
