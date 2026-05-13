import type { l } from '@atproto/lex';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db', () => {
  const tag = Object.assign(
    vi.fn(() => Promise.resolve([])),
    {
      json: (v: unknown) => v,
      array: (v: unknown) => v,
    },
  );
  return { default: tag };
});

import sql from '$lib/server/db';
import { insertIdentification } from './identifications';

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

const baseIdentRecord = {
  $type: 'bio.lexicons.temp.v0-1.identification' as const,
  occurrence: {
    uri: 'at://did:plc:abc/bio.lexicons.temp.v0-1.occurrence/3occ' as l.AtUriString,
    cid: 'bafycid' as l.CidString,
  },
  scientificName: 'Quercus agrifolia',
  taxonRank: 'species' as const,
  kingdom: 'Plantae',
  taxonID: 'https://www.gbif.org/species/2878688' as l.UriString,
  vernacularName: 'Coast live oak',
};

describe('insertIdentification', () => {
  test('calls sql once', async () => {
    await insertIdentification(
      'did:plc:abc',
      '3ident',
      baseIdentRecord,
      'at://did:plc:abc/bio.lexicons.temp.v0-1.identification/3ident',
    );
    expect(mockSql).toHaveBeenCalledOnce();
  });

  test('calls sql once per invocation regardless of prior calls', async () => {
    await insertIdentification(
      'did:plc:abc',
      '3ident',
      baseIdentRecord,
      'at://did:plc:abc/bio.lexicons.temp.v0-1.identification/3ident',
    );
    await insertIdentification(
      'did:plc:abc',
      '3ident',
      baseIdentRecord,
      'at://did:plc:abc/bio.lexicons.temp.v0-1.identification/3ident',
    );
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  test('passes occurrence.uri as occurrence_uri', async () => {
    await insertIdentification(
      'did:plc:abc',
      '3ident',
      baseIdentRecord,
      'at://did:plc:abc/bio.lexicons.temp.v0-1.identification/3ident',
    );
    const allArgs = JSON.stringify(mockSql.mock.calls[0]);
    expect(allArgs).toContain(
      'at://did:plc:abc/bio.lexicons.temp.v0-1.occurrence/3occ',
    );
  });
});
