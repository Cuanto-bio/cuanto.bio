import { describe, expect, test } from 'vitest';
import type { Target } from './offline/db';
import {
  applyClassifications,
  type Classification,
  createTargetFilter,
  inatIdsNeedingClassification,
  inatTaxonNumber,
  isTaxonScope,
  needsClassification,
  partitionNewTaxa,
  type TargetGroup,
  targetLabel,
  targetTaxonID,
  withClassification,
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

  test('restoredState seeds targetSort', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
      { restoredState: { targetSort: 'scientific' } },
    );
    expect(tf.targetSort).toBe('scientific');
    // Bubo virginianus sorts ahead of every other scientific name
    expect(tf.filtered[0].atUri).toBe(owl.atUri);
  });

  test('restoredState seeds onlyCounted', () => {
    const tf = createTargetFilter(
      () => targets,
      (t) => t.atUri === hawk.atUri,
      { restoredState: { onlyCounted: true } },
    );
    expect(tf.onlyCounted).toBe(true);
    expect(tf.filtered.map((t) => t.atUri)).toEqual([hawk.atUri]);
  });

  test('restoredState omitted fields fall back to the defaults', () => {
    const tf = createTargetFilter(
      () => targets,
      () => false,
      { initialOnlyCounted: true, restoredState: { targetSort: 'common' } },
    );
    expect(tf.targetSort).toBe('common');
    expect(tf.onlyCounted).toBe(true);
  });

  test('reset returns to the defaults, not to restoredState', () => {
    const tf = createTargetFilter(
      () => targets,
      () => true,
      { restoredState: { targetSort: 'scientific', onlyCounted: true } },
    );
    tf.reset();
    expect(tf.targetSort).toBe('default');
    expect(tf.onlyCounted).toBe(false);
  });
});

function classifiedTarget(
  atUri: string,
  scientificName: string,
  taxonRank: string,
  classification: Classification,
): Target {
  return {
    atUri,
    record: {
      $type: 'bio.cuanto.protocolTarget',
      protocol: 'at://example.com/protocol/1',
      scope: [
        { $type: TAXON_TYPE, scientificName, taxonRank, ...classification },
      ],
    },
  };
}

const INSECTA = 'Animalia | Arthropoda | Hexapoda | Insecta';
const LEPIDOPTERA_PATH = `${INSECTA} | Pterygota | Lepidoptera`;
const LEPIDOPTERA: Classification = {
  kingdom: 'Animalia',
  phylum: 'Arthropoda',
  class: 'Insecta',
  order: 'Lepidoptera',
};

