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
  protocolUri: 'at://did:test:1/bio.cuanto.surveyProtocol/p1',
  protocolRkey: 'p1',
  protocolTitle: 'Test Protocol',
  locationName: 'Test Field',
  latitude: '37.7',
  longitude: '-122.4',
  eventDate: '2026-04-22',
  eventDurationValue: 60,
  eventDurationUnit: 'minutes',
  occurrences: [],
  publishPoint: true,
  publishBbox: true,
  publishTrack: false,
  createdAt: Date.now(),
  complete: true,
};

const baseSurveyRaw = { ...baseSurvey, id: 1 } as import('./db').PendingSurvey;

describe('uploadPendingSurvey — track publishing', () => {
  test('does not POST /api/blobs/gpx when publishTrack is false', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn((url: string | URL | Request) => {
      urls.push(typeof url === 'string' ? url : url.toString());
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ surveyUri: 'at://x/y/z', handle: 'a' }),
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    await uploadPendingSurvey({
      ...baseSurveyRaw,
      publishTrack: false,
      gpsTrack: [{ lat: 1, lng: 2, timestamp: 0 }],
    });
    expect(urls).not.toContain('/api/blobs/gpx');
    expect(urls).toContain('/api/surveys');
  });

  test('uploads GPX before survey POST when publishTrack && track has points', async () => {
    const calls: { url: string; body: string | undefined }[] = [];
    const fetchMock = vi.fn(
      (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        calls.push({ url: urlStr, body: init?.body as string | undefined });
        if (urlStr === '/api/blobs/gpx') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                blob: {
                  $type: 'blob',
                  ref: { $link: 'bafyfake' },
                  mimeType: 'application/gpx+xml',
                  size: 42,
                },
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ surveyUri: 'at://x/y/z', handle: 'a' }),
        });
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    await uploadPendingSurvey({
      ...baseSurveyRaw,
      publishTrack: true,
      gpsTrack: [
        { lat: 1, lng: 2, timestamp: 0 },
        { lat: 3, lng: 4, timestamp: 1000 },
      ],
    });
    expect(calls[0].url).toBe('/api/blobs/gpx');
    expect(calls[1].url).toBe('/api/surveys');
    const surveyBody = JSON.parse(calls[1].body ?? '') as {
      track?: { gpx: { ref: { $link: string } }; source: string };
    };
    expect(surveyBody.track?.gpx.ref.$link).toBe('bafyfake');
    expect(surveyBody.track?.source).toBe('device');
  });

  test('passes through trackSource "uploaded" to the survey POST', async () => {
    const calls: { url: string; body: string | undefined }[] = [];
    const fetchMock = vi.fn(
      (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        calls.push({ url: urlStr, body: init?.body as string | undefined });
        if (urlStr === '/api/blobs/gpx') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                blob: {
                  $type: 'blob',
                  ref: { $link: 'bafyfake' },
                  mimeType: 'application/gpx+xml',
                  size: 42,
                },
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ surveyUri: 'at://x/y/z', handle: 'a' }),
        });
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    await uploadPendingSurvey({
      ...baseSurveyRaw,
      publishTrack: true,
      trackSource: 'uploaded',
      gpsTrack: [{ lat: 1, lng: 2, timestamp: 0 }],
    });
    const surveyBody = JSON.parse(calls[1].body ?? '') as {
      track?: { source: string };
    };
    expect(surveyBody.track?.source).toBe('uploaded');
  });

  test('clears latitude/longitude when publishPoint is false', async () => {
    let body: string | undefined;
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) => {
        body = init?.body as string | undefined;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ surveyUri: 'at://x/y/z', handle: 'a' }),
        });
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    await uploadPendingSurvey({ ...baseSurveyRaw, publishPoint: false });
    const surveyBody = JSON.parse(body ?? '') as {
      latitude: string | null;
      longitude: string | null;
    };
    expect(surveyBody.latitude).toBeNull();
    expect(surveyBody.longitude).toBeNull();
  });

  test('clears gpsBbox when publishBbox is false', async () => {
    let body: string | undefined;
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) => {
        body = init?.body as string | undefined;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ surveyUri: 'at://x/y/z', handle: 'a' }),
        });
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    await uploadPendingSurvey({
      ...baseSurveyRaw,
      publishBbox: false,
      gpsBbox: { north: '1', south: '0', east: '1', west: '0' },
    });
    const surveyBody = JSON.parse(body ?? '') as { gpsBbox?: unknown };
    expect(surveyBody.gpsBbox).toBeUndefined();
  });

  test('throws PdsSessionExpiredError when /api/blobs/gpx returns it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'pds_session_expired' }),
    });
    global.fetch = fetchMock;
    await expect(
      uploadPendingSurvey({
        ...baseSurveyRaw,
        publishTrack: true,
        gpsTrack: [{ lat: 1, lng: 2, timestamp: 0 }],
      }),
    ).rejects.toBeInstanceOf(PdsSessionExpiredError);
  });
});

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
          surveyUri: 'at://did:test:1/bio.cuanto.survey/s1',
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
