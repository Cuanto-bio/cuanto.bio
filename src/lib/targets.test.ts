import { describe, expect, test } from 'vitest';
import type { Target } from './offline/db';
import {
  createTargetFilter,
  isTaxonScope,
  partitionNewTaxa,
  targetLabel,
  targetTaxonID,
} from './targets.svelte';

const TAXON_TYPE = 'bio.cuanto.protocolTarget#taxonScope' as const;
const VERBATIM_TYPE = 'bio.cuanto.protocolTarget#verbatimScope' as const;

function taxonTarget(
  atUri: string,
  scientificName: string,
  vernacularName?: string,
  taxonID?: string,
): Target {
  return {
    atUri,
    record: {
      $type: 'bio.cuanto.protocolTarget',
      protocol: 'at://example.com/protocol/1',
      scope: [
        // biome-ignore lint/suspicious/noExplicitAny: test fixture, taxonID is UriString in production
        { $type: TAXON_TYPE, scientificName, vernacularName, taxonID } as any,
      ],
    },
  };
}

function verbatimTarget(atUri: string, verbatimTargetScope: string): Target {
  return {
    atUri,
    record: {
      $type: 'bio.cuanto.protocolTarget',
      protocol: 'at://example.com/protocol/1',
      scope: [{ $type: VERBATIM_TYPE, verbatimTargetScope }],
    },
  };
}

