import { describe, expect, test } from 'vitest';
import { classificationFromAncestors } from './inat';

describe('classificationFromAncestors', () => {
  test('keeps the Darwin Core ranks and the whole lineage, without the root', () => {
    expect(
      classificationFromAncestors([
        { rank: 'stateofmatter', name: 'Life' },
        { rank: 'kingdom', name: 'Animalia' },
        { rank: 'phylum', name: 'Arthropoda' },
        { rank: 'subphylum', name: 'Hexapoda' },
        { rank: 'class', name: 'Insecta' },
        { rank: 'subclass', name: 'Pterygota' },
        { rank: 'order', name: 'Lepidoptera' },
        { rank: 'superfamily', name: 'Papilionoidea' },
        { rank: 'family', name: 'Nymphalidae' },
        { rank: 'subfamily', name: 'Danainae' },
        { rank: 'genus', name: 'Danaus' },
      ]),
    ).toEqual({
      kingdom: 'Animalia',
      phylum: 'Arthropoda',
      class: 'Insecta',
      order: 'Lepidoptera',
      family: 'Nymphalidae',
      higherClassification:
        'Animalia | Arthropoda | Hexapoda | Insecta | Pterygota | Lepidoptera | Papilionoidea | Nymphalidae | Danainae | Danaus',
    });
  });

  test('returns an empty classification for no ancestors', () => {
    expect(classificationFromAncestors([])).toEqual({});
    expect(classificationFromAncestors(undefined)).toEqual({});
  });
});
