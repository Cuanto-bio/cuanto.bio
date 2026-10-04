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

vi.mock('$lib/server/db/surveys', () => ({
  deleteOccurrenceByAtUri: vi.fn(),
  deleteOccurrencesBySurveyUri: vi.fn().mockResolvedValue([]),
  deleteSurveyByAtUri: vi.fn(),
  getOccurrencesForSurveys: vi.fn().mockResolvedValue([]),
  getProtocolTargetsByUri: vi.fn().mockResolvedValue([]),
  getSurveyDetailByHandleAndRkey: vi.fn(),
  getSurveyOwnerDid: vi.fn(),
  insertOccurrence: vi.fn(),
  insertSurvey: vi.fn(),
}));

vi.mock('$lib/server/db/identifications', () => ({
  deleteIdentificationsByOccurrenceUris: vi.fn().mockResolvedValue([]),
  insertIdentification: vi.fn(),
}));

vi.mock('$lib/server/db/remarks', () => ({
  insertRemark: vi.fn(),
  deleteRemarkByAtUri: vi.fn(),
}));

vi.mock('$lib/server/db/users', () => ({
  getDefaultRemarkLicense: vi.fn().mockResolvedValue(null),
}));

vi.mock('$lib/server/materialize-targets', () => ({
  gcSurveyTargetsIfUnused: vi.fn(),
  materializeSurveyTargets: vi.fn(),
}));

import { isHttpError } from '@sveltejs/kit';
import { deleteRemarkByAtUri, insertRemark } from '$lib/server/db/remarks';
import {
  deleteOccurrencesBySurveyUri,
  deleteSurveyByAtUri,
  getSurveyDetailByHandleAndRkey,
  getSurveyOwnerDid,
  insertSurvey,
} from '$lib/server/db/surveys';
import {
  createRecord,
  deleteRecord,
  PdsScopeInsufficientError,
  putRecord,
} from '$lib/server/pds';
import { DELETE, PUT } from './+server';

const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';
const DID = 'did:test:survey-detail-spec';
const RKEY = 'aaaaaaaaaaaaa';
const SURVEY_URI = `at://${DID}/bio.cuanto.survey/${RKEY}`;
const REMARK_NSID = 'bio.lexicons.temp.v0-1.remark';
const REMARK_URI = `at://${DID}/${REMARK_NSID}/${RKEY}`;

function makeSurvey(record: Record<string, unknown> = {}) {
  return {
    atUri: SURVEY_URI,
    did: DID,
    rkey: RKEY,
    handle: 'alice',
    occurrences: [],
    record: {
      $type: 'bio.cuanto.survey',
      protocol: {
        uri: `at://${DID}/bio.cuanto.surveyProtocol/proto1`,
        cid: FAKE_CID,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      eventDate: '2026-05-01T10:00:00.000Z',
      location: { $type: 'org.atgeo.place', name: 'Test Park' },
      ...record,
    },
  };
}

const baseEditBody = {
  eventDate: '2026-05-01T10:00:00.000Z',
  eventDurationValue: 30,
  surveyorCount: null,
  locationName: 'Test Park',
  latitude: null,
  longitude: null,
  occurrences: [],
  incidentals: [],
};

function makeRequest(body: unknown) {
  return new Request(`http://localhost/api/surveys/alice/${RKEY}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callPut(body: unknown): Promise<Response> {
  try {
    return await PUT({
      request: makeRequest(body),
      params: { handle: 'alice', rkey: RKEY },
      locals: { did: DID },
    } as unknown as Parameters<typeof PUT>[0]);
  } catch (e) {
    if (isHttpError(e)) {
      return new Response(JSON.stringify({ message: e.body.message }), {
        status: e.status,
      });
    }
    throw e;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSurveyOwnerDid).mockResolvedValue(DID);
  vi.mocked(putRecord).mockImplementation(async (did, collection, rkey) => ({
    uri: `at://${did}/${collection}/${rkey}`,
    cid: FAKE_CID,
  }));
  // The PUT handler refetches the survey to build its response; the same stub
  // serves both reads unless a test overrides the first one.
  vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
    makeSurvey() as unknown as Awaited<
      ReturnType<typeof getSurveyDetailByHandleAndRkey>
    >,
  );
});

