// Canned iNat ancestries served by fetchInatClassifications when INAT_MOCK=true.
// Keyed by iNat taxon id; the values are real iNat ancestors (as of 2026-09-28)
// for the taxa the integration tests use.
export const INAT_MOCK_ANCESTORS: Record<
  number,
  { rank: string; name: string }[]
> = {
  // Orienthella piunca, a seeded target in tests/fixtures.ts
  1655734: [
    { rank: 'kingdom', name: 'Animalia' },
    { rank: 'phylum', name: 'Mollusca' },
    { rank: 'class', name: 'Gastropoda' },
    { rank: 'subclass', name: 'Heterobranchia' },
    { rank: 'infraclass', name: 'Euthyneura' },
    { rank: 'subterclass', name: 'Ringipleura' },
    { rank: 'superorder', name: 'Nudipleura' },
    { rank: 'order', name: 'Nudibranchia' },
    { rank: 'suborder', name: 'Aeolidina' },
    { rank: 'superfamily', name: 'Fionoidea' },
    { rank: 'family', name: 'Coryphellidae' },
    { rank: 'genus', name: 'Orienthella' },
  ],
  // Vanessa cardui
  48548: [
    { rank: 'kingdom', name: 'Animalia' },
    { rank: 'phylum', name: 'Arthropoda' },
    { rank: 'subphylum', name: 'Hexapoda' },
    { rank: 'class', name: 'Insecta' },
    { rank: 'subclass', name: 'Pterygota' },
    { rank: 'order', name: 'Lepidoptera' },
    { rank: 'superfamily', name: 'Papilionoidea' },
    { rank: 'family', name: 'Nymphalidae' },
    { rank: 'subfamily', name: 'Nymphalinae' },
    { rank: 'tribe', name: 'Nymphalini' },
    { rank: 'genus', name: 'Vanessa' },
  ],
};
