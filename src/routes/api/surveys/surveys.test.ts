import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/pds', () => ({
  createRecord: vi.fn(),
  putRecord: vi.fn(),
  PdsSessionExpiredError: class PdsSessionExpiredError extends Error {
    constructor() {
      super('PDS session expired');
    }
  },
}));

vi.mock('$lib/server/db/surveys', () => ({
  insertSurvey: vi.fn(),
  insertOccurrence: vi.fn(),
  getSurveysByDid: vi.fn(),
  getOccurrencesForSurveys: vi.fn(),
  getProtocolTargetsByUri: vi.fn().mockResolvedValue([]),
  groupOccurrencesBySurvey: vi.fn(),
  toSurveyResponse: vi.fn(),
}));

vi.mock('$lib/server/db/identifications', () => ({
  insertIdentification: vi.fn(),
  getIdentificationsForOccurrences: vi.fn(),
}));

vi.mock('$lib/server/db/survey-protocols', () => ({
  getProtocolByUri: vi.fn(),
}));

vi.mock('$lib/server/materialize-targets', () => ({
  materializeSurveyTargets: vi.fn(),
}));

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

import { isHttpError } from '@sveltejs/kit';
import sql from '$lib/server/db';
import {
  getIdentificationsForOccurrences,
  insertIdentification,
} from '$lib/server/db/identifications';
import { getProtocolByUri } from '$lib/server/db/survey-protocols';
import {
  getOccurrencesForSurveys,
  getSurveysByDid,
  groupOccurrencesBySurvey,
  insertOccurrence,
  insertSurvey,
  toSurveyResponse,
} from '$lib/server/db/surveys';
import {
  createRecord,
  PdsSessionExpiredError,
  putRecord,
} from '$lib/server/pds';
import { GET, POST } from './+server';

const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';
const DID = 'did:test:surveys-spec';

