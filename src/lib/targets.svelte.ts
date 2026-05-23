import type { Target, TaxonScope, VerbatimScope } from '$lib/offline/db';

/** Sort order for a target list. `default` preserves protocol order. */
export type TargetSort = 'default' | 'scientific' | 'common';

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
 * Svelte 5 composable for filtering and sorting a target list.
 *
 * `getTargets` is called reactively — pass a getter that reads from `$state`
 * so the filtered list stays in sync when the protocol loads or changes.
 *
 * `isObserved` determines whether a target counts as observed for the
 * "only observed" filter. The implementation differs between the survey form
 * (checks `organismQuantities`) and survey detail (checks `survey.occurrences`),
 * so it's injected as a predicate.
 *
 * `opts.initialOnlyObserved` sets the starting state of the filter toggle —
 * pass `true` on the detail page to hide unrecorded targets by default.
 */
export function createTargetFilter(
  getTargets: () => Target[],
  isObserved: (t: Target) => boolean,
  opts?: { initialOnlyObserved?: boolean },
) {
  let filterQuery = $state('');
  let targetSort = $state<TargetSort>('default');
  let onlyObserved = $state(opts?.initialOnlyObserved ?? false);

  const filtered = $derived.by(() => {
    const targets = getTargets().filter((t) => {
      if (onlyObserved && !isObserved(t)) return false;
      if (!filterQuery.trim()) return true;
      return targetLabel(t.record.scope)
        .toLowerCase()
        .includes(filterQuery.toLowerCase());
    });
    return sortTargets(targets, targetSort);
  });

  function reset() {
    filterQuery = '';
    targetSort = 'default';
    onlyObserved = opts?.initialOnlyObserved ?? false;
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
    get onlyObserved() {
      return onlyObserved;
    },
    set onlyObserved(v: boolean) {
      onlyObserved = v;
    },
    get filtered() {
      return filtered;
    },
    reset,
  };
}

export type TargetFilter = ReturnType<typeof createTargetFilter>;
