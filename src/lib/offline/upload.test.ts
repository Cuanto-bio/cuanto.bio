import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  deletePendingSurvey,
  getPendingSurveys,
  savePendingSurvey,
} from './db';
import { uploadAllPending } from './upload';

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