describe('taxonomic sort', () => {
  const pterygota = classifiedTarget(
    'at://t/pterygota',
    'Pterygota',
    'subclass',
    {
      kingdom: 'Animalia',
      phylum: 'Arthropoda',
      class: 'Insecta',
      higherClassification: INSECTA,
    },
  );
  const nymphalidae = classifiedTarget(
    'at://t/nymphalidae',
    'Nymphalidae',
    'family',
    {
      ...LEPIDOPTERA,
      higherClassification: `${LEPIDOPTERA_PATH} | Papilionoidea`,
    },
  );
  const danaus = classifiedTarget(
    'at://t/danaus',
    'Danaus plexippus',
    'species',
    {
      ...LEPIDOPTERA,
      family: 'Nymphalidae',
      higherClassification: `${LEPIDOPTERA_PATH} | Papilionoidea | Nymphalidae | Danainae | Danaini | Danaina | Danaus`,
    },
  );
  const aglais = classifiedTarget(
    'at://t/aglais',
    'Aglais milberti',
    'species',
    {
      ...LEPIDOPTERA,
      family: 'Nymphalidae',
      higherClassification: `${LEPIDOPTERA_PATH} | Papilionoidea | Nymphalidae | Nymphalinae | Nymphalini | Aglais`,
    },
  );
  const vanessa = classifiedTarget('at://t/vanessa', 'Vanessa', 'genus', {
    ...LEPIDOPTERA,
    family: 'Nymphalidae',
    higherClassification: `${LEPIDOPTERA_PATH} | Papilionoidea | Nymphalidae | Nymphalinae | Nymphalini`,
  });
  const cardui = classifiedTarget(
    'at://t/cardui',
    'Vanessa cardui',
    'species',
    {
      ...LEPIDOPTERA,
      family: 'Nymphalidae',
      higherClassification: `${LEPIDOPTERA_PATH} | Papilionoidea | Nymphalidae | Nymphalinae | Nymphalini | Vanessa`,
    },
  );
  const papilio = classifiedTarget(
    'at://t/papilio',
    'Papilio glaucus',
    'species',
    {
      ...LEPIDOPTERA,
      family: 'Papilionidae',
      higherClassification: `${LEPIDOPTERA_PATH} | Papilionoidea | Papilionidae | Papilioninae | Papilionini | Papilio`,
    },
  );
  const plantae = classifiedTarget('at://t/plantae', 'Plantae', 'kingdom', {});
  // Only a kingdom, so there is nothing to group it by
  const oak = classifiedTarget('at://t/oak', 'Quercus agrifolia', 'species', {
    kingdom: 'Plantae',
  });
  const trees = verbatimTarget('at://t/trees', 'trees > 10 cm DBH');

  test('groups by classification, higher ranks above their descendants', () => {
    const tf = createTargetFilter(
      () => [
        trees,
        cardui,
        oak,
        papilio,
        vanessa,
        plantae,
        danaus,
        nymphalidae,
        aglais,
        pterygota,
      ],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    expect(tf.filtered.map((t) => t.atUri)).toEqual([
      // An ancestor sorts above its descendants
      pterygota.atUri,
      // A family sorts above everything in it
      nymphalidae.atUri,
      // Danainae before Nymphalinae
      danaus.atUri,
      // Aglais before Vanessa within Nymphalini
      aglais.atUri,
      // A genus sorts directly above its species
      vanessa.atUri,
      cardui.atUri,
      // Papilionidae after Nymphalidae
      papilio.atUri,
      // Plantae after Animalia
      plantae.atUri,
      // Unclassified taxa, then verbatim targets
      oak.atUri,
      trees.atUri,
    ]);
  });

  test('orders unclassified taxa by scientific name and verbatim targets by text', () => {
    const b = classifiedTarget('at://t/b', 'Bubo virginianus', 'species', {});
    const a = classifiedTarget('at://t/a', 'Accipiter cooperii', 'species', {});
    const z = verbatimTarget('at://t/z', 'z things');
    const y = verbatimTarget('at://t/y', 'y things');
    const tf = createTargetFilter(
      () => [z, b, y, a],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    expect(tf.filtered.map((t) => t.atUri)).toEqual([
      a.atUri,
      b.atUri,
      y.atUri,
      z.atUri,
    ]);
  });

  // Summarizes groups as [header, target URIs] for compact assertions
  function summarize(groups: TargetGroup[]) {
    return groups.map((g) => [
      g.header?.kind === 'taxon'
        ? g.header.names.join(' › ')
        : (g.header?.kind ?? null),
      g.targets.map((t) => t.atUri),
    ]);
  }

  const bee = classifiedTarget('at://t/bee', 'Apis mellifera', 'species', {
    kingdom: 'Animalia',
    phylum: 'Arthropoda',
    class: 'Insecta',
    order: 'Hymenoptera',
    family: 'Apidae',
    higherClassification: `${INSECTA} | Pterygota | Hymenoptera | Apocrita | Aculeata | Apoidea | Apidae | Apinae | Apini | Apis`,
  });
  const lepidoptera = classifiedTarget(
    'at://t/lepidoptera',
    'Lepidoptera',
    'order',
    {
      kingdom: 'Animalia',
      phylum: 'Arthropoda',
      class: 'Insecta',
      higherClassification: `${INSECTA} | Pterygota`,
    },
  );

  // Artiodactyla, where iNat places whales alongside deer
  const ARTIODACTYLA: Classification = {
    kingdom: 'Animalia',
    phylum: 'Chordata',
    class: 'Mammalia',
    order: 'Artiodactyla',
  };
  const ARTIODACTYLA_PATH =
    'Animalia | Chordata | Vertebrata | Mammalia | Artiodactyla';
  const artiodactyl = (
    name: string,
    rank: string,
    path: string,
    family?: string,
  ) =>
    classifiedTarget(`at://t/${name}`, name, rank, {
      ...ARTIODACTYLA,
      ...(family ? { family } : {}),
      higherClassification: path
        ? `${ARTIODACTYLA_PATH} | ${path}`
        : ARTIODACTYLA_PATH,
    });
  const minke = artiodactyl(
    'Balaenoptera acutorostrata',
    'species',
    'Whippomorpha | Cetacea | Mysticeti | Balaenopteridae | Balaenoptera',
    'Balaenopteridae',
  );
  const greyWhale = artiodactyl(
    'Eschrichtius robustus',
    'species',
    'Whippomorpha | Cetacea | Mysticeti | Eschrichtiidae | Eschrichtius',
    'Eschrichtiidae',
  );
  const porpoise = artiodactyl(
    'Phocoena phocoena',
    'species',
    'Whippomorpha | Cetacea | Odontoceti | Delphinoidea | Phocoenidae | Phocoena',
    'Phocoenidae',
  );
  const elk = artiodactyl(
    'Cervus canadensis',
    'species',
    'Ruminantia | Cervidae | Cervinae | Cervini | Cervus',
    'Cervidae',
  );

  test('groups by family when every target is in one order', () => {
    const tf = createTargetFilter(
      () => [cardui, papilio, danaus, nymphalidae, vanessa],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    expect(summarize(tf.groups)).toEqual([
      [
        'Nymphalidae',
        [nymphalidae.atUri, danaus.atUri, vanessa.atUri, cardui.atUri],
      ],
      ['Papilionidae', [papilio.atUri]],
    ]);
  });

  test('prefixes families with their order when orders vary', () => {
    const tf = createTargetFilter(
      () => [cardui, papilio, bee],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    expect(summarize(tf.groups)).toEqual([
      ['Hymenoptera › Apidae', [bee.atUri]],
      ['Lepidoptera › Nymphalidae', [cardui.atUri]],
      ['Lepidoptera › Papilionidae', [papilio.atUri]],
    ]);
  });

  test('heads a target above family with its own name', () => {
    const tf = createTargetFilter(
      () => [cardui, papilio, pterygota, lepidoptera],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    expect(summarize(tf.groups)).toEqual([
      ['Pterygota', [pterygota.atUri]],
      ['Lepidoptera', [lepidoptera.atUri]],
      ['Nymphalidae', [cardui.atUri]],
      ['Papilionidae', [papilio.atUri]],
    ]);
  });

  test('orders families by their full lineage, not alphabetically', () => {
    const tf = createTargetFilter(
      () => [minke, elk, greyWhale, porpoise],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    expect(summarize(tf.groups)).toEqual([
      // Ruminantia before Whippomorpha, so the deer aren't among the whales
      ['Cervidae', [elk.atUri]],
      // Baleen whales (Mysticeti) before toothed whales (Odontoceti)
      ['Balaenopteridae', [minke.atUri]],
      ['Eschrichtiidae', [greyWhale.atUri]],
      ['Phocoenidae', [porpoise.atUri]],
    ]);
  });

  test('gives unclassified taxa and verbatim targets their own groups', () => {
    const tf = createTargetFilter(
      () => [trees, oak, cardui, plantae],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    expect(summarize(tf.groups)).toEqual([
      ['Nymphalidae', [cardui.atUri]],
      ['Plantae', [plantae.atUri]],
      ['unclassified', [oak.atUri]],
      ['other', [trees.atUri]],
    ]);
  });

  test('keeps order prefixes while a search narrows the list', () => {
    const tf = createTargetFilter(
      () => [cardui, bee],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    tf.filterQuery = 'cardui';
    expect(summarize(tf.groups)).toEqual([
      ['Lepidoptera › Nymphalidae', [cardui.atUri]],
    ]);
  });

  test('heads targets above family by their own names, so an order heading never repeats', () => {
    const ruminantia = artiodactyl('Ruminantia', 'suborder', '');
    const cetacea = artiodactyl('Cetacea', 'infraorder', 'Whippomorpha');
    const tf = createTargetFilter(
      () => [minke, cetacea, elk, ruminantia],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    expect(summarize(tf.groups)).toEqual([
      ['Ruminantia', [ruminantia.atUri]],
      ['Cervidae', [elk.atUri]],
      ['Cetacea', [cetacea.atUri]],
      ['Balaenopteridae', [minke.atUri]],
    ]);
  });

  test('prefixes the order on headings for targets above family too', () => {
    const cetacea = artiodactyl('Cetacea', 'infraorder', 'Whippomorpha');
    const tf = createTargetFilter(
      () => [cetacea, minke, bee],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    expect(summarize(tf.groups)).toEqual([
      // Arthropoda before Chordata
      ['Hymenoptera › Apidae', [bee.atUri]],
      ['Artiodactyla › Cetacea', [cetacea.atUri]],
      ['Artiodactyla › Balaenopteridae', [minke.atUri]],
    ]);
  });

  // The lineage on each taxon heading, in group order
  const lineages = (groups: TargetGroup[]) =>
    groups.map((g) => (g.header?.kind === 'taxon' ? g.header.lineage : null));

  test('gives each family heading the lineage down to that family', () => {
    const tf = createTargetFilter(
      () => [minke, elk],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    expect(lineages(tf.groups)).toEqual([
      [...ARTIODACTYLA_PATH.split(' | '), 'Ruminantia', 'Cervidae'],
      [
        ...ARTIODACTYLA_PATH.split(' | '),
        'Whippomorpha',
        'Cetacea',
        'Mysticeti',
        'Balaenopteridae',
      ],
    ]);
  });

  test('gives a heading for a target above family its own lineage', () => {
    const cetacea = artiodactyl('Cetacea', 'infraorder', 'Whippomorpha');
    const tf = createTargetFilter(
      () => [cetacea, elk],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    expect(lineages(tf.groups)[1]).toEqual([
      ...ARTIODACTYLA_PATH.split(' | '),
      'Whippomorpha',
      'Cetacea',
    ]);
  });

  test('keeps a family together when only some of its targets have a lineage', () => {
    // Classified from rank names only, e.g. before a backfill or by another
    // client, so its sort key is shaped differently from cardui's
    const danausByRanks = classifiedTarget(
      'at://t/danaus-by-ranks',
      'Danaus plexippus',
      'species',
      { ...LEPIDOPTERA, family: 'Nymphalidae' },
    );
    const tf = createTargetFilter(
      () => [danausByRanks, papilio, cardui],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    expect(summarize(tf.groups)).toEqual([
      ['Nymphalidae', [cardui.atUri, danausByRanks.atUri]],
      ['Papilionidae', [papilio.atUri]],
    ]);
    // The list itself is in the same order as the groups
    expect(tf.filtered.map((t) => t.atUri)).toEqual([
      cardui.atUri,
      danausByRanks.atUri,
      papilio.atUri,
    ]);
  });

  test('gives each group a key that stays with its heading', () => {
    const tf = createTargetFilter(
      () => [cardui, papilio, oak, trees],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    const keys = tf.groups.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    const papilionidaeKey = keys[1];
    tf.filterQuery = 'glaucus';
    expect(tf.groups.map((g) => g.key)).toEqual([papilionidaeKey]);
  });

  test('treats a taxon with no phylum, class, order or family as unclassified', () => {
    const genusOnly = classifiedTarget(
      'at://t/genus-only',
      'Aus bus',
      'species',
      { higherClassification: 'Aus' },
    );
    const tf = createTargetFilter(
      () => [genusOnly, cardui, papilio, trees],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    expect(summarize(tf.groups)).toEqual([
      ['Nymphalidae', [cardui.atUri]],
      ['Papilionidae', [papilio.atUri]],
      ['unclassified', [genusOnly.atUri]],
      ['other', [trees.atUri]],
    ]);
  });

  test('has no headers when every target would share one group', () => {
    const tf = createTargetFilter(
      () => [cardui, vanessa],
      () => false,
    );
    tf.targetSort = 'taxonomic';
    expect(summarize(tf.groups)).toEqual([
      [null, [vanessa.atUri, cardui.atUri]],
    ]);
  });

  test('is one group with no header for other sorts', () => {
    const tf = createTargetFilter(
      () => [cardui, papilio, trees],
      () => false,
    );
    tf.targetSort = 'scientific';
    expect(summarize(tf.groups)).toEqual([
      [null, [papilio.atUri, trees.atUri, cardui.atUri]],
    ]);
  });

  test('restoredState seeds a taxonomic sort', () => {
    const tf = createTargetFilter(
      () => [cardui, vanessa],
      () => false,
      { restoredState: { targetSort: 'taxonomic' } },
    );
    expect(tf.filtered.map((t) => t.atUri)).toEqual([
      vanessa.atUri,
      cardui.atUri,
    ]);
  });
});

describe('inatTaxonNumber', () => {
  test('parses the id from an iNat taxon URL', () => {
    expect(inatTaxonNumber('https://www.inaturalist.org/taxa/48662')).toBe(
      48662,
    );
  });

  test('returns undefined for a non-iNat URI', () => {
    expect(
      inatTaxonNumber('https://www.gbif.org/species/102151594'),
    ).toBeUndefined();
  });

  test('returns undefined for undefined', () => {
    expect(inatTaxonNumber(undefined)).toBeUndefined();
  });
});

describe('needsClassification', () => {
  const inat = 'https://www.inaturalist.org/taxa/48662';
  const scope = (fields: Record<string, string>) => [
    { $type: TAXON_TYPE, scientificName: 'x', taxonRank: 'species', ...fields },
  ];

  test('is true for an iNat taxon with nothing beyond a kingdom', () => {
    expect(
      needsClassification(scope({ taxonID: inat, kingdom: 'Animalia' })),
    ).toBe(true);
  });

  test('is false once it has a rank below kingdom and a higher classification', () => {
    expect(
      needsClassification(
        scope({
          taxonID: inat,
          family: 'Nymphalidae',
          higherClassification: 'Animalia | Arthropoda',
        }),
      ),
    ).toBe(false);
  });

  test('is true for a classified taxon still missing its higher classification', () => {
    expect(
      needsClassification(scope({ taxonID: inat, family: 'Nymphalidae' })),
    ).toBe(true);
  });

  test('is false for a taxon from another authority', () => {
    expect(
      needsClassification(
        scope({ taxonID: 'https://www.gbif.org/species/102151594' }),
      ),
    ).toBe(false);
  });

  test('is false for a taxon without a taxonID', () => {
    expect(needsClassification(scope({}))).toBe(false);
  });

  test('is false for a kingdom, which has nothing above it', () => {
    expect(
      needsClassification(scope({ taxonID: inat, taxonRank: 'kingdom' })),
    ).toBe(false);
  });

  test('is false for a verbatim target', () => {
    expect(
      needsClassification([{ $type: VERBATIM_TYPE, verbatimTargetScope: 'x' }]),
    ).toBe(false);
  });
});

describe('inatIdsNeedingClassification', () => {
  test('lists each iNat taxon id that needs classification once', () => {
    const needs = (id: number) => ({
      scope: [
        {
          $type: TAXON_TYPE,
          scientificName: 'x',
          taxonRank: 'species',
          taxonID: `https://www.inaturalist.org/taxa/${id}`,
        },
      ],
    });
    const classified = {
      scope: [
        {
          $type: TAXON_TYPE,
          scientificName: 'y',
          taxonRank: 'species',
          taxonID: 'https://www.inaturalist.org/taxa/3',
          family: 'Nymphalidae',
          higherClassification: 'Animalia | Arthropoda',
        },
      ],
    };
    expect(
      inatIdsNeedingClassification([needs(1), needs(2), needs(1), classified]),
    ).toEqual([1, 2]);
  });
});

describe('applyClassifications', () => {
  const target = (id: number, fields: Record<string, string> = {}) => ({
    key: `k${id}`,
    scope: [
      {
        $type: TAXON_TYPE,
        scientificName: `Taxon ${id}`,
        taxonRank: 'species',
        taxonID: `https://www.inaturalist.org/taxa/${id}`,
        ...fields,
      },
    ],
  });

  test('adds each found classification to the targets that need it', () => {
    const result = applyClassifications(
      [
        target(1),
        target(2),
        target(3, { family: 'Keepidae', higherClassification: 'Keep | Path' }),
      ],
      new Map([
        [1, { order: 'Lepidoptera', family: 'Nymphalidae' }],
        [3, { family: 'Otheridae' }],
      ]),
    );
    expect(result[0]).toEqual({
      key: 'k1',
      scope: [
        { ...target(1).scope[0], order: 'Lepidoptera', family: 'Nymphalidae' },
      ],
    });
    // Not found, so unchanged
    expect(result[1]).toEqual(target(2));
    // Already classified, so unchanged
    expect(result[2]).toEqual(
      target(3, { family: 'Keepidae', higherClassification: 'Keep | Path' }),
    );
  });
});

describe('withClassification', () => {
  test('adds missing ranks without overwriting existing ones', () => {
    const scope = [
      {
        $type: TAXON_TYPE,
        scientificName: 'Vanessa cardui',
        taxonRank: 'species',
        kingdom: 'Metazoa',
      },
    ];
    const result = withClassification(scope, {
      kingdom: 'Animalia',
      family: 'Nymphalidae',
      higherClassification: 'Animalia | Arthropoda',
    });
    expect(result[0]).toEqual({
      $type: TAXON_TYPE,
      scientificName: 'Vanessa cardui',
      taxonRank: 'species',
      kingdom: 'Metazoa',
      family: 'Nymphalidae',
      higherClassification: 'Animalia | Arthropoda',
    });
  });

  test('does not mutate its input', () => {
    const scope = [
      { $type: TAXON_TYPE, scientificName: 'Vanessa', taxonRank: 'genus' },
    ];
    withClassification(scope, { family: 'Nymphalidae' });
    expect(scope[0]).not.toHaveProperty('family');
  });

  test('leaves a verbatim scope unchanged', () => {
    const scope = [{ $type: VERBATIM_TYPE, verbatimTargetScope: 'x' }];
    expect(withClassification(scope, { family: 'Nymphalidae' })).toEqual(scope);
  });
});
