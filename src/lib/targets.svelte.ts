import type { Target, TaxonScope, VerbatimScope } from '$lib/offline/db';

/** Sort order for a target list. `default` preserves protocol order. */
export type TargetSort = 'default' | 'scientific' | 'common' | 'taxonomic';

/**
 * The Darwin Core rank terms a taxon scope can carry, highest first, used to
 * group targets under headings (issue
 * https://tangled.org/cuanto.bio/cuanto.bio/issues/81).
 */
export const CLASSIFICATION_RANKS = [
  'kingdom',
  'phylum',
  'class',
  'order',
  'family',
] as const;

export type ClassificationRank = (typeof CLASSIFICATION_RANKS)[number];

/**
 * A taxon's rank names plus its dwc:higherClassification: every higher taxon's
 * name, highest first, separated by " | ". The sort uses the full lineage, since
 * the named ranks alone can put, say, deer between two families of whales.
 */
export type Classification = Partial<Record<ClassificationRank, string>> & {
  higherClassification?: string;
};

// Darwin Core's recommended separator is " | "; be lenient about the spaces
const HIGHER_CLASSIFICATION_SEPARATOR = /\s*\|\s*/;

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

const INAT_TAXON_URL = /^https:\/\/www\.inaturalist\.org\/taxa\/(\d+)$/;

/** Returns the numeric iNat taxon id from an iNat taxon URL, if it is one. */
export function inatTaxonNumber(
  taxonID: string | undefined,
): number | undefined {
  const match = taxonID ? INAT_TAXON_URL.exec(taxonID) : null;
  return match ? Number(match[1]) : undefined;
}

/** A target's name at a rank, counting the target itself at its own rank. */
function nameAtRank(
  s: Record<string, string>,
  rank: ClassificationRank,
): string | undefined {
  return s.taxonRank === rank ? s.scientificName : s[rank] || undefined;
}

/**
 * True when a taxon scope can be grouped taxonomically: it has a phylum, class,
 * order or family (counting its own rank), or is itself a kingdom. The group
 * headings are built from those ranks, so a taxon with only, say, a genus
 * counts as unclassified.
 */
function isClassified(s: Record<string, string>): boolean {
  if (s.taxonRank === 'kingdom') return true;
  return (['phylum', 'class', 'order', 'family'] as const).some((rank) =>
    nameAtRank(s, rank),
  );
}

/**
 * Returns true if a target's classification could be filled in from iNat: an
 * iNat taxon that isn't classified yet (see isClassified) or has no
 * higherClassification. A kingdom has nothing above it to add.
 */
export function needsClassification(scope: unknown[]): boolean {
  const first = scope[0] as Record<string, string> | undefined;
  if (!first || !isTaxonScope(first)) return false;
  if (inatTaxonNumber(first.taxonID) === undefined) return false;
  if (first.taxonRank === 'kingdom') return false;
  return !isClassified(first) || !first.higherClassification;
}

/** The iNat taxon ids of targets that need classification, each once. */
export function inatIdsNeedingClassification(
  targets: { scope: unknown[] }[],
): number[] {
  const ids = targets.flatMap((t) => {
    if (!needsClassification(t.scope)) return [];
    return inatTaxonNumber(targetTaxonID(t.scope)) ?? [];
  });
  return [...new Set(ids)];
}

/**
 * Returns a copy of `scope` with `classification` merged into its taxon scope.
 * Only adds missing ranks; a value already on the record is never overwritten.
 */
export function withClassification<S>(
  scope: S[],
  classification: Classification,
): S[] {
  const [first, ...rest] = scope;
  const firstFields = first as Record<string, string> | undefined;
  if (!firstFields || !isTaxonScope(firstFields)) return scope;
  const merged: Record<string, string> = { ...firstFields };
  for (const field of [
    ...CLASSIFICATION_RANKS,
    'higherClassification',
  ] as const) {
    const value = classification[field];
    if (value && !merged[field]) merged[field] = value;
  }
  return [merged as S, ...rest];
}

/**
 * Returns `targets` with classifications (keyed by iNat taxon id) added to the
 * ones that need them. Shared by the server's classify-on-save and the protocol
 * form's backfill so both apply the same rules.
 */