const protocol = {
  at_uri: `at://${DID}/bio.cuanto.surveyProtocol/proto1`,
  did: DID,
  rkey: 'proto1',
  cid: FAKE_CID,
  record: {
    $type: 'bio.cuanto.surveyProtocol',
    title: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
};

const baseSurveyBody = {
  protocolUri: protocol.at_uri,
  protocolRkey: 'proto1',
  locationName: 'Test Park',
  latitude: null,
  longitude: null,
  eventDate: '2026-05-01T10:00:00.000Z',
  eventDurationValue: 30,
  occurrences: [],
};

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/surveys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callPost(args: Parameters<typeof POST>[0]): Promise<Response> {
  try {
    return await POST(args);
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
  vi.mocked(getProtocolByUri).mockResolvedValue(
    protocol as unknown as Awaited<ReturnType<typeof getProtocolByUri>>,
  );
  vi.mocked(createRecord).mockResolvedValue({
    uri: `at://${DID}/bio.cuanto.survey/survey1`,
    cid: FAKE_CID,
  });
  // protocol_targets query returns no rows; users query returns the handle
  // biome-ignore lint/suspicious/noExplicitAny: sql mock needs any cast for mockResolvedValueOnce
  vi.mocked(sql as any)
    .mockResolvedValueOnce([]) // protocol_targets
    .mockResolvedValue([{ handle: 'alice' }]); // users (and any subsequent calls)
});

describe('POST /api/surveys — PDS session expiry', () => {
  test('returns 401 with pds_session_expired when createRecord throws PdsSessionExpiredError', async () => {
    vi.mocked(createRecord).mockRejectedValueOnce(new PdsSessionExpiredError());
    const resp = await callPost({
      request: makeRequest(baseSurveyBody),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(401);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe('pds_session_expired');
  });
});

describe('POST /api/surveys — surveyorCount validation', () => {
  test('returns 422 when surveyorCount is negative', async () => {
    const resp = await callPost({
      request: makeRequest({ ...baseSurveyBody, surveyorCount: -1 }),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(422);
  });

  test('returns 422 when surveyorCount is zero', async () => {
    const resp = await callPost({
      request: makeRequest({ ...baseSurveyBody, surveyorCount: 0 }),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(422);
  });

  test('returns 422 when surveyorCount is a decimal', async () => {
    const resp = await callPost({
      request: makeRequest({ ...baseSurveyBody, surveyorCount: 1.5 }),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(422);
  });

  test('saves surveyorCount to survey record when valid', async () => {
    const surveyUri = `at://${DID}/bio.cuanto.survey/svy1`;
    vi.mocked(createRecord).mockResolvedValueOnce({
      uri: surveyUri,
      cid: FAKE_CID,
    });
    vi.mocked(insertSurvey).mockResolvedValue(undefined);
    const resp = await callPost({
      request: makeRequest({ ...baseSurveyBody, surveyorCount: 2 }),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    const surveyRecord = vi.mocked(insertSurvey).mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(surveyRecord.surveyorCount).toBe(2);
  });
});

describe('POST /api/surveys — incidentals', () => {
  test('returns 401 when not authenticated', async () => {
    const resp = await callPost({
      request: makeRequest(baseSurveyBody),
      locals: { did: null },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(401);
  });

  test('returns 422 when incidental is missing taxonID', async () => {
    vi.mocked(createRecord).mockResolvedValueOnce({
      uri: `at://${DID}/bio.cuanto.survey/s1`,
      cid: FAKE_CID,
    });
    const body = {
      ...baseSurveyBody,
      incidentals: [
        { scientificName: 'Quercus agrifolia', taxonRank: 'species' },
      ],
    };
    const resp = await callPost({
      request: makeRequest(body),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(422);
    expect(insertOccurrence).not.toHaveBeenCalled();
  });

  test('returns 422 when incidental is missing scientificName', async () => {
    vi.mocked(createRecord).mockResolvedValueOnce({
      uri: `at://${DID}/bio.cuanto.survey/s1`,
      cid: FAKE_CID,
    });
    const body = {
      ...baseSurveyBody,
      incidentals: [
        {
          taxonID: 'https://www.inaturalist.org/taxa/12345',
          taxonRank: 'species',
        },
      ],
    };
    const resp = await callPost({
      request: makeRequest(body),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(422);
    expect(insertOccurrence).not.toHaveBeenCalled();
  });

  test('creates occurrence and identification for a valid incidental', async () => {
    const surveyUri = `at://${DID}/bio.cuanto.survey/s1`;
    const occUri = `at://${DID}/bio.lexicons.temp.v0-1.occurrence/occ1`;
    const identUri = `at://${DID}/bio.lexicons.temp.v0-1.identification/ident1`;
    vi.mocked(createRecord)
      .mockResolvedValueOnce({ uri: surveyUri, cid: FAKE_CID }) // survey
      .mockResolvedValueOnce({ uri: occUri, cid: FAKE_CID }) // occurrence
      .mockResolvedValueOnce({ uri: identUri, cid: FAKE_CID }); // identification
    vi.mocked(insertOccurrence).mockResolvedValue(undefined);
    vi.mocked(insertIdentification).mockResolvedValue(undefined);
    vi.mocked(putRecord).mockResolvedValue({ uri: occUri, cid: FAKE_CID });

    const body = {
      ...baseSurveyBody,
      incidentals: [
        {
          taxonID: 'https://www.inaturalist.org/taxa/12345',
          scientificName: 'Lupinus chamissonis',
          taxonRank: 'species',
          vernacularName: 'Silver bush lupine',
          kingdom: 'Plantae',
          organismQuantity: '2',
        },
      ],
    };
    const resp = await callPost({
      request: makeRequest(body),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    // identification created
    expect(insertIdentification).toHaveBeenCalledOnce();
    // occurrence updated with acceptedIdentificationID
    expect(putRecord).toHaveBeenCalledOnce();
    // insertOccurrence called twice: once for create, once for update
    expect(insertOccurrence).toHaveBeenCalledTimes(2);
  });

  test('does not create occurrence or identification when incidentals is absent', async () => {
    vi.mocked(createRecord).mockResolvedValue({
      uri: `at://${DID}/bio.cuanto.survey/s1`,
      cid: FAKE_CID,
    });
    const resp = await callPost({
      request: makeRequest(baseSurveyBody),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertOccurrence).not.toHaveBeenCalled();
    expect(insertIdentification).not.toHaveBeenCalled();
  });
});

describe('POST /api/surveys — eventDate validation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-02T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('returns 422 when eventDate is tomorrow (YYYY-MM-DD)', async () => {
    const resp = await callPost({
      request: makeRequest({ ...baseSurveyBody, eventDate: '2026-06-03' }),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(422);
  });

  test('returns 422 when eventDate is a future datetime', async () => {
    const resp = await callPost({
      request: makeRequest({
        ...baseSurveyBody,
        eventDate: '2026-06-03T10:00:00.000Z',
      }),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(422);
  });

  test('returns 422 when eventDate is a future month (YYYY-MM)', async () => {
    const resp = await callPost({
      request: makeRequest({ ...baseSurveyBody, eventDate: '2026-07' }),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(422);
  });

  test('returns 422 when eventDate is a future year (YYYY)', async () => {
    const resp = await callPost({
      request: makeRequest({ ...baseSurveyBody, eventDate: '2027' }),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(422);
  });

  test('returns 200 when eventDate is today', async () => {
    vi.mocked(createRecord).mockResolvedValue({
      uri: `at://${DID}/bio.cuanto.survey/survey1`,
      cid: FAKE_CID,
    });
    // biome-ignore lint/suspicious/noExplicitAny: sql mock needs any cast
    vi.mocked(sql as any)
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ handle: 'alice' }]);
    const resp = await callPost({
      request: makeRequest({ ...baseSurveyBody, eventDate: '2026-06-02' }),
      locals: { did: DID },
    } as unknown as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
  });
});

describe('GET /api/surveys', () => {
  const SURVEY_URI = `at://${DID}/bio.cuanto.survey/s1`;
  const INCIDENTAL_URI = `at://${DID}/bio.lexicons.temp.v0-1.occurrence/occ-incidental`;

  beforeEach(() => {
    vi.mocked(getSurveysByDid).mockResolvedValue([]);
    vi.mocked(getOccurrencesForSurveys).mockResolvedValue([
      {
        at_uri: INCIDENTAL_URI,
        survey_uri: SURVEY_URI,
        // no surveyTargetID → incidental
        record: {
          $type: 'bio.lexicons.temp.v0-1.occurrence',
          eventID: SURVEY_URI,
        } as unknown as Parameters<
          typeof groupOccurrencesBySurvey
        >[0][0]['record'],
      },
    ]);
    vi.mocked(getIdentificationsForOccurrences).mockResolvedValue(
      new Map([
        [
          INCIDENTAL_URI,
          {
            scientificName: 'Lupinus chamissonis',
            vernacularName: 'Silver bush lupine',
          },
        ],
      ]),
    );
    vi.mocked(groupOccurrencesBySurvey).mockReturnValue(new Map());
    vi.mocked(toSurveyResponse).mockReturnValue([]);
  });

  test('fetches identifications for incidental occurrences', async () => {
    const resp = await GET({
      locals: { did: DID },
    } as unknown as Parameters<typeof GET>[0]);
    expect(resp.status).toBe(200);
    expect(vi.mocked(getIdentificationsForOccurrences)).toHaveBeenCalledWith([
      INCIDENTAL_URI,
    ]);
  });

  test('passes identification data to groupOccurrencesBySurvey', async () => {
    await GET({
      locals: { did: DID },
    } as unknown as Parameters<typeof GET>[0]);
    expect(vi.mocked(groupOccurrencesBySurvey)).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          at_uri: INCIDENTAL_URI,
          identification: {
            scientificName: 'Lupinus chamissonis',
            vernacularName: 'Silver bush lupine',
          },
        }),
      ]),
    );
  });
});
