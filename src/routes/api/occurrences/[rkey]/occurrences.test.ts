import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db/occurrences', () => ({
  getOccurrenceByRkeyAndDid: vi.fn(),
  updateOccurrenceRecord: vi.fn(),
  deleteOccurrenceByUri: vi.fn(),
}));

vi.mock('$lib/server/pds', () => ({
  fetchAtRecord: vi.fn(),
  putRecord: vi.fn(),
  createRecord: vi.fn(),
  deleteRecord: vi.fn(),
}));

vi.mock('$lib/server/db/identifications', () => ({
  insertIdentification: vi.fn(),
}));

vi.mock('$lib/logger', () => ({
  default: { child: vi.fn().mockReturnValue({ error: vi.fn() }) },
}));

import { insertIdentification } from '$lib/server/db/identifications';
import {
  deleteOccurrenceByUri,
  getOccurrenceByRkeyAndDid,
  updateOccurrenceRecord,
} from '$lib/server/db/occurrences';
import {
  createRecord,
  deleteRecord,
  fetchAtRecord,
  putRecord,
} from '$lib/server/pds';
import { DELETE, PATCH } from './+server';

const DID = 'did:test:occ-spec';
const RKEY = 'testrkey';
const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';
const OCC_URI = `at://${DID}/bio.lexicons.temp.v0-1.occurrence/${RKEY}`;
const TARGET_URI = `at://${DID}/bio.cuanto.protocolTarget/tgtA`;
const OLD_TARGET_URI = `at://${DID}/bio.cuanto.protocolTarget/oldTgt`;

const BASE_OCCURRENCE = {
  at_uri: OCC_URI,
  did: DID,
  rkey: RKEY,
  record: {
    $type: 'bio.lexicons.temp.v0-1.occurrence' as const,
    eventID: `at://${DID}/bio.cuanto.survey/svy1` as `at://${string}`,
    surveyTargetID: OLD_TARGET_URI as `at://${string}`,
    organismQuantity: '2',
  },
};

const INAT_OCCURRENCE = {
  ...BASE_OCCURRENCE,
  record: {
    ...BASE_OCCURRENCE.record,
    taxonID: 'https://www.inaturalist.org/taxa/48662',
  },
};