describe('PUT /api/surveys/[handle]/[rkey] — event remarks', () => {
  test('preserves an existing remark when eventRemark is omitted', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      makeSurvey({ eventRemarksID: REMARK_URI }) as unknown as Awaited<
        ReturnType<typeof getSurveyDetailByHandleAndRkey>
      >,
    );

    const resp = await callPut(baseEditBody);
    expect(resp.status).toBe(200);

    const collections = vi.mocked(putRecord).mock.calls.map((c) => c[1]);
    expect(collections).not.toContain(REMARK_NSID);
    expect(deleteRecord).not.toHaveBeenCalled();
    const surveyRecord = vi.mocked(insertSurvey).mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(surveyRecord.eventRemarksID).toBe(REMARK_URI);
  });

  test('adds a remark to a survey that had none', async () => {
    const resp = await callPut({
      ...baseEditBody,
      eventRemark: { body: 'Windy.' },
    });
    expect(resp.status).toBe(200);

    expect(putRecord).toHaveBeenCalledWith(
      DID,
      REMARK_NSID,
      RKEY,
      expect.objectContaining({
        subject: SURVEY_URI,
        dwcTerm: 'eventRemarks',
        body: 'Windy.',
      }),
    );
    expect(insertRemark).toHaveBeenCalled();
    const surveyRecord = vi.mocked(insertSurvey).mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(surveyRecord.eventRemarksID).toBe(REMARK_URI);
  });

  test('rewrites an existing remark at the rkey it already has', async () => {
    // Another client may have written the remark at a key of its own choosing,
    // so the edit has to follow eventRemarksID rather than assume the survey's
    // rkey.
    const foreignUri = `at://${DID}/${REMARK_NSID}/zzzzzzzzzzzzz`;
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      makeSurvey({ eventRemarksID: foreignUri }) as unknown as Awaited<
        ReturnType<typeof getSurveyDetailByHandleAndRkey>
      >,
    );

    await callPut({ ...baseEditBody, eventRemark: { body: 'Windy.' } });

    expect(putRecord).toHaveBeenCalledWith(
      DID,
      REMARK_NSID,
      'zzzzzzzzzzzzz',
      expect.objectContaining({ body: 'Windy.' }),
    );
    const surveyRecord = vi.mocked(insertSurvey).mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(surveyRecord.eventRemarksID).toBe(foreignUri);
  });

  test('deletes the remark when eventRemark is null', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      makeSurvey({ eventRemarksID: REMARK_URI }) as unknown as Awaited<
        ReturnType<typeof getSurveyDetailByHandleAndRkey>
      >,
    );

    const resp = await callPut({ ...baseEditBody, eventRemark: null });
    expect(resp.status).toBe(200);

    expect(deleteRecord).toHaveBeenCalledWith(REMARK_URI);
    expect(deleteRemarkByAtUri).toHaveBeenCalledWith(REMARK_URI);
    const surveyRecord = vi.mocked(insertSurvey).mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(surveyRecord.eventRemarksID).toBeUndefined();
  });

  test('keeps the remark when rewriting the survey fails', async () => {
    // Deleting first would leave the PDS survey pointing at a deleted record.
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      makeSurvey({ eventRemarksID: REMARK_URI }) as unknown as Awaited<
        ReturnType<typeof getSurveyDetailByHandleAndRkey>
      >,
    );
    vi.mocked(putRecord).mockRejectedValueOnce(new Error('PDS unavailable'));

    await expect(
      callPut({ ...baseEditBody, eventRemark: null }),
    ).rejects.toThrow('PDS unavailable');

    expect(deleteRecord).not.toHaveBeenCalled();
    expect(deleteRemarkByAtUri).not.toHaveBeenCalled();
  });

  test('maps a PDS auth failure to the slug the client prompts on', async () => {
    // Sessions that predate the remark collection joining our OAuth scope fail
    // here; a 500 would hide the "grant permission" prompt.
    vi.mocked(putRecord).mockRejectedValueOnce(new PdsScopeInsufficientError());

    const resp = await callPut({
      ...baseEditBody,
      eventRemark: { body: 'Windy.' },
    });

    expect(resp.status).toBe(403);
    expect(await resp.json()).toMatchObject({
      error: 'pds_permission_required',
    });
  });

  test('treats clearing the text as a delete', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      makeSurvey({ eventRemarksID: REMARK_URI }) as unknown as Awaited<
        ReturnType<typeof getSurveyDetailByHandleAndRkey>
      >,
    );

    await callPut({ ...baseEditBody, eventRemark: { body: '  ' } });

    expect(deleteRecord).toHaveBeenCalledWith(REMARK_URI);
    const surveyRecord = vi.mocked(insertSurvey).mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(surveyRecord.eventRemarksID).toBeUndefined();
  });

  test('does nothing when clearing a survey that had no remark', async () => {
    const resp = await callPut({ ...baseEditBody, eventRemark: null });
    expect(resp.status).toBe(200);
    expect(deleteRecord).not.toHaveBeenCalled();
    expect(deleteRemarkByAtUri).not.toHaveBeenCalled();
  });

  test('stamps the license the surveyor chose onto the rewritten remark', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      makeSurvey({ eventRemarksID: REMARK_URI }) as unknown as Awaited<
        ReturnType<typeof getSurveyDetailByHandleAndRkey>
      >,
    );

    const resp = await callPut({
      ...baseEditBody,
      eventRemark: {
        body: 'Windy.',
        license: 'https://creativecommons.org/licenses/by-nc/4.0/',
      },
    });
    expect(resp.status).toBe(200);
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      REMARK_NSID,
      RKEY,
      expect.objectContaining({
        body: 'Windy.',
        license: 'https://creativecommons.org/licenses/by-nc/4.0/',
      }),
    );
  });

  test('returns 422 for a license we do not offer', async () => {
    const resp = await callPut({
      ...baseEditBody,
      eventRemark: { body: 'Windy.', license: 'MIT' },
    });
    expect(resp.status).toBe(422);
    expect(putRecord).not.toHaveBeenCalled();
  });

  test('returns 422 when the remark is longer than the lexicon allows', async () => {
    const resp = await callPut({
      ...baseEditBody,
      eventRemark: { body: 'x'.repeat(3001) },
    });
    expect(resp.status).toBe(422);
    expect(putRecord).not.toHaveBeenCalled();
  });

  test('measures the remark limit in UTF-8 bytes, as the lexicon does', async () => {
    const resp = await callPut({
      ...baseEditBody,
      eventRemark: { body: 'あ'.repeat(1001) },
    });
    expect(resp.status).toBe(422);
    expect(putRecord).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/surveys/[handle]/[rkey] — event remarks', () => {
  test("deletes the survey's remark along with it", async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      makeSurvey({ eventRemarksID: REMARK_URI }) as unknown as Awaited<
        ReturnType<typeof getSurveyDetailByHandleAndRkey>
      >,
    );

    const resp = await DELETE({
      params: { handle: 'alice', rkey: RKEY },
      locals: { did: DID },
      url: new URL(`http://localhost/api/surveys/alice/${RKEY}`),
    } as unknown as Parameters<typeof DELETE>[0]);

    expect(resp.status).toBe(204);
    expect(deleteRecord).toHaveBeenCalledWith(REMARK_URI);
    expect(deleteRemarkByAtUri).toHaveBeenCalledWith(REMARK_URI);
  });

  test('stops and prompts when the remark delete fails on auth', async () => {
    // Carrying on would drop the survey from the index while it and its remark
    // stay on the PDS, with no prompt to sign in and try again.
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      makeSurvey({ eventRemarksID: REMARK_URI }) as unknown as Awaited<
        ReturnType<typeof getSurveyDetailByHandleAndRkey>
      >,
    );
    vi.mocked(deleteRecord).mockRejectedValueOnce(
      new PdsScopeInsufficientError(),
    );

    const resp = await DELETE({
      params: { handle: 'alice', rkey: RKEY },
      locals: { did: DID },
      url: new URL(`http://localhost/api/surveys/alice/${RKEY}`),
    } as unknown as Parameters<typeof DELETE>[0]);

    expect(resp.status).toBe(403);
    expect(await resp.json()).toMatchObject({
      error: 'pds_permission_required',
    });
    expect(deleteRemarkByAtUri).not.toHaveBeenCalled();
    expect(deleteOccurrencesBySurveyUri).not.toHaveBeenCalled();
    expect(deleteSurveyByAtUri).not.toHaveBeenCalled();
    expect(deleteRecord).toHaveBeenCalledTimes(1);
  });

  test('deletes nothing extra when the survey had no remark', async () => {
    const resp = await DELETE({
      params: { handle: 'alice', rkey: RKEY },
      locals: { did: DID },
      url: new URL(`http://localhost/api/surveys/alice/${RKEY}`),
    } as unknown as Parameters<typeof DELETE>[0]);

    expect(resp.status).toBe(204);
    expect(deleteRemarkByAtUri).not.toHaveBeenCalled();
  });
});