export function applyClassifications<T extends { scope: unknown[] }>(
  targets: T[],
  classifications: Map<number, Classification>,
): T[] {
  return targets.map((t) => {
    if (!needsClassification(t.scope)) return t;
    const id = inatTaxonNumber(targetTaxonID(t.scope));
    const classification =
      id === undefined ? undefined : classifications.get(id);
    return classification
      ? { ...t, scope: withClassification(t.scope, classification) }
      : t;
  });
}

const firstScope = (t: Target) =>
  t.record.scope[0] as Record<string, string> | undefined;

/**
 * Sort key for the taxonomic sort: the target's lineage (its
 * higherClassification, or failing that its rank names) followed by its own
 * name, so an ancestor's key is a prefix of its descendants' keys. Siblings
 * sort alphabetically. Returns null for verbatim targets and for taxa that
 * aren't classified (see isClassified).
 */
function taxonomicSortKey(
  s: Record<string, string> | undefined,
): string[] | null {
  if (!s || !isTaxonScope(s) || !isClassified(s)) return null;
  const lineage = s.higherClassification
    ? s.higherClassification
        .split(HIGHER_CLASSIFICATION_SEPARATOR)
        .filter((name) => name)
    : CLASSIFICATION_RANKS.flatMap((rank) => s[rank] || []);
  return [...lineage, s.scientificName ?? ''];
}

function compareKeys(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const cmp = a[i].localeCompare(b[i]);
    if (cmp !== 0) return cmp;
  }
  return a.length - b.length;
}

/**
 * Heading for a run of targets in a taxonomic sort: a taxon's names (family,
 * possibly prefixed with its order), taxa with no classification, or verbatim
 * targets.
 */
export type TargetGroupHeader =
  | {
      kind: 'taxon';
      names: string[];
      // Every taxon from the top down to the heading's own, e.g. [Animalia, …,
      // Mysticeti, Balaenopteridae], shown when a surveyor expands the heading
      lineage: string[];
    }
  | { kind: 'unclassified' }
  | { kind: 'other' };

/** A run of consecutive targets under one header (null for no header). */
export interface TargetGroup {
  // Identifies the group by its heading, so views can key on it and state like
  // an expanded lineage stays with its heading as a search changes the groups
  key: string;
  header: TargetGroupHeader | null;
  targets: Target[];
}

/**
 * Groups are families, like a field guide. When the targets span more than one
 * order, each heading is prefixed with its order (e.g. "Diptera › Syrphidae").
 * A target with no family is headed by its own name (e.g. "Cetacea"): for a
 * target above family, the sort can put it between families of its order, so
 * an order heading there could appear more than once. That includes the rare
 * species with no family (incertae sedis), which each get their own heading.
 */
function groupHeader(target: Target, prefixOrder: boolean): TargetGroupHeader {
  const s = firstScope(target);
  if (!s || !isTaxonScope(s)) return { kind: 'other' };
  if (!isClassified(s)) return { kind: 'unclassified' };
  const name = nameAtRank(s, 'family') ?? s.scientificName;
  const order = nameAtRank(s, 'order');
  // The sort key is the target's lineage plus its own name
  const key = taxonomicSortKey(s) ?? [name];
  const index = key.indexOf(name);
  return {
    kind: 'taxon',
    names: prefixOrder && order && order !== name ? [order, name] : [name],
    lineage: index >= 0 ? key.slice(0, index + 1) : [...key.slice(0, -1), name],
  };
}

// Headers match on what they say, not their lineage, so targets under one
// heading stay together even if their recorded lineages differ slightly
function headerLabel(h: TargetGroupHeader | null): string {
  return JSON.stringify(
    h ? [h.kind, h.kind === 'taxon' ? h.names : null] : null,
  );
}

/**
 * What the taxonomic sort and grouping need to know about the whole target
 * list, as opposed to the targets a search currently shows. It depends only on
 * the protocol's targets, so it isn't recomputed on every keystroke.
 */
interface TaxonomicContext {
  // Whether headings name the order too, i.e. the targets span several orders
  prefixOrder: boolean;
  // False when every target would share one heading, so headings add nothing
  showHeaders: boolean;
  // Where each heading sorts: the longest lineage any of its targets has. A
  // heading's targets can have lineages of different shapes (some from a full
  // higherClassification, some from rank names only); sorting them all by one
  // key per heading keeps them together.
  headingKeys: Map<string, string[]>;
}

