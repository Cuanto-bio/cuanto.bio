import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/pds', () => ({
  createRecord: vi.fn(),
  putRecord: vi.fn(),
}));

vi.mock('$lib/server/db/identifications', () => ({
  insertIdentification: vi.fn(),
}));

vi.mock('$lib/server/db/surveys', () => ({
  insertOccurrence: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
  default: {
    child: vi.fn().mockReturnValue({ error: vi.fn(), warn: vi.fn() }),
  },
}));

import type { l } from '@atproto/lex';
import type { TaxonScope } from '$lib/lexicons/bio/cuanto/protocolTarget.defs';
import * as Occurrence from '$lib/lexicons/bio/lexicons/temp/v0-1/occurrence';
import { insertIdentification } from '$lib/server/db/identifications';
import { insertOccurrence } from '$lib/server/db/surveys';
import { putRecord } from '$lib/server/pds';
import { attachIdentificationToOccurrence } from './survey-records';

const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';
const DID = 'did:test:survey-records-spec';
const SURVEY_URI = `at://${DID}/bio.cuanto.survey/svy1`;
const OCC_URI = `at://${DID}/bio.lexicons.temp.v0-1.occurrence/occ1`;
const OCC_RKEY = 'occ1';
const IDENT_URI = `at://${DID}/bio.lexicons.temp.v0-1.identification/ident1`;

const TAXON_SCOPE: TaxonScope = {
  $type: 'bio.cuanto.protocolTarget#taxonScope',
  scientificName: 'Quercus agrifolia',
  taxonRank: 'species',
  vernacularName: 'Coast Live Oak',
  taxonID: 'https://www.inaturalist.org/taxa/47126' as l.UriString,
};

function makeOccRecord() {
  return Occurrence.$build({
    eventID: SURVEY_URI as l.AtUriString,
    taxonID: TAXON_SCOPE.taxonID,
    organismQuantity: '1',
    organismQuantityType: 'individuals',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Both the identification and the occurrence update go through putRecord now
  // (idempotent writes, #13); route by collection so the identification call
  // returns the ident URI and the occurrence update returns the occ URI.
  vi.mocked(putRecord).mockImplementation(async (_did, collection) =>
    collection.endsWith('identification')
      ? { uri: IDENT_URI, cid: FAKE_CID }
      : { uri: OCC_URI, cid: FAKE_CID },
  );
  vi.mocked(insertIdentification).mockResolvedValue(undefined);
  vi.mocked(insertOccurrence).mockResolvedValue(undefined);
});

describe('attachIdentificationToOccurrence', () => {
  test('creates identification and updates occurrence with acceptedIdentificationID', async () => {
    const occRecord = makeOccRecord();
    await attachIdentificationToOccurrence(
      DID,
      OCC_URI,
      FAKE_CID,
      OCC_RKEY,
      occRecord,
      TAXON_SCOPE,
    );

    // Identification written at the occurrence's rkey (reused, different
    // collection) via putRecord.
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.lexicons.temp.v0-1.identification',
      OCC_RKEY,
      expect.objectContaining({ scientificName: TAXON_SCOPE.scientificName }),
    );
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.lexicons.temp.v0-1.occurrence',
      OCC_RKEY,
      expect.objectContaining({
        acceptedIdentificationID: expect.objectContaining({ uri: IDENT_URI }),
      }),
    );
    expect(insertOccurrence).toHaveBeenCalledWith(
      DID,
      OCC_RKEY,
      expect.objectContaining({
        acceptedIdentificationID: expect.objectContaining({ uri: IDENT_URI }),
      }),
      OCC_URI,
    );
  });

  test('skips occurrence update when identification creation fails', async () => {
    // First putRecord (the identification) fails; the occurrence update must
    // not run.
    vi.mocked(putRecord).mockReset();
    vi.mocked(putRecord).mockRejectedValueOnce(new Error('PDS unavailable'));
    const occRecord = makeOccRecord();
    await attachIdentificationToOccurrence(
      DID,
      OCC_URI,
      FAKE_CID,
      OCC_RKEY,
      occRecord,
      TAXON_SCOPE,
    );

    expect(putRecord).toHaveBeenCalledTimes(1);
    expect(insertOccurrence).not.toHaveBeenCalled();
  });
});