describe("remarks in another user's repo", () => {
  // eventRemarksID is whatever the survey record says, and another client can
  // write any AT-URI there. deleteRecord signs in as the DID in the URI, so
  // following it blindly would delete another user's record with their session.
  const OTHER_REMARK_URI = `at://did:test:someone-else/${REMARK_NSID}/xyz`;

  beforeEach(() => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      makeSurvey({ eventRemarksID: OTHER_REMARK_URI }) as unknown as Awaited<
        ReturnType<typeof getSurveyDetailByHandleAndRkey>
      >,
    );
  });

  test('DELETE leaves it alone', async () => {
    const resp = await DELETE({
      params: { handle: 'alice', rkey: RKEY },
      locals: { did: DID },
      url: new URL(`http://localhost/api/surveys/alice/${RKEY}`),
    } as unknown as Parameters<typeof DELETE>[0]);

    expect(resp.status).toBe(204);
    expect(deleteRecord).not.toHaveBeenCalledWith(OTHER_REMARK_URI);
    expect(deleteRemarkByAtUri).not.toHaveBeenCalledWith(OTHER_REMARK_URI);
  });

  test('PUT that does not touch the remark keeps the reference', async () => {
    await callPut(baseEditBody);

    expect(putRecord).not.toHaveBeenCalledWith(
      DID,
      REMARK_NSID,
      expect.anything(),
      expect.anything(),
    );
    const surveyRecord = vi.mocked(insertSurvey).mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(surveyRecord.eventRemarksID).toBe(OTHER_REMARK_URI);
  });

  test('PUT clearing the remark leaves it alone and drops the reference', async () => {
    const resp = await callPut({ ...baseEditBody, eventRemark: null });

    expect(resp.status).toBe(200);
    expect(deleteRecord).not.toHaveBeenCalled();
    expect(deleteRemarkByAtUri).not.toHaveBeenCalled();
    const surveyRecord = vi.mocked(insertSurvey).mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(surveyRecord.eventRemarksID).toBeUndefined();
  });

  test("PUT with a body writes the surveyor's own remark instead", async () => {
    await callPut({ ...baseEditBody, eventRemark: { body: 'Windy.' } });

    expect(putRecord).toHaveBeenCalledWith(
      DID,
      REMARK_NSID,
      RKEY,
      expect.objectContaining({ body: 'Windy.' }),
    );
    const surveyRecord = vi.mocked(insertSurvey).mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(surveyRecord.eventRemarksID).toBe(REMARK_URI);
  });
});

