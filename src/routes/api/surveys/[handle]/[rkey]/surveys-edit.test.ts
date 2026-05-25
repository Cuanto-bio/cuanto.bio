import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/pds', () => ({
  createRecord: vi.fn(),
  putRecord: vi.fn(),
  deleteRecord: vi.fn(),
}));

vi.mock('$lib/server/db/surveys', () => ({
  getSurveyDetailByHandleAndRkey: vi.fn(),
  getSurveyOwnerDid: vi.fn(),
  getOccurrencesForSurveys: vi.fn().mockResolvedValue([]),
  getSurveyTargetsByUri: vi.fn().mockResolvedValue([]),
  insertSurvey: vi.fn(),
  insertOccurrence: vi.fn(),
  deleteOccurrenceByAtUri: vi.fn(),
  deleteOccurrencesBySurveyUri: vi.fn().mockResolvedValue([]),
  deleteSurveyByAtUri: vi.fn(),
}));

vi.mock('$lib/server/db/identifications', () => ({
  deleteIdentificationsByOccurrenceUris: vi.fn().mockResolvedValue([]),
  insertIdentification: vi.fn(),
}));

vi.mock('$lib/server/db', () => {
  const tag = Object.assign(
    vi.fn(() => Promise.resolve([{ did: DID }])),
    {
      json: (v: unknown) => v,
      array: (v: unknown) => v,
    },
  );
  return { default: tag };
});

vi.mock('$lib/server/logger', () => ({
  default: {
    child: vi.fn().mockReturnValue({ error: vi.fn(), warn: vi.fn() }),
  },
}));

import { isHttpError } from '@sveltejs/kit';
import sql from '$lib/server/db';
import { deleteIdentificationsByOccurrenceUris } from '$lib/server/db/identifications';
import {
  deleteOccurrenceByAtUri,
  deleteOccurrencesBySurveyUri,
  deleteSurveyByAtUri,
  getOccurrencesForSurveys,
  getSurveyDetailByHandleAndRkey,
  getSurveyOwnerDid,
  getSurveyTargetsByUri,
  insertOccurrence,
  insertSurvey,
} from '$lib/server/db/surveys';
import { createRecord, deleteRecord, putRecord } from '$lib/server/pds';
import { DELETE, GET, PUT } from './+server';

const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';
const DID = 'did:test:surveys-edit-spec';
const HANDLE = 'testuser';
const RKEY = 'survey1';

const PROTOCOL_URI = `at://${DID}/bio.lexicons.temp.v0-1.surveyProtocol/proto1`;
const SURVEY_URI = `at://${DID}/bio.lexicons.temp.v0-1.survey/${RKEY}`;
const TARGET_URI = `at://${DID}/bio.lexicons.temp.v0-1.surveyTarget/target1`;
const OCC_URI = `at://${DID}/bio.lexicons.temp.v0-1.occurrence/occ1`;

