import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/pds', () => {
  class PdsSessionExpiredError extends Error {}
  class PdsScopeInsufficientError extends PdsSessionExpiredError {}
  return {
    createRecord: vi.fn(),
    putRecord: vi.fn(),
    deleteRecord: vi.fn(),
    PdsSessionExpiredError,
    PdsScopeInsufficientError,
  };
});

vi.mock('$lib/server/db/remarks', () => ({
  insertRemark: vi.fn(),
  deleteRemarkByAtUri: vi.fn(),
}));

vi.mock('$lib/server/db/users', () => ({
  getDefaultRemarkLicense: vi.fn(),
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
import { deleteRemarkByAtUri, insertRemark } from '$lib/server/db/remarks';
import { insertOccurrence } from '$lib/server/db/surveys';
import { getDefaultRemarkLicense } from '$lib/server/db/users';
import {
  deleteRecord,
  PdsScopeInsufficientError,
  PdsSessionExpiredError,
  putRecord,
} from '$lib/server/pds';
import {
  attachIdentificationToOccurrence,
  deleteRemark,
  remarkLicenseResolver,
  writeRemark,
} from './survey-records';

const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';
const DID = 'did:test:survey-records-spec';
const SURVEY_URI = `at://${DID}/bio.cuanto.survey/svy1`;
const OCC_URI = `at://${DID}/bio.lexicons.temp.v0-1.occurrence/occ1`;
const OCC_RKEY = 'occ1';
const IDENT_URI = `at://${DID}/bio.lexicons.temp.v0-1.identification/ident1`;
const SURVEY_RKEY = 'svy1';
const REMARK_URI = `at://${DID}/bio.lexicons.temp.v0-1.remark/${SURVEY_RKEY}`;
const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';

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
  vi.mocked(insertRemark).mockResolvedValue(undefined);
  vi.mocked(deleteRemarkByAtUri).mockResolvedValue(undefined);
  vi.mocked(getDefaultRemarkLicense).mockResolvedValue(null);
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

describe('writeRemark', () => {
  test('writes the remark at the survey rkey, pointing back at the survey', async () => {
    vi.mocked(putRecord).mockResolvedValue({
      uri: REMARK_URI,
      cid: FAKE_CID,
    });

    const uri = await writeRemark(
      DID,
      'eventRemarks',
      SURVEY_RKEY,
      SURVEY_URI,
      'Foggy.',
      CC0,
    );

    expect(uri).toBe(REMARK_URI);
    // Same rkey as the survey, different collection, so a retried POST
    // overwrites instead of creating a second remark.
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.lexicons.temp.v0-1.remark',
      SURVEY_RKEY,
      expect.objectContaining({
        subject: SURVEY_URI,
        dwcTerm: 'eventRemarks',
        body: 'Foggy.',
      }),
    );
    expect(insertRemark).toHaveBeenCalledWith(
      DID,
      SURVEY_RKEY,
      expect.objectContaining({ body: 'Foggy.' }),
      REMARK_URI,
    );
  });

  test('writes an occurrence remark at the occurrence rkey, pointing back at the occurrence', async () => {
    const occRemarkUri = `at://${DID}/bio.lexicons.temp.v0-1.remark/${OCC_RKEY}`;
    vi.mocked(putRecord).mockResolvedValue({
      uri: occRemarkUri,
      cid: FAKE_CID,
    });

    const uri = await writeRemark(
      DID,
      'occurrenceRemarks',
      OCC_RKEY,
      OCC_URI,
      'Calling from the creek.',
      CC0,
    );

    expect(uri).toBe(occRemarkUri);
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.lexicons.temp.v0-1.remark',
      OCC_RKEY,
      expect.objectContaining({
        subject: OCC_URI,
        dwcTerm: 'occurrenceRemarks',
        body: 'Calling from the creek.',
      }),
    );
  });

  test('writes the license it is given onto the record', async () => {
    vi.mocked(putRecord).mockResolvedValue({
      uri: REMARK_URI,
      cid: FAKE_CID,
    });

    await writeRemark(
      DID,
      'eventRemarks',
      SURVEY_RKEY,
      SURVEY_URI,
      'Foggy.',
      CC_BY,
    );

    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.lexicons.temp.v0-1.remark',
      SURVEY_RKEY,
      expect.objectContaining({ license: CC_BY }),
    );
  });

  test('returns null when the write fails, so the survey is still saved', async () => {
    vi.mocked(putRecord).mockRejectedValueOnce(new Error('PDS unavailable'));

    const uri = await writeRemark(
      DID,
      'eventRemarks',
      SURVEY_RKEY,
      SURVEY_URI,
      'Foggy.',
      CC0,
    );

    expect(uri).toBeNull();
    expect(insertRemark).not.toHaveBeenCalled();
  });

  test('rethrows an auth failure instead of silently dropping the remark', async () => {
    // Widening the OAuth scope to cover the remark collection means existing
    // sessions lack it. Swallowing that would save the survey and lose the
    // remark with no explanation, so it has to reach the route's 403.
    vi.mocked(putRecord).mockRejectedValueOnce(new PdsScopeInsufficientError());

    await expect(
      writeRemark(DID, 'eventRemarks', SURVEY_RKEY, SURVEY_URI, 'Foggy.', CC0),
    ).rejects.toBeInstanceOf(PdsSessionExpiredError);
  });
});