test('DELETE tolerates a malformed eventRemarksID', async () => {
  vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
    makeSurvey({ eventRemarksID: 'not-an-at-uri' }) as unknown as Awaited<
      ReturnType<typeof getSurveyDetailByHandleAndRkey>
    >,
  );

  const resp = await DELETE({
    params: { handle: 'alice', rkey: RKEY },
    locals: { did: DID },
    url: new URL(`http://localhost/api/surveys/alice/${RKEY}`),
  } as unknown as Parameters<typeof DELETE>[0]);

  expect(resp.status).toBe(204);
  expect(deleteRemarkByAtUri).not.toHaveBeenCalled();
});

describe('occurrence remarks', () => {
  const OCC_NSID = 'bio.lexicons.temp.v0-1.occurrence';
  const OCC_RKEY = 'bbbbbbbbbbbbb';
  const OCC_URI = `at://${DID}/${OCC_NSID}/${OCC_RKEY}`;
  const OCC_REMARK_URI = `at://${DID}/${REMARK_NSID}/${OCC_RKEY}`;
  const TARGET_URI = `at://${DID}/bio.cuanto.protocolTarget/t1`;

  function surveyWithOccurrence(occRecord: Record<string, unknown> = {}) {
    return {
      ...makeSurvey(),
      occurrences: [
        {
          atUri: OCC_URI,
          protocolTargetUri: TARGET_URI,
          record: {
            $type: OCC_NSID,
            organismQuantity: '2',
            organismQuantityType: 'individuals',
            ...occRecord,
          },
        },
      ],
    } as unknown as Awaited<ReturnType<typeof getSurveyDetailByHandleAndRkey>>;
  }

  function editBody(occ: Record<string, unknown>, rest = {}) {
    return {
      ...baseEditBody,
      occurrences: [
        { surveyTargetUri: TARGET_URI, organismQuantity: '2', ...occ },
      ],
      ...rest,
    };
  }

  function callDelete(query = '') {
    return DELETE({
      params: { handle: 'alice', rkey: RKEY },
      locals: { did: DID },
      url: new URL(`http://localhost/api/surveys/alice/${RKEY}${query}`),
    } as unknown as Parameters<typeof DELETE>[0]);
  }

  test('PUT writes a new occurrence at a known rkey, after its remark', async () => {
    const resp = await callPut(editBody({ remark: { body: 'Pair.' } }));
    expect(resp.status).toBe(200);

    // createRecord would let the PDS pick the rkey, so the remark could not
    // be written first.
    expect(createRecord).not.toHaveBeenCalled();
    const calls = vi.mocked(putRecord).mock.calls;
    const occIdx = calls.findIndex((c) => c[1] === OCC_NSID);
    expect(occIdx).toBeGreaterThanOrEqual(0);
    const occRkey = calls[occIdx][2];
    const remarkIdx = calls.findIndex(
      (c) => c[1] === REMARK_NSID && c[2] === occRkey,
    );
    expect(remarkIdx).toBeGreaterThanOrEqual(0);
    expect(remarkIdx).toBeLessThan(occIdx);
    expect(calls[remarkIdx][3]).toEqual(
      expect.objectContaining({
        subject: `at://${DID}/${OCC_NSID}/${occRkey}`,
        dwcTerm: 'occurrenceRemarks',
        body: 'Pair.',
      }),
    );
    expect(calls[occIdx][3]).toEqual(
      expect.objectContaining({
        occurrenceRemarksID: `at://${DID}/${REMARK_NSID}/${occRkey}`,
      }),
    );
  });

  test('PUT adds a remark to an existing occurrence at its rkey', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      surveyWithOccurrence(),
    );

    await callPut(editBody({ atUri: OCC_URI, remark: { body: 'Pair.' } }));

    const calls = vi.mocked(putRecord).mock.calls;
    const remarkIdx = calls.findIndex(
      (c) => c[1] === REMARK_NSID && c[2] === OCC_RKEY,
    );
    const occIdx = calls.findIndex((c) => c[1] === OCC_NSID);
    expect(remarkIdx).toBeGreaterThanOrEqual(0);
    expect(remarkIdx).toBeLessThan(occIdx);
    expect(calls[remarkIdx][3]).toEqual(
      expect.objectContaining({
        subject: OCC_URI,
        dwcTerm: 'occurrenceRemarks',
      }),
    );
    expect(calls[occIdx][3]).toEqual(
      expect.objectContaining({ occurrenceRemarksID: OCC_REMARK_URI }),
    );
  });

  test('PUT keeps an existing remark reference when remark is omitted', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      surveyWithOccurrence({ occurrenceRemarksID: OCC_REMARK_URI }),
    );

    await callPut(editBody({ atUri: OCC_URI, organismQuantity: '3' }));

    const calls = vi.mocked(putRecord).mock.calls;
    expect(calls.map((c) => c[1])).not.toContain(REMARK_NSID);
    expect(deleteRecord).not.toHaveBeenCalled();
    const occCall = calls.find((c) => c[1] === OCC_NSID);
    expect(occCall?.[3]).toEqual(
      expect.objectContaining({
        organismQuantity: '3',
        occurrenceRemarksID: OCC_REMARK_URI,
      }),
    );
  });

  test('PUT rewrites a remark at the rkey it already has', async () => {
    const otherKeyUri = `at://${DID}/${REMARK_NSID}/zzzzzzzzzzzzz`;
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      surveyWithOccurrence({ occurrenceRemarksID: otherKeyUri }),
    );

    await callPut(editBody({ atUri: OCC_URI, remark: { body: 'Three.' } }));

    expect(putRecord).toHaveBeenCalledWith(
      DID,
      REMARK_NSID,
      'zzzzzzzzzzzzz',
      expect.objectContaining({ body: 'Three.' }),
    );
    const occCall = vi
      .mocked(putRecord)
      .mock.calls.find((c) => c[1] === OCC_NSID);
    expect(occCall?.[3]).toEqual(
      expect.objectContaining({ occurrenceRemarksID: otherKeyUri }),
    );
  });

  test('PUT with a null remark drops the reference, then deletes the remark', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      surveyWithOccurrence({ occurrenceRemarksID: OCC_REMARK_URI }),
    );

    const resp = await callPut(editBody({ atUri: OCC_URI, remark: null }));
    expect(resp.status).toBe(200);

    const occCall = vi
      .mocked(putRecord)
      .mock.calls.find((c) => c[1] === OCC_NSID);
    expect(occCall?.[3]).not.toHaveProperty('occurrenceRemarksID');
    expect(deleteRecord).toHaveBeenCalledWith(OCC_REMARK_URI);
    expect(deleteRemarkByAtUri).toHaveBeenCalledWith(OCC_REMARK_URI);
    // Never a dangling reference: the occurrence is rewritten first.
    const occOrder = vi.mocked(putRecord).mock.invocationCallOrder.at(-1) ?? 0;
    expect(vi.mocked(deleteRecord).mock.invocationCallOrder[0]).toBeGreaterThan(
      occOrder,
    );
  });

  test('PUT deleting an occurrence deletes its remark too', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      surveyWithOccurrence({ occurrenceRemarksID: OCC_REMARK_URI }),
    );

    const resp = await callPut(
      editBody(
        { atUri: OCC_URI, organismQuantity: '0' },
        { deletedOccurrenceUris: [OCC_URI] },
      ),
    );
    expect(resp.status).toBe(200);

    expect(deleteRecord).toHaveBeenCalledWith(OCC_URI);
    expect(deleteRecord).toHaveBeenCalledWith(OCC_REMARK_URI);
    expect(deleteRemarkByAtUri).toHaveBeenCalledWith(OCC_REMARK_URI);
  });

  test("PUT deleting an occurrence leaves a remark in another user's repo alone", async () => {
    const otherUri = `at://did:test:someone-else/${REMARK_NSID}/xyz`;
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      surveyWithOccurrence({ occurrenceRemarksID: otherUri }),
    );

    await callPut(
      editBody(
        { atUri: OCC_URI, organismQuantity: '0' },
        { deletedOccurrenceUris: [OCC_URI] },
      ),
    );

    expect(deleteRecord).toHaveBeenCalledWith(OCC_URI);
    expect(deleteRecord).not.toHaveBeenCalledWith(otherUri);
    expect(deleteRemarkByAtUri).not.toHaveBeenCalled();
  });

  test('PUT returns 422 for an invalid remark before writing anything', async () => {
    const resp = await callPut(editBody({ remark: { body: 3 } }));
    expect(resp.status).toBe(422);
    expect(putRecord).not.toHaveBeenCalled();
  });

  test('DELETE deletes occurrence remarks along with the occurrences', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      surveyWithOccurrence({ occurrenceRemarksID: OCC_REMARK_URI }),
    );
    vi.mocked(deleteOccurrencesBySurveyUri).mockResolvedValueOnce([
      { at_uri: OCC_URI },
    ] as never);

    const resp = await callDelete();
    expect(resp.status).toBe(204);
    expect(deleteRecord).toHaveBeenCalledWith(OCC_REMARK_URI);
    expect(deleteRemarkByAtUri).toHaveBeenCalledWith(OCC_REMARK_URI);
  });

  test('DELETE keeps occurrence remarks when the occurrences are kept', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      surveyWithOccurrence({ occurrenceRemarksID: OCC_REMARK_URI }),
    );

    const resp = await callDelete('?deleteOccurrences=false');
    expect(resp.status).toBe(204);
    expect(deleteRecord).not.toHaveBeenCalledWith(OCC_REMARK_URI);
    expect(deleteRemarkByAtUri).not.toHaveBeenCalled();
  });
});

