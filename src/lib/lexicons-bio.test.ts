import { jsonToLex } from '@atproto/lex';
import { describe, expect, it } from 'vitest';
import * as Identification from '$lib/lexicons/bio/lexicons/temp/v0-1/identification';
import * as Media from '$lib/lexicons/bio/lexicons/temp/v0-1/media';
import * as Occurrence from '$lib/lexicons/bio/lexicons/temp/v0-1/occurrence';

// Pins our vendored copies of the lexicons.bio schemas to upstream plus our
// documented local extensions (docs/2026-06-06-lexicons-bio-proposals.md).
// Lexicon objects accept unknown keys, so each field is pinned by checking
// that a malformed value is rejected, which only happens if the schema
// declares it.

const OCCURRENCE_URI =
  'at://did:plc:abc123/bio.lexicons.temp.v0-1.occurrence/3mu252kzh4y2h';
const REMARK_URI =
  'at://did:plc:abc123/bio.lexicons.temp.v0-1.remark/3mu252kzh4y2h';

const occurrence = {
  $type: 'bio.lexicons.temp.v0-1.occurrence',
  eventDate: '2026-09-01T12:00:00.000Z',
  location: { decimalLatitude: '37.8', decimalLongitude: '-122.2' },
  createdAt: '2026-09-01T12:00:00.000Z',
};

const identification = {
  $type: 'bio.lexicons.temp.v0-1.identification',
  occurrence: {
    uri: OCCURRENCE_URI,
    cid: 'bafyreigvlunef7awbvcmkvjqzvoos2fzpx7zx3fuq7hddo6ntni6h25wqm',
  },
  scientificName: 'Quercus agrifolia',
};

describe('bio.lexicons.temp.v0-1.occurrence', () => {
  it('accepts a minimal record', () => {
    expect(Occurrence.$safeParse(occurrence).success).toBe(true);
  });

  it.each([
    'occurrenceRemarksID',
    'eventRemarksID',
    // local extensions
    'eventID',
    'surveyTargetID',
  ])('declares %s as an at-uri', (field) => {
    expect(
      Occurrence.$safeParse({ ...occurrence, [field]: REMARK_URI }).success,
    ).toBe(true);
    expect(
      Occurrence.$safeParse({ ...occurrence, [field]: 'not a uri' }).success,
    ).toBe(false);
  });

  it('declares externalRecords as service/uri references', () => {
    expect(
      Occurrence.$safeParse({
        ...occurrence,
        externalRecords: [
          {
            service: 'inaturalist',
            uri: 'https://www.inaturalist.org/observations/123456789',
          },
          { uri: OCCURRENCE_URI },
        ],
      }).success,
    ).toBe(true);
    expect(
      Occurrence.$safeParse({
        ...occurrence,
        externalRecords: [{ service: 'inaturalist' }],
      }).success,
    ).toBe(false);
  });
});

describe('bio.lexicons.temp.v0-1.identification', () => {
  it('declares identificationRemarksID as an at-uri', () => {
    expect(
      Identification.$safeParse({
        ...identification,
        identificationRemarksID: REMARK_URI,
      }).success,
    ).toBe(true);
    expect(
      Identification.$safeParse({
        ...identification,
        identificationRemarksID: 'not a uri',
      }).success,
    ).toBe(false);
  });

  it('keeps the vernacularName local extension', () => {
    expect(
      Identification.$safeParse({
        ...identification,
        vernacularName: 'x'.repeat(257),
      }).success,
    ).toBe(false);
  });
});

describe('bio.lexicons.temp.v0-1.media', () => {
  const media = (license: string) =>
    jsonToLex({
      $type: 'bio.lexicons.temp.v0-1.media',
      image: {
        $type: 'blob',
        ref: {
          $link: 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy',
        },
        mimeType: 'image/jpeg',
        size: 1000,
      },
      license,
    });

  it('accepts a Creative Commons license URI', () => {
    // 50 characters, over the 32 the old SPDX-only schema allowed
    expect(
      Media.$safeParse(
        media('https://creativecommons.org/licenses/by-nc-sa/4.0/'),
      ).success,
    ).toBe(true);
  });

  it('caps license at 128 characters', () => {
    expect(Media.$safeParse(media('x'.repeat(129))).success).toBe(false);
  });
});