describe('remarkLicenseResolver', () => {
  test('uses the license the surveyor picked', async () => {
    const licenseFor = remarkLicenseResolver(DID);
    expect(await licenseFor(CC_BY)).toBe(CC_BY);
    expect(getDefaultRemarkLicense).not.toHaveBeenCalled();
  });

  test('falls back to the account default', async () => {
    vi.mocked(getDefaultRemarkLicense).mockResolvedValue(CC_BY);
    expect(await remarkLicenseResolver(DID)()).toBe(CC_BY);
  });

  test('falls back to CC0 when the user has never chosen a license', async () => {
    vi.mocked(getDefaultRemarkLicense).mockResolvedValue(null);
    expect(await remarkLicenseResolver(DID)()).toBe(CC0);
  });

  test('ignores a stored license that is no longer one we offer', async () => {
    // Guards against a value written by an older build, or hand-edited in the
    // database, reaching the PDS unchecked.
    vi.mocked(getDefaultRemarkLicense).mockResolvedValue('CC-BY-4.0');
    expect(await remarkLicenseResolver(DID)()).toBe(CC0);
  });

  test('looks the account default up at most once', async () => {
    // A survey can carry a remark per target; each one without a picked
    // license would otherwise repeat the same query.
    vi.mocked(getDefaultRemarkLicense).mockResolvedValue(CC_BY);
    const licenseFor = remarkLicenseResolver(DID);
    await Promise.all([licenseFor(), licenseFor(), licenseFor()]);
    await licenseFor();
    expect(getDefaultRemarkLicense).toHaveBeenCalledTimes(1);
  });
});

describe('deleteRemark', () => {
  test('deletes the PDS record and the mirror row', async () => {
    await deleteRemark(REMARK_URI);

    expect(deleteRecord).toHaveBeenCalledWith(REMARK_URI);
    expect(deleteRemarkByAtUri).toHaveBeenCalledWith(REMARK_URI);
  });

  test('still clears the mirror row when the PDS record is already gone', async () => {
    vi.mocked(deleteRecord).mockRejectedValueOnce(new Error('RecordNotFound'));

    await deleteRemark(REMARK_URI);

    expect(deleteRemarkByAtUri).toHaveBeenCalledWith(REMARK_URI);
  });

  test('rethrows an auth failure', async () => {
    vi.mocked(deleteRecord).mockRejectedValueOnce(new PdsSessionExpiredError());

    await expect(deleteRemark(REMARK_URI)).rejects.toBeInstanceOf(
      PdsSessionExpiredError,
    );
  });
});
