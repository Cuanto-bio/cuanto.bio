import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  deletePendingSurvey,
  getPendingSurveys,
  savePendingSurvey,
} from './db';
import {
  PdsSessionExpiredError,
  uploadAllPending,
  uploadPendingSurvey,
} from './upload';

const baseSurvey: Omit<import('./db').PendingSurvey, 'id'> = {
  protocolUri: 'at://did:test:1/bio.lexicons.temp.v0-1.surveyProtocol/p1',
  protocolRkey: 'p1',
  protocolTitle: 'Test Protocol',
  locationName: 'Test Field',
  latitude: '37.7',
  longitude: '-122.4',
  eventDate: '2026-04-22',
  eventDurationValue: 60,
  eventDurationUnit: 'minutes',
  occurrences: [],
  createdAt: Date.now(),
  complete: true,
};

const baseSurveyRaw = { ...baseSurvey, id: 1 } as import('./db').PendingSurvey;

describe('uploadPendingSurvey — PdsSessionExpiredError', () => {
  test('throws PdsSessionExpiredError when server returns 401 with pds_session_expired', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'pds_session_expired' }),
    });
    await expect(uploadPendingSurvey(baseSurveyRaw)).rejects.toBeInstanceOf(
      PdsSessionExpiredError,
    );
  });

  test('throws generic error for non-session 401', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Unauthorized' }),
    });
    await expect(uploadPendingSurvey(baseSurveyRaw)).rejects.not.toBeInstanceOf(
      PdsSessionExpiredError,
    );
  });
});

describe('uploadAllPending — PdsSessionExpiredError propagation', () => {
  afterEach(async () => {
    const all = await getPendingSurveys();
    await Promise.all(
      all.map((s) => s.id != null && deletePendingSurvey(s.id)),
    );
    vi.restoreAllMocks();
  });

  test('re-throws PdsSessionExpiredError instead of swallowing it', async () => {
    await savePendingSurvey({ ...baseSurvey, complete: true });
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'pds_session_expired' }),
    });
    await expect(uploadAllPending()).rejects.toBeInstanceOf(
      PdsSessionExpiredError,
    );
  });

  test('swallows other errors', async () => {
    await savePendingSurvey({ ...baseSurvey, complete: true });
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.resolve({ error: 'server error' }),
    });
    await expect(uploadAllPending()).resolves.toBeUndefined();
  });
});

describe('uploadAllPending', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          surveyUri: 'at://did:test:1/bio.lexicons.temp.v0-1.survey/s1',
          handle: 'alice',
        }),
    });
  });

  afterEach(async () => {
    const all = await getPendingSurveys();
    await Promise.all(
      all.map((s) => s.id != null && deletePendingSurvey(s.id)),
    );
    vi.restoreAllMocks();
  });

  test('skips surveys where complete is false', async () => {
    await savePendingSurvey({ ...baseSurvey, complete: false });
    await uploadAllPending();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('uploads surveys where complete is true', async () => {
    await savePendingSurvey({ ...baseSurvey, complete: true });
    await uploadAllPending();
    expect(fetch).toHaveBeenCalledOnce();
  });

  test('skips incomplete and uploads complete when both present', async () => {
    await savePendingSurvey({ ...baseSurvey, complete: false });
    await savePendingSurvey({ ...baseSurvey, complete: true });
    await uploadAllPending();
    expect(fetch).toHaveBeenCalledOnce();
  });

  test('skips surveys with unresolved incidentals', async () => {
    await savePendingSurvey({
      ...baseSurvey,
      complete: true,
      incidentals: [{ localId: 'i1', placeholder: 'mystery bird' }],
    });
    await uploadAllPending();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('uploads complete surveys with no incidentals', async () => {
    await savePendingSurvey({
      ...baseSurvey,
      complete: true,
      incidentals: [],
    });
    await uploadAllPending();
    expect(fetch).toHaveBeenCalledOnce();
  });

  test('uploads complete surveys with only resolved incidentals', async () => {
    await savePendingSurvey({
      ...baseSurvey,
      complete: true,
      incidentals: [
        {
          localId: 'i1',
          taxonID: 'https://www.inaturalist.org/taxa/12345',
          scientificName: 'Quercus agrifolia',
          taxonRank: 'species',
        },
      ],
    });
    await uploadAllPending();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