const FAKE_SURVEY = {
  atUri: SURVEY_URI,
  rkey: RKEY,
  handle: HANDLE,
  protocolHandle: HANDLE,
  protocolRkey: 'proto1',
  protocolTitle: 'Test Protocol',
  record: {
    $type: 'bio.lexicons.temp.v0-1.survey',
    protocol: {
      uri: PROTOCOL_URI,
      cid: FAKE_CID,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    eventDate: '2026-05-01T10:00:00.000Z',
    eventDurationValue: 30,
    eventDurationUnit: 'minutes',
    location: { $type: 'org.atgeo.place', name: 'Test Park' },
  },
  occurrences: [],
};

const FAKE_SURVEY_WITH_OCC = {
  ...FAKE_SURVEY,
  occurrences: [
    {
      atUri: OCC_URI,
      record: {
        $type: 'bio.lexicons.temp.v0-1.occurrence',
        eventID: SURVEY_URI,
        surveyTargetID: TARGET_URI,
        organismQuantity: '3',
        organismQuantityType: 'individual-count',
      },
      identification: undefined,
    },
  ],
};

function makeRequest(method: string, body?: unknown, searchParams?: string) {
  const url = `http://localhost/api/surveys/${HANDLE}/${RKEY}${searchParams ? `?${searchParams}` : ''}`;
  return new Request(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeLocals(did: string | null = DID) {
  return { did };
}

async function callDelete(
  did: string | null,
  searchParams = '',
): Promise<Response> {
  const req = makeRequest('DELETE', undefined, searchParams);
  const url = new URL(req.url);
  try {
    return await DELETE({
      request: req,
      locals: makeLocals(did),
      params: { handle: HANDLE, rkey: RKEY },
      url,
    } as Parameters<typeof DELETE>[0]);
  } catch (e) {
    if (isHttpError(e)) {
      return new Response(JSON.stringify({ message: e.body.message }), {
        status: e.status,
      });
    }
    throw e;
  }
}

async function callPut(did: string | null, body: unknown): Promise<Response> {
  const req = makeRequest('PUT', body);
  try {
    return await PUT({
      request: req,
      locals: makeLocals(did),
      params: { handle: HANDLE, rkey: RKEY },
    } as Parameters<typeof PUT>[0]);
  } catch (e) {
    if (isHttpError(e)) {
      return new Response(JSON.stringify({ message: e.body.message }), {
        status: e.status,
      });
    }
    throw e;
  }
}

const basePutBody = {
  eventDate: '2026-05-01T10:00:00.000Z',
  eventDurationValue: 45,
  surveyorCount: null,
  locationName: 'Test Park',
  latitude: null,
  longitude: null,
  occurrences: [],
  incidentals: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSurveyOwnerDid).mockResolvedValue(DID);
  vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
    FAKE_SURVEY as never,
  );
  vi.mocked(putRecord).mockResolvedValue({ uri: SURVEY_URI, cid: FAKE_CID });
  vi.mocked(insertSurvey).mockResolvedValue(undefined);
  vi.mocked(getOccurrencesForSurveys).mockResolvedValue([]);
  vi.mocked(deleteOccurrencesBySurveyUri).mockResolvedValue([]);
  vi.mocked(deleteIdentificationsByOccurrenceUris).mockResolvedValue([]);
});

describe('DELETE /api/surveys/[handle]/[rkey]', () => {
  test('returns 401 when not authenticated', async () => {
    const resp = await callDelete(null);
    expect(resp.status).toBe(401);
  });

  test('returns 403 when user does not own survey', async () => {
    const resp = await callDelete('did:test:someone-else');
    expect(resp.status).toBe(403);
  });

  test('returns 404 when survey not found', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(null);
    const resp = await callDelete(DID);
    expect(resp.status).toBe(404);
  });

  test('deletes survey from PDS and DB', async () => {
    const resp = await callDelete(DID, 'deleteOccurrences=false');
    expect(resp.status).toBe(204);
    expect(deleteSurveyByAtUri).toHaveBeenCalledWith(SURVEY_URI);
    expect(deleteRecord).toHaveBeenCalledWith(SURVEY_URI);
  });

  test('cascades to occurrences and identifications by default', async () => {
    vi.mocked(getOccurrencesForSurveys).mockResolvedValue([
      { at_uri: OCC_URI, survey_uri: SURVEY_URI, record: {} as never },
    ]);
    vi.mocked(deleteIdentificationsByOccurrenceUris).mockResolvedValue([
      { at_uri: `at://${DID}/bio.lexicons.temp.v0-1.identification/ident1` },
    ]);
    vi.mocked(deleteOccurrencesBySurveyUri).mockResolvedValue([
      { at_uri: OCC_URI },
    ]);

    const resp = await callDelete(DID);
    expect(resp.status).toBe(204);
    expect(deleteIdentificationsByOccurrenceUris).toHaveBeenCalledWith([
      OCC_URI,
    ]);
    expect(deleteOccurrencesBySurveyUri).toHaveBeenCalledWith(SURVEY_URI);
    expect(deleteRecord).toHaveBeenCalledTimes(3); // ident + occ + survey
  });

  test('skips occurrence cascade when deleteOccurrences=false', async () => {
    const resp = await callDelete(DID, 'deleteOccurrences=false');
    expect(resp.status).toBe(204);
    expect(getOccurrencesForSurveys).toHaveBeenCalledWith([SURVEY_URI]);
    expect(deleteIdentificationsByOccurrenceUris).toHaveBeenCalled();
    expect(deleteOccurrencesBySurveyUri).not.toHaveBeenCalled();
    expect(deleteSurveyByAtUri).toHaveBeenCalledWith(SURVEY_URI);
  });

  test('deletes local identifications when deleteOccurrences=false', async () => {
    vi.mocked(getOccurrencesForSurveys).mockResolvedValue([
      { at_uri: OCC_URI, survey_uri: SURVEY_URI, record: {} as never },
    ]);
    const identUri = `at://${DID}/bio.lexicons.temp.v0-1.identification/ident1`;
    vi.mocked(deleteIdentificationsByOccurrenceUris).mockResolvedValue([
      { at_uri: identUri },
    ]);
    const resp = await callDelete(DID, 'deleteOccurrences=false');
    expect(resp.status).toBe(204);
    expect(deleteIdentificationsByOccurrenceUris).toHaveBeenCalledWith([
      OCC_URI,
    ]);
    // We do want to delete the local idents, but not the PDS ones
    expect(deleteRecord).not.toHaveBeenCalledWith(identUri);
    expect(deleteOccurrencesBySurveyUri).not.toHaveBeenCalled();
  });
});