function makeRequest(method: string, body: unknown): Request {
  return new Request(`http://localhost/api/occurrences/${RKEY}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callPatch(body: unknown, authenticated = true) {
  return PATCH({
    request: makeRequest('PATCH', body),
    locals: authenticated ? { did: DID } : {},
    params: { rkey: RKEY },
  } as never);
}

async function callDelete(authenticated = true) {
  return DELETE({
    request: makeRequest('DELETE', {}),
    locals: authenticated ? { did: DID } : {},
    params: { rkey: RKEY },
  } as never);
}

describe('PATCH /api/occurrences/[rkey]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(putRecord).mockResolvedValue({ uri: OCC_URI, cid: FAKE_CID });
    vi.mocked(createRecord).mockResolvedValue({
      uri: `at://${DID}/bio.lexicons.temp.v0-1.identification/identA`,
      cid: FAKE_CID,
    });
    vi.mocked(fetchAtRecord).mockResolvedValue({
      uri: OCC_URI,
      cid: FAKE_CID,
      value: {},
    });
    vi.mocked(getOccurrenceByRkeyAndDid).mockResolvedValue(
      BASE_OCCURRENCE as never,
    );
  });

  test('returns 401 when not authenticated', async () => {
    const res = await callPatch(
      { action: 'relink', surveyTargetID: TARGET_URI },
      false,
    );
    expect(res.status).toBe(401);
  });

  test('returns 404 when occurrence not found for this user', async () => {
    vi.mocked(getOccurrenceByRkeyAndDid).mockResolvedValue(null);
    const res = await callPatch({
      action: 'relink',
      surveyTargetID: TARGET_URI,
    });
    expect(res.status).toBe(404);
  });

  test('returns 422 for unknown action', async () => {
    const res = await callPatch({ action: 'unknown' });
    expect(res.status).toBe(422);
  });

  describe('relink', () => {
    test('calls putRecord with updated surveyTargetID', async () => {
      await callPatch({ action: 'relink', surveyTargetID: TARGET_URI });
      expect(putRecord).toHaveBeenCalledWith(
        DID,
        'bio.lexicons.temp.v0-1.occurrence',
        RKEY,
        expect.objectContaining({ surveyTargetID: TARGET_URI }),
      );
    });

    test('calls updateOccurrenceRecord with updated record', async () => {
      await callPatch({ action: 'relink', surveyTargetID: TARGET_URI });
      expect(updateOccurrenceRecord).toHaveBeenCalledWith(
        OCC_URI,
        expect.objectContaining({ surveyTargetID: TARGET_URI }),
      );
    });

    test('returns 200 on success', async () => {
      const res = await callPatch({
        action: 'relink',
        surveyTargetID: TARGET_URI,
      });
      expect(res.status).toBe(200);
    });

    test('returns 422 when surveyTargetID is missing', async () => {
      const res = await callPatch({ action: 'relink' });
      expect(res.status).toBe(422);
    });
  });

  describe('convert-to-incidental — with iNat taxonID', () => {
    beforeEach(() => {
      vi.mocked(getOccurrenceByRkeyAndDid).mockResolvedValue(
        INAT_OCCURRENCE as never,
      );
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              results: [
                {
                  id: 48662,
                  name: 'Danaus plexippus',
                  rank: 'species',
                  preferred_common_name: 'Monarch',
                  ancestors: [{ rank: 'kingdom', name: 'Animalia' }],
                },
              ],
            }),
        }),
      );
    });

    test('fetches taxon details from iNat', async () => {
      await callPatch({ action: 'convert-to-incidental' });
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('inaturalist.org/v2/taxa/48662'),
        expect.anything(),
      );
    });

    test('creates an identification record on PDS', async () => {
      await callPatch({ action: 'convert-to-incidental' });
      expect(createRecord).toHaveBeenCalledWith(
        DID,
        'bio.lexicons.temp.v0-1.identification',
        expect.objectContaining({
          scientificName: 'Danaus plexippus',
          vernacularName: 'Monarch',
          taxonID: 'https://www.inaturalist.org/taxa/48662',
        }),
      );
    });

    test('inserts identification into DB', async () => {
      await callPatch({ action: 'convert-to-incidental' });
      expect(insertIdentification).toHaveBeenCalled();
    });

    test('clears surveyTargetID and sets acceptedIdentificationID on occurrence', async () => {
      await callPatch({ action: 'convert-to-incidental' });
      expect(putRecord).toHaveBeenCalledWith(
        DID,
        'bio.lexicons.temp.v0-1.occurrence',
        RKEY,
        expect.objectContaining({
          acceptedIdentificationID: expect.objectContaining({ cid: FAKE_CID }),
        }),
      );
      const call = vi.mocked(putRecord).mock.calls[0][3] as Record<
        string,
        unknown
      >;
      expect(call).not.toHaveProperty('surveyTargetID');
    });
  });

  describe('convert-to-incidental — no taxonID', () => {
    test('clears surveyTargetID without creating identification', async () => {
      await callPatch({ action: 'convert-to-incidental' });
      expect(createRecord).not.toHaveBeenCalled();
      const call = vi.mocked(putRecord).mock.calls[0][3] as Record<
        string,
        unknown
      >;
      expect(call).not.toHaveProperty('surveyTargetID');
    });
  });

  describe('convert-to-incidental — non-iNat taxonID', () => {
    beforeEach(() => {
      vi.mocked(getOccurrenceByRkeyAndDid).mockResolvedValue({
        ...BASE_OCCURRENCE,
        record: {
          ...BASE_OCCURRENCE.record,
          taxonID: 'https://www.gbif.org/species/12345',
        },
      } as never);
    });

    test('does not create identification for non-iNat taxonID', async () => {
      await callPatch({ action: 'convert-to-incidental' });
      expect(createRecord).not.toHaveBeenCalled();
    });

    test('still clears surveyTargetID', async () => {
      await callPatch({ action: 'convert-to-incidental' });
      const call = vi.mocked(putRecord).mock.calls[0][3] as Record<
        string,
        unknown
      >;
      expect(call).not.toHaveProperty('surveyTargetID');
    });
  });

  describe('convert-to-incidental — iNat lookup fails', () => {
    beforeEach(() => {
      vi.mocked(getOccurrenceByRkeyAndDid).mockResolvedValue(
        INAT_OCCURRENCE as never,
      );
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    });

    test('still saves occurrence without identification', async () => {
      const res = await callPatch({ action: 'convert-to-incidental' });
      expect(createRecord).not.toHaveBeenCalledWith(
        DID,
        'bio.lexicons.temp.v0-1.identification',
        expect.anything(),
      );
      expect(putRecord).toHaveBeenCalledWith(
        DID,
        'bio.lexicons.temp.v0-1.occurrence',
        RKEY,
        expect.not.objectContaining({ surveyTargetID: expect.anything() }),
      );
      expect(res.status).toBe(200);
    });
  });
});

describe('DELETE /api/occurrences/[rkey]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOccurrenceByRkeyAndDid).mockResolvedValue(
      BASE_OCCURRENCE as never,
    );
  });

  test('returns 401 when not authenticated', async () => {
    const res = await callDelete(false);
    expect(res.status).toBe(401);
  });

  test('returns 404 when occurrence not found for this user', async () => {
    vi.mocked(getOccurrenceByRkeyAndDid).mockResolvedValue(null);
    const res = await callDelete();
    expect(res.status).toBe(404);
  });

  test('calls deleteRecord on PDS', async () => {
    await callDelete();
    expect(deleteRecord).toHaveBeenCalledWith(OCC_URI);
  });

  test('calls deleteOccurrenceByUri in DB', async () => {
    await callDelete();
    expect(deleteOccurrenceByUri).toHaveBeenCalledWith(OCC_URI);
  });

  test('returns 200 on success', async () => {
    const res = await callDelete();
    expect(res.status).toBe(200);
  });
});