describe('occurrence remarks: review fixes', () => {
  const OCC_NSID = 'bio.lexicons.temp.v0-1.occurrence';
  const OCC_RKEY = 'bbbbbbbbbbbbb';
  const OCC_URI = `at://${DID}/${OCC_NSID}/${OCC_RKEY}`;
  const OCC_REMARK_URI = `at://${DID}/${REMARK_NSID}/${OCC_RKEY}`;
  const TARGET_URI = `at://${DID}/bio.cuanto.protocolTarget/t1`;
  const CUSTOM_LICENSE = 'https://example.org/licenses/custom';
  type Detail = Awaited<ReturnType<typeof getSurveyDetailByHandleAndRkey>>;

  function surveyWith(
    occ: Record<string, unknown>,
    survey: Record<string, unknown> = {},
  ) {
    return {
      ...makeSurvey(),
      ...survey,
      occurrences: [
        {
          atUri: OCC_URI,
          ...occ,
          record: {
            $type: OCC_NSID,
            organismQuantity: '2',
            organismQuantityType: 'individuals',
            ...(occ.record as Record<string, unknown>),
          },
        },
      ],
    } as unknown as Detail;
  }

  test('PUT keeps the remark reference on an existing incidental', async () => {
    // "Convert to incidental" keeps occurrenceRemarksID, so an incidental can
    // carry one even though the form offers no remark field for it.
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      surveyWith({
        record: {
          taxonID: 'https://www.inaturalist.org/taxa/47126',
          occurrenceRemarksID: OCC_REMARK_URI,
        },
      }),
    );

    const resp = await callPut({
      ...baseEditBody,
      incidentals: [
        {
          atUri: OCC_URI,
          taxonID: 'https://www.inaturalist.org/taxa/47126',
          scientificName: 'Quercus agrifolia',
          organismQuantity: '3',
        },
      ],
    });
    expect(resp.status).toBe(200);

    const occCall = vi
      .mocked(putRecord)
      .mock.calls.find((c) => c[1] === OCC_NSID);
    expect(occCall?.[3]).toEqual(
      expect.objectContaining({
        organismQuantity: '3',
        occurrenceRemarksID: OCC_REMARK_URI,
      }),
    );
  });

  test('PUT ignores an occurrence atUri that is not in this survey', async () => {
    // The remark's subject and the occurrence's key both come from atUri, so
    // a foreign one would write records that do not agree with each other.
    const foreignUri = `at://did:test:someone-else/${OCC_NSID}/${OCC_RKEY}`;

    const resp = await callPut({
      ...baseEditBody,
      occurrences: [
        {
          atUri: foreignUri,
          surveyTargetUri: TARGET_URI,
          organismQuantity: '2',
          remark: { body: 'Pair.' },
        },
      ],
    });
    expect(resp.status).toBe(200);

    const collections = vi.mocked(putRecord).mock.calls.map((c) => c[1]);
    expect(collections).not.toContain(OCC_NSID);
    expect(collections).not.toContain(REMARK_NSID);
  });

  test('PUT keeps a license we do not offer when the remark already had it', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      surveyWith({
        protocolTargetUri: TARGET_URI,
        record: { occurrenceRemarksID: OCC_REMARK_URI },
        remark: {
          atUri: OCC_REMARK_URI,
          body: 'Old.',
          license: CUSTOM_LICENSE,
        },
      }),
    );

    const resp = await callPut({
      ...baseEditBody,
      occurrences: [
        {
          atUri: OCC_URI,
          surveyTargetUri: TARGET_URI,
          organismQuantity: '2',
          remark: { body: 'New.', license: CUSTOM_LICENSE },
        },
      ],
    });
    expect(resp.status).toBe(200);
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      REMARK_NSID,
      OCC_RKEY,
      expect.objectContaining({ body: 'New.', license: CUSTOM_LICENSE }),
    );
  });

  test('PUT still rejects a license we do not offer that the remark did not have', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      surveyWith({
        protocolTargetUri: TARGET_URI,
        record: { occurrenceRemarksID: OCC_REMARK_URI },
        remark: {
          atUri: OCC_REMARK_URI,
          body: 'Old.',
          license: CUSTOM_LICENSE,
        },
      }),
    );

    const resp = await callPut({
      ...baseEditBody,
      occurrences: [
        {
          atUri: OCC_URI,
          surveyTargetUri: TARGET_URI,
          organismQuantity: '2',
          remark: { body: 'New.', license: 'https://example.org/other' },
        },
      ],
    });
    expect(resp.status).toBe(422);
  });

  test("PUT keeps a survey remark's license we do not offer", async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue({
      ...makeSurvey({ eventRemarksID: REMARK_URI }),
      eventRemark: { atUri: REMARK_URI, body: 'Old.', license: CUSTOM_LICENSE },
    } as unknown as Detail);

    const resp = await callPut({
      ...baseEditBody,
      eventRemark: { body: 'New.', license: CUSTOM_LICENSE },
    });
    expect(resp.status).toBe(200);
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      REMARK_NSID,
      RKEY,
      expect.objectContaining({ license: CUSTOM_LICENSE }),
    );
  });

  test('DELETE removes an occurrence remark only after its occurrence', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      surveyWith({ record: { occurrenceRemarksID: OCC_REMARK_URI } }),
    );
    vi.mocked(deleteOccurrencesBySurveyUri).mockResolvedValueOnce([
      { at_uri: OCC_URI },
    ] as never);

    const resp = await DELETE({
      params: { handle: 'alice', rkey: RKEY },
      locals: { did: DID },
      url: new URL(`http://localhost/api/surveys/alice/${RKEY}`),
    } as unknown as Parameters<typeof DELETE>[0]);
    expect(resp.status).toBe(204);

    const deleted = vi.mocked(deleteRecord).mock.calls.map((c) => c[0]);
    expect(deleted.indexOf(OCC_URI)).toBeGreaterThanOrEqual(0);
    expect(deleted.indexOf(OCC_REMARK_URI)).toBeGreaterThan(
      deleted.indexOf(OCC_URI),
    );
  });

  test('DELETE keeps an occurrence remark when its occurrence could not be deleted', async () => {
    // The occurrence is still on the PDS naming its remark; deleting the
    // remark would leave that reference dangling.
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      surveyWith({ record: { occurrenceRemarksID: OCC_REMARK_URI } }),
    );
    vi.mocked(deleteOccurrencesBySurveyUri).mockResolvedValueOnce([
      { at_uri: OCC_URI },
    ] as never);
    // The occurrence is the first record this DELETE removes from the PDS.
    vi.mocked(deleteRecord).mockRejectedValueOnce(new Error('PDS unavailable'));

    const resp = await DELETE({
      params: { handle: 'alice', rkey: RKEY },
      locals: { did: DID },
      url: new URL(`http://localhost/api/surveys/alice/${RKEY}`),
    } as unknown as Parameters<typeof DELETE>[0]);
    expect(resp.status).toBe(204);
    expect(deleteRecord).not.toHaveBeenCalledWith(OCC_REMARK_URI);
    expect(deleteRemarkByAtUri).not.toHaveBeenCalledWith(OCC_REMARK_URI);
  });
});