describe('partitionNewTaxa', () => {
  const t = (taxonID?: string) => ({ taxonID, scientificName: 'x' });

  test('adds all taxa when none already exist', () => {
    const { toAdd, skipped } = partitionNewTaxa(
      [],
      [t('https://inat/taxa/1'), t('https://inat/taxa/2')],
    );
    expect(toAdd).toHaveLength(2);
    expect(skipped).toBe(0);
  });

  test('skips taxa whose taxonID is already a target', () => {
    const { toAdd, skipped } = partitionNewTaxa(
      ['https://inat/taxa/1'],
      [t('https://inat/taxa/1'), t('https://inat/taxa/2')],
    );
    expect(toAdd.map((x) => x.taxonID)).toEqual(['https://inat/taxa/2']);
    expect(skipped).toBe(1);
  });

  test('collapses duplicates within the incoming list', () => {
    const { toAdd, skipped } = partitionNewTaxa(
      [],
      [t('https://inat/taxa/1'), t('https://inat/taxa/1')],
    );
    expect(toAdd).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  test('skips taxa with no taxonID (cannot be de-duplicated)', () => {
    const { toAdd, skipped } = partitionNewTaxa([], [t(undefined)]);
    expect(toAdd).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

describe('isTaxonScope', () => {
  test('returns true for a taxon scope entry', () => {
    expect(isTaxonScope({ $type: TAXON_TYPE })).toBe(true);
  });

  test('returns false for a verbatim scope entry', () => {
    expect(isTaxonScope({ $type: VERBATIM_TYPE })).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(isTaxonScope(undefined)).toBe(false);
  });
});

describe('targetLabel', () => {
  test('returns "vernacular (scientific)" when both names are present', () => {
    expect(
      targetLabel([
        {
          $type: TAXON_TYPE,
          scientificName: 'Buteo jamaicensis',
          vernacularName: 'Red-tailed Hawk',
        },
      ]),
    ).toBe('Red-tailed Hawk (Buteo jamaicensis)');
  });

  test('returns scientific name when no vernacular name', () => {
    expect(
      targetLabel([{ $type: TAXON_TYPE, scientificName: 'Buteo jamaicensis' }]),
    ).toBe('Buteo jamaicensis');
  });

  test('returns verbatim string for verbatim scope', () => {
    expect(
      targetLabel([
        { $type: VERBATIM_TYPE, verbatimTargetScope: 'Trees > 10cm DBH' },
      ]),
    ).toBe('Trees > 10cm DBH');
  });

  test('returns "Unknown target" for empty scope', () => {
    expect(targetLabel([])).toBe('Unknown target');
  });
});

describe('targetTaxonID', () => {
  test('returns taxon ID from taxon scope', () => {
    expect(
      targetTaxonID([
        {
          $type: TAXON_TYPE,
          scientificName: 'X',
          taxonID: 'https://gbif.org/species/123',
        },
      ]),
    ).toBe('https://gbif.org/species/123');
  });

  test('returns undefined when taxon scope has no ID', () => {
    expect(
      targetTaxonID([{ $type: TAXON_TYPE, scientificName: 'X' }]),
    ).toBeUndefined();
  });

  test('returns undefined for verbatim scope', () => {
    expect(
      targetTaxonID([{ $type: VERBATIM_TYPE, verbatimTargetScope: 'X' }]),
    ).toBeUndefined();
  });
});

describe('createTargetFilter', () => {
  const hawk = taxonTarget('at://t/1', 'Buteo jamaicensis', 'Red-tailed Hawk');
  const owl = taxonTarget('at://t/2', 'Bubo virginianus', 'Great Horned Owl');
  const sparrow = taxonTarget('at://t/3', 'Melospiza melodia', 'Song Sparrow');
  const pine = taxonTarget('at://t/4', 'Pinus edulis', 'Piñon Pine');
  const tanuki = taxonTarget(
    'at://t/5',
    'Nyctereutes viverrinus',
    'ホンドタヌキ',
  );
  const mushroom = taxonTarget(
    'at://t/6',
    'Omphalotus illinoinensis',
    'Jack-o-lantern mushroom',
  );
  const fox = taxonTarget('at://t/7', 'Vulpes vulpes', 'ثَعْلَب');
  const aeolid = taxonTarget(
    'at://t/8',
    'Orienthella piunca',
    "Fisher's Aeolid",
  );
  const verbatim = verbatimTarget('at://t/9', 'Trees > 10cm DBH');
  const targets = [
    hawk,
    owl,
    sparrow,
    pine,
    tanuki,
    mushroom,
    fox,
    aeolid,
    verbatim,
  ];

  test('returns all targets with no filter active', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
    );
    expect(tf.filtered).toEqual(targets);
  });

  test('hasCounted is false when no targets pass isCounted', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
    );
    expect(tf.hasCounted).toBe(false);
  });

  test('hasCounted is true when at least one target passes isCounted', () => {
    const tf = createTargetFilter(
      () => targets,
      (t) => t.atUri === hawk.atUri,
    );
    expect(tf.hasCounted).toBe(true);
  });

  test('onlyCounted hides targets where isCounted returns false', () => {
    const observed = new Set(['at://t/1', 'at://t/3']);
    const tf = createTargetFilter(
      () => targets,
      (t) => observed.has(t.atUri),
      { initialOnlyCounted: true },
    );
    expect(tf.filtered.map((t) => t.atUri)).toEqual(['at://t/1', 'at://t/3']);
  });

  test('filterQuery is case-insensitive and matches label', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
    );
    tf.filterQuery = 'owl';
    expect(tf.filtered).toEqual([owl]);
  });

  test('filterQuery matches hypenated label with unhyphenated query', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
    );
    tf.filterQuery = 'red tailed';
    expect(tf.filtered).toEqual([hawk]);
  });

  test('filterQuery matches unhypenated label with hyphenated query', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
    );
    tf.filterQuery = 'great-horned';
    expect(tf.filtered).toEqual([owl]);
  });

  test('filterQuery matches diacritic in label with ASCII-equivalent in query', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
    );
    tf.filterQuery = 'pinon';
    expect(tf.filtered).toEqual([pine]);
  });

  test('filterQuery matches ASCII-equivalent in label with diacritic in query', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
    );
    tf.filterQuery = 'horñed';
    expect(tf.filtered).toEqual([owl]);
  });

  test('filterQuery matches east Asian characters in label', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
    );
    tf.filterQuery = 'ホンドタヌキ';
    expect(tf.filtered).toEqual([tanuki]);
  });

  test('filterQuery matches hyphenated label when the hyphenated word between two hyphens is a single letter', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
    );
    tf.filterQuery = 'jack o lantern';
    expect(tf.filtered).toEqual([mushroom]);
  });

  test('filterQuery matches label regardless of apostrophe', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
    );
    tf.filterQuery = 'fishers aeolid';
    expect(tf.filtered).toEqual([aeolid]);
  });

  test('filterQuery matches vocalized Arabic label with unvocalized query', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
    );
    tf.filterQuery = 'ثعلب';
    expect(tf.filtered).toEqual([fox]);
  });

  test('filterQuery matches scientific name', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
    );
    tf.filterQuery = 'melospiza';
    expect(tf.filtered).toEqual([sparrow]);
  });

  test('filterQuery matches verbatim targets', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
    );
    tf.filterQuery = 'trees';
    expect(tf.filtered).toEqual([verbatim]);
  });

  test('sort by scientific name orders alphabetically', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
    );
    tf.targetSort = 'scientific';
    const names = tf.filtered.map(
      (t) => t.record.scope[0] as Record<string, string>,
    );
    const sciNames = names.map(
      (s) => s.scientificName ?? s.verbatimTargetScope,
    );
    expect(sciNames).toEqual([...sciNames].sort((a, b) => a.localeCompare(b)));
  });

  test('sort by common name orders by vernacular, verbatim targets sort by their string', () => {
    const tf = createTargetFilter(
      () => [hawk, owl, sparrow, verbatim],
      () => false,
    );
    tf.targetSort = 'common';
    const uris = tf.filtered.map((t) => t.atUri);
    // Great Horned Owl, Red-tailed Hawk, Song Sparrow, then verbatim (no vernacular → falls back)
    expect(uris[0]).toBe(owl.atUri); // Great Horned Owl
    expect(uris[1]).toBe(hawk.atUri); // Red-tailed Hawk
    expect(uris[2]).toBe(sparrow.atUri); // Song Sparrow
  });

  test('sort by common name puts targets without vernacular name at the end', () => {
    const noVernacular = taxonTarget('at://t/5', 'Accipiter striatus');
    const tf = createTargetFilter(
      () => [hawk, noVernacular],
      () => false,
    );
    tf.targetSort = 'common';
    expect(tf.filtered.map((t) => t.atUri)).toEqual([
      hawk.atUri,
      noVernacular.atUri,
    ]);
  });

  test('reset clears query, sort, and restores initialOnlyCounted=false', () => {
    const tf = createTargetFilter(
      () => targets,
      () => true,
    );
    tf.filterQuery = 'hawk';
    tf.targetSort = 'scientific';
    tf.onlyCounted = true;
    tf.reset();
    expect(tf.filterQuery).toBe('');
    expect(tf.targetSort).toBe('default');
    expect(tf.onlyCounted).toBe(false);
  });

  test('reset restores initialOnlyCounted=true', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
      { initialOnlyCounted: true },
    );
    tf.onlyCounted = false;
    tf.reset();
    expect(tf.onlyCounted).toBe(true);
  });
});