function taxonomicContext(all: Target[]): TaxonomicContext {
  const orders = new Set(
    all.flatMap((t) => {
      const s = firstScope(t);
      const order = s && isTaxonScope(s) ? nameAtRank(s, 'order') : undefined;
      return order ? [order] : [];
    }),
  );
  const prefixOrder = orders.size > 1;
  const headers = all.map((t) => groupHeader(t, prefixOrder));
  const headingKeys = new Map<string, string[]>();
  for (const header of headers) {
    if (header.kind !== 'taxon') continue;
    const label = headerLabel(header);
    const known = headingKeys.get(label);
    if (!known || header.lineage.length > known.length) {
      headingKeys.set(label, header.lineage);
    }
  }
  return {
    prefixOrder,
    showHeaders: new Set(headers.map(headerLabel)).size > 1,
    headingKeys,
  };
}

function sortTaxonomically(
  targets: Target[],
  context: TaxonomicContext,
): Target[] {
  // Computed once per target rather than on every comparison, since this runs
  // again on each keystroke in the target search
  const entries = targets.map((target) => {
    const s = firstScope(target);
    const key = taxonomicSortKey(s);
    const header = groupHeader(target, context.prefixOrder);
    return {
      target,
      key,
      headingKey:
        header.kind === 'taxon'
          ? (context.headingKeys.get(headerLabel(header)) ?? header.lineage)
          : null,
      // Classified taxa, then unclassified taxa, then verbatim targets
      group: key ? 0 : isTaxonScope(s) ? 1 : 2,
      name: s?.scientificName ?? s?.verbatimTargetScope ?? '',
    };
  });
  entries.sort((a, b) => {
    const groupCmp = a.group - b.group;
    if (groupCmp !== 0) return groupCmp;
    // By heading first, then within a heading by each target's own lineage
    const headingCmp =
      a.headingKey && b.headingKey
        ? compareKeys(a.headingKey, b.headingKey)
        : 0;
    if (headingCmp !== 0) return headingCmp;
    const keyCmp = a.key && b.key ? compareKeys(a.key, b.key) : 0;
    if (keyCmp !== 0) return keyCmp;
    return a.name.localeCompare(b.name);
  });
  return entries.map((e) => e.target);
}

/**
 * Splits taxonomically sorted targets into runs under headers. The context
 * comes from all targets, not just the `sorted` (possibly filtered) ones, so
 * headers stay put while a search narrows the list.
 */
function groupTaxonomically(
  sorted: Target[],
  context: TaxonomicContext,
): TargetGroup[] {
  if (!context.showHeaders) {
    return [{ key: 'all', header: null, targets: sorted }];
  }
  const groups: TargetGroup[] = [];
  for (const target of sorted) {
    const header = groupHeader(target, context.prefixOrder);
    const key = headerLabel(header);
    const last = groups.at(-1);
    if (last?.key === key) {
      last.targets.push(target);
    } else {
      groups.push({ key, header, targets: [target] });
    }
  }
  return groups;
}

function sortTargets(
  targets: Target[],
  sort: TargetSort,
  taxonomy: () => TaxonomicContext,
): Target[] {
  if (sort === 'default') return targets;
  if (sort === 'taxonomic') return sortTaxonomically(targets, taxonomy());
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

  // Only read (and so only computed) for the taxonomic sort
  const taxonomy = $derived(taxonomicContext(getTargets()));

  const filtered = $derived.by(() => {
    const targets = getTargets().filter((t) => {
      if (onlyCounted && !isCounted(t)) return false;
      if (!filterQuery.trim()) return true;
      return normalizeForSearch(targetLabel(t.record.scope)).includes(
        normalizeForSearch(filterQuery),
      );
    });
    return sortTargets(targets, targetSort, () => taxonomy);
  });

  // Sections for the list: headed runs in a taxonomic sort, else one headless
  // group, so views can always render groups
  const groups = $derived<TargetGroup[]>(
    targetSort === 'taxonomic'
      ? groupTaxonomically(filtered, taxonomy)
      : [{ key: 'all', header: null, targets: filtered }],
  );

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
    get groups() {
      return groups;
    },
    reset,
  };
}

export type TargetFilter = ReturnType<typeof createTargetFilter>;