describe('PUT /api/surveys/[handle]/[rkey]', () => {
  test('returns 401 when not authenticated', async () => {
    const resp = await callPut(null, basePutBody);
    expect(resp.status).toBe(401);
  });

  test('returns 403 when user does not own survey', async () => {
    const resp = await callPut('did:test:someone-else', basePutBody);
    expect(resp.status).toBe(403);
  });

  test('returns 422 when surveyorCount is not a positive integer', async () => {
    const resp = await callPut(DID, { ...basePutBody, surveyorCount: 0 });
    expect(resp.status).toBe(422);
  });

  test('returns 422 when incidental is missing taxonID', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      FAKE_SURVEY as never,
    );
    const body = {
      ...basePutBody,
      incidentals: [{ scientificName: 'Quercus agrifolia' }],
    };
    const resp = await callPut(DID, body);
    expect(resp.status).toBe(422);
  });

  test('updates survey record via putRecord', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      FAKE_SURVEY as never,
    );
    const resp = await callPut(DID, { ...basePutBody, eventDurationValue: 60 });
    expect(resp.status).toBe(200);
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.lexicons.temp.v0-1.survey',
      RKEY,
      expect.objectContaining({ eventDurationValue: 60 }),
    );
    expect(insertSurvey).toHaveBeenCalled();
  });

  test('updates existing occurrence with new count', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      FAKE_SURVEY_WITH_OCC as never,
    );
    const body = {
      ...basePutBody,
      occurrences: [
        {
          atUri: OCC_URI,
          surveyTargetUri: TARGET_URI,
          organismQuantity: '5',
        },
      ],
    };
    const resp = await callPut(DID, body);
    expect(resp.status).toBe(200);
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.lexicons.temp.v0-1.occurrence',
      OCC_URI.split('/').at(-1),
      expect.objectContaining({ organismQuantity: '5' }),
    );
    expect(insertOccurrence).toHaveBeenCalled();
  });

  test('deletes existing occurrence when count is zero', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      FAKE_SURVEY_WITH_OCC as never,
    );
    const body = {
      ...basePutBody,
      occurrences: [
        {
          atUri: OCC_URI,
          surveyTargetUri: TARGET_URI,
          organismQuantity: '0',
        },
      ],
    };
    const resp = await callPut(DID, body);
    expect(resp.status).toBe(200);
    expect(deleteOccurrenceByAtUri).toHaveBeenCalledWith(OCC_URI);
    expect(deleteRecord).toHaveBeenCalledWith(OCC_URI);
  });

  test('creates new occurrence for target with count when no prior occurrence', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      FAKE_SURVEY as never,
    );
    const newOccUri = `at://${DID}/bio.lexicons.temp.v0-1.occurrence/newOcc`;
    // sql called for batch survey_targets lookup; empty scope → no identification created
    // biome-ignore lint/suspicious/noExplicitAny: sql mock needs any cast
    vi.mocked(sql as any).mockResolvedValueOnce([{ record: { scope: [] } }]);
    vi.mocked(createRecord).mockResolvedValueOnce({
      uri: newOccUri,
      cid: FAKE_CID,
    });
    const body = {
      ...basePutBody,
      occurrences: [
        {
          surveyTargetUri: TARGET_URI,
          organismQuantity: '2',
        },
      ],
    };
    const resp = await callPut(DID, body);
    expect(resp.status).toBe(200);
    expect(createRecord).toHaveBeenCalledWith(
      DID,
      'bio.lexicons.temp.v0-1.occurrence',
      expect.objectContaining({
        eventID: SURVEY_URI,
        surveyTargetID: TARGET_URI,
        organismQuantity: '2',
      }),
    );
    expect(insertOccurrence).toHaveBeenCalled();
  });

  test('creates identification when new occurrence has a matching taxon scope', async () => {
    const newOccUri = `at://${DID}/bio.lexicons.temp.v0-1.occurrence/newOcc`;
    const newIdentUri = `at://${DID}/bio.lexicons.temp.v0-1.identification/ident1`;
    vi.mocked(getSurveyTargetsByUri).mockResolvedValueOnce([
      {
        at_uri: TARGET_URI,
        record: {
          scope: [
            {
              $type: 'bio.lexicons.temp.v0-1.surveyTarget#taxonScope',
              scientificName: 'Quercus agrifolia',
              taxonRank: 'species',
            },
          ],
          $type: 'bio.lexicons.temp.v0-1.surveyTarget',
          protocol: PROTOCOL_URI,
        },
      },
    ] as never);
    vi.mocked(createRecord)
      .mockResolvedValueOnce({ uri: newOccUri, cid: FAKE_CID })
      .mockResolvedValueOnce({ uri: newIdentUri, cid: FAKE_CID });
    const body = {
      ...basePutBody,
      occurrences: [{ surveyTargetUri: TARGET_URI, organismQuantity: '2' }],
    };
    const resp = await callPut(DID, body);
    expect(resp.status).toBe(200);
    expect(createRecord).toHaveBeenCalledWith(
      DID,
      'bio.lexicons.temp.v0-1.identification',
      expect.objectContaining({ scientificName: 'Quercus agrifolia' }),
    );
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.lexicons.temp.v0-1.occurrence',
      newOccUri.split('/').at(-1),
      expect.objectContaining({
        acceptedIdentificationID: expect.objectContaining({ uri: newIdentUri }),
      }),
    );
  });

  test('creates new incidental occurrence with identification', async () => {
    vi.mocked(getSurveyDetailByHandleAndRkey).mockResolvedValue(
      FAKE_SURVEY as never,
    );
    const newOccUri = `at://${DID}/bio.lexicons.temp.v0-1.occurrence/incOcc1`;
    const newIdentUri = `at://${DID}/bio.lexicons.temp.v0-1.identification/ident1`;
    vi.mocked(createRecord)
      .mockResolvedValueOnce({ uri: newOccUri, cid: FAKE_CID })
      .mockResolvedValueOnce({ uri: newIdentUri, cid: FAKE_CID });
    const body = {
      ...basePutBody,
      incidentals: [
        {
          taxonID: 'https://www.inaturalist.org/taxa/47126',
          scientificName: 'Quercus agrifolia',
          taxonRank: 'species',
          vernacularName: 'Coast Live Oak',
          organismQuantity: '1',
        },
      ],
    };
    const resp = await callPut(DID, body);
    expect(resp.status).toBe(200);
    expect(createRecord).toHaveBeenCalledWith(
      DID,
      'bio.lexicons.temp.v0-1.occurrence',
      expect.objectContaining({
        eventID: SURVEY_URI,
        taxonID: 'https://www.inaturalist.org/taxa/47126',
        organismQuantity: '1',
      }),
    );
    expect(createRecord).toHaveBeenCalledWith(
      DID,
      'bio.lexicons.temp.v0-1.identification',
      expect.objectContaining({ scientificName: 'Quercus agrifolia' }),
    );
    expect(insertOccurrence).toHaveBeenCalledTimes(2); // initial + updated with acceptedIdentificationID
  });

  test('preserves original createdAt in updated survey record', async () => {
    const resp = await callPut(DID, basePutBody);
    expect(resp.status).toBe(200);
    expect(putRecord).toHaveBeenCalledWith(
      DID,
      'bio.lexicons.temp.v0-1.survey',
      RKEY,
      expect.objectContaining({ createdAt: FAKE_SURVEY.record.createdAt }),
    );
  });
});

describe('GET /api/surveys/[handle]/[rkey]', () => {
  test('returns 401 when not authenticated', async () => {
    const req = makeRequest('GET');
    let resp: Response;
    try {
      resp = await GET({
        request: req,
        locals: makeLocals(null),
        params: { handle: HANDLE, rkey: RKEY },
      } as Parameters<typeof GET>[0]);
    } catch (e) {
      if (isHttpError(e)) {
        resp = new Response(null, { status: e.status });
      } else {
        throw e;
      }
    }
    expect(resp?.status).toBe(401);
  });
});
