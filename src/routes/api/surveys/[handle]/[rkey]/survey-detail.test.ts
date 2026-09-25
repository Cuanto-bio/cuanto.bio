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
  getSurveyDetailByHandleAndRkey,
  getSurveyOwnerDid,
  insertSurvey,
} from '$lib/server/db/surveys';
import {
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

  test('returns 422 when the remark is longer than the lexicon allows', async () => {
    const resp = await callPut({
      ...baseEditBody,
      eventRemark: { body: 'x'.repeat(3001) },
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

  test('clears the remark row even when the PDS delete fails on auth', async () => {
    // The survey row is going away, so a remark row left behind would be
    // unreachable forever. deleteEventRemark rethrows auth failures by design,
    // which must not skip the local cleanup here.
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

    expect(resp.status).toBe(204);
    expect(deleteRemarkByAtUri).toHaveBeenCalledWith(REMARK_URI);
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
