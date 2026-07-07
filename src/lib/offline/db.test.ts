import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import {
  addCachedFollowedProtocol,
  cacheProtocol,
  cacheSurvey,
  clearIdb,
  clearIdbUser,
  deletePendingSurvey,
  getCachedFollowedProtocolByRkey,
  getCachedFollowedProtocols,
  getCachedProtocolByRkey,
  getCachedProtocols,
  getCachedSurvey,
  getCachedSurveyByRkey,
  getCachedSurveys,
  getIdbUser,
  getPendingSurveyById,
  getPendingSurveys,
  removeCachedFollowedProtocol,
  saveIdbUser,
  savePendingSurvey,
  setCachedFollowedProtocols,
  updatePendingSurvey,
} from './db';

// All tests in this file share one in-memory IDB (singleton _db). Each test
// explicitly sets up and tears down its own data rather than relying on
// module-level isolation.

// ── user store ────────────────────────────────────────────────────────────────

describe('user store', () => {
  test('saves and retrieves a user', async () => {
    await clearIdbUser();
    await saveIdbUser({ did: 'did:test:1', handle: 'alice' });
    const user = await getIdbUser();
    expect(user).toEqual({ did: 'did:test:1', handle: 'alice' });
  });

  test('overwrites user on repeated save', async () => {
    await saveIdbUser({ did: 'did:test:1', handle: 'alice' });
    await saveIdbUser({ did: 'did:test:2', handle: 'bob' });
    const user = await getIdbUser();
    expect(user).toEqual({ did: 'did:test:2', handle: 'bob' });
  });

  test('returns undefined when no user saved', async () => {
    await clearIdbUser();
    const user = await getIdbUser();
    expect(user).toBeUndefined();
  });

  test('clearIdbUser removes the stored user', async () => {
    await saveIdbUser({ did: 'did:test:1', handle: 'alice' });
    await clearIdbUser();
    const user = await getIdbUser();
    expect(user).toBeUndefined();
  });
});

// ── cached-protocols store ────────────────────────────────────────────────────

const cachedProtocol1 = {
  atUri: 'at://did:test:1/bio.cuanto.surveyProtocol/cp1',
  rkey: 'cp1',
  handle: 'alice',
  record: {
    $type: 'bio.cuanto.surveyProtocol' as const,
    title: 'Cached Protocol One',
    description: 'First cached protocol',
    createdAt:
      '2026-04-01T00:00:00.000Z' as `${string}-${string}-${string}T${string}:${string}:${string}Z`,
  },
  targets: [
    {
      atUri: 'at://did:test:1/bio.cuanto.protocolTarget/t1',
      record: {
        $type: 'bio.cuanto.protocolTarget' as const,
        protocol:
          'at://did:test:1/bio.cuanto.surveyProtocol/cp1' as `at://did:${string}:${string}/${string}.${string}.${string}/${string}`,
        scope: [],
      },
    },
  ],
};

describe('cached-protocols store', () => {
  test('cacheProtocol stores a protocol retrievable by rkey', async () => {
    await cacheProtocol(cachedProtocol1);
    const result = await getCachedProtocolByRkey('cp1');
    expect(result?.atUri).toBe(cachedProtocol1.atUri);
    expect(result?.record.title).toBe(cachedProtocol1.record.title);
    expect(result?.targets).toHaveLength(1);
  });

  test('getCachedProtocolByRkey returns undefined for unknown rkey', async () => {
    const result = await getCachedProtocolByRkey('does-not-exist');
    expect(result).toBeUndefined();
  });

  test('getCachedProtocolByRkey falls back to followed-protocols when not in cache', async () => {
    const followedOnly = {
      atUri: 'at://did:test:2/bio.cuanto.surveyProtocol/fo1',
      rkey: 'fo1',
      handle: 'bob',
      record: {
        $type: 'bio.cuanto.surveyProtocol' as const,
        title: 'Followed Only',
        description: 'Only in followed-protocols',
        createdAt:
          '2026-04-01T00:00:00.000Z' as `${string}-${string}-${string}T${string}:${string}:${string}Z`,
      },
      targets: [],
    };
    await setCachedFollowedProtocols([followedOnly]);
    const result = await getCachedProtocolByRkey('fo1');
    expect(result?.atUri).toBe(followedOnly.atUri);
    expect(result?.record.title).toBe(followedOnly.record.title);
  });

  test('cacheProtocol adds cachedAt timestamp', async () => {
    const before = Date.now();
    await cacheProtocol(cachedProtocol1);
    const result = await getCachedProtocolByRkey('cp1');
    expect(result?.cachedAt).toBeGreaterThanOrEqual(before);
  });
});

// ── followed-protocols store ──────────────────────────────────────────────────

const protocol1 = {
  atUri: 'at://did:test:1/bio.cuanto.surveyProtocol/fp1',
  rkey: 'fp1',
  handle: 'alice',
  record: {
    $type: 'bio.cuanto.surveyProtocol' as const,
    title: 'Protocol One',
    description: 'First protocol',
    createdAt:
      '2026-04-01T00:00:00.000Z' as `${string}-${string}-${string}T${string}:${string}:${string}Z`,
  },
  targets: [],
};

const protocol2 = {
  atUri: 'at://did:test:1/bio.cuanto.surveyProtocol/fp2',
  rkey: 'fp2',
  handle: 'alice',
  record: {
    $type: 'bio.cuanto.surveyProtocol' as const,
    title: 'Protocol Two',
    description: 'Second protocol',
    createdAt:
      '2026-04-01T00:00:00.000Z' as `${string}-${string}-${string}T${string}:${string}:${string}Z`,
  },
  targets: [],
};

describe('followed-protocols store', () => {
  test('returns empty array when store is cleared', async () => {
    await setCachedFollowedProtocols([]);
    const result = await getCachedFollowedProtocols();
    expect(result).toEqual([]);
  });

  test('stores and retrieves protocols', async () => {
    await setCachedFollowedProtocols([protocol1, protocol2]);
    const result = await getCachedFollowedProtocols();
    expect(result).toHaveLength(2);
    const uris = result.map((p) => p.atUri);
    expect(uris).toContain(protocol1.atUri);
    expect(uris).toContain(protocol2.atUri);
  });

  test('replaces all entries on subsequent call', async () => {
    await setCachedFollowedProtocols([protocol1, protocol2]);
    await setCachedFollowedProtocols([protocol1]);
    const result = await getCachedFollowedProtocols();
    expect(result).toHaveLength(1);
    expect(result[0].atUri).toBe(protocol1.atUri);
  });

  test('adds cachedAt timestamp to stored protocols', async () => {
    const before = Date.now();
    await setCachedFollowedProtocols([protocol1]);
    const result = await getCachedFollowedProtocols();
    expect(result[0].cachedAt).toBeGreaterThanOrEqual(before);
  });

  test('getCachedFollowedProtocolByRkey returns the matching protocol', async () => {
    await setCachedFollowedProtocols([protocol1, protocol2]);
    const result = await getCachedFollowedProtocolByRkey('fp1');
    expect(result?.atUri).toBe(protocol1.atUri);
  });

  test('getCachedFollowedProtocolByRkey returns undefined for unknown rkey', async () => {
    await setCachedFollowedProtocols([protocol1]);
    const result = await getCachedFollowedProtocolByRkey('no-such-rkey');
    expect(result).toBeUndefined();
  });

  test('addCachedFollowedProtocol adds a single protocol to the store', async () => {
    await setCachedFollowedProtocols([]);
    await addCachedFollowedProtocol(protocol1);
    const result = await getCachedFollowedProtocols();
    expect(result.map((p) => p.atUri)).toEqual([protocol1.atUri]);
  });

  test('removeCachedFollowedProtocol removes a single protocol from the store', async () => {
    await setCachedFollowedProtocols([protocol1, protocol2]);
    await removeCachedFollowedProtocol(protocol1.atUri);
    const result = await getCachedFollowedProtocols();
    expect(result.map((p) => p.atUri)).toEqual([protocol2.atUri]);
  });

  test('setCachedFollowedProtocols applies normally when no fetchStartedAt is given', async () => {
    await setCachedFollowedProtocols([]);
    await setCachedFollowedProtocols([protocol1]);
    const result = await getCachedFollowedProtocols();
    expect(result.map((p) => p.atUri)).toEqual([protocol1.atUri]);
  });

  test('setCachedFollowedProtocols is skipped when a direct mutation landed after fetchStartedAt', async () => {
    await setCachedFollowedProtocols([]);
    // -1 makes this deterministic instead of racing millisecond resolution
    // against the mutation below.
    const fetchStartedAt = Date.now() - 1;
    // Simulates a slower response: the sync's request started before this
    // mutation, so its (stale) results must not clobber it.
    await addCachedFollowedProtocol(protocol2);
    await setCachedFollowedProtocols([protocol1], fetchStartedAt);
    const result = await getCachedFollowedProtocols();
    expect(result.map((p) => p.atUri)).toEqual([protocol2.atUri]);
  });

  test('setCachedFollowedProtocols applies when fetchStartedAt is after the last mutation', async () => {
    await setCachedFollowedProtocols([]);
    await addCachedFollowedProtocol(protocol2);
    const fetchStartedAt = Date.now() + 1;
    await setCachedFollowedProtocols([protocol1], fetchStartedAt);
    const result = await getCachedFollowedProtocols();
    expect(result.map((p) => p.atUri)).toEqual([protocol1.atUri]);
  });
});

// ── pending-surveys store ─────────────────────────────────────────────────────

const pendingSurvey1: Omit<import('./db').PendingSurvey, 'id'> = {
  surveyRkey: 'aaaaaaaaaaaaa',
  protocolUri: 'at://did:test:1/bio.cuanto.surveyProtocol/p1',
  protocolRkey: 'p1',
  protocolTitle: 'whatever',
  locationName: 'Test Field',
  latitude: '37.7',
  longitude: '-122.4',
  eventDate: '2026-04-22',
  eventDurationValue: 60,
  eventDurationUnit: 'minutes',
  occurrences: [
    {
      surveyTargetUri: 'at://did:test:1/surveyTarget/t1',
      organismQuantity: '3',
    },
  ],
  publishPoint: true,
  publishBbox: true,
  publishTrack: false,
  createdAt: Date.now(),
  complete: true,
};

describe('pending-surveys store', () => {
  test('savePendingSurvey returns a numeric id', async () => {
    const id = await savePendingSurvey(pendingSurvey1);
    expect(typeof id).toBe('number');
  });

  test('getPendingSurveys returns saved surveys', async () => {
    const id = await savePendingSurvey(pendingSurvey1);
    const all = await getPendingSurveys();
    const saved = all.find((s) => s.id === id);
    expect(saved?.locationName).toBe(pendingSurvey1.locationName);
    expect(saved?.protocolUri).toBe(pendingSurvey1.protocolUri);
  });

  test('deletePendingSurvey removes the survey', async () => {
    const id = await savePendingSurvey(pendingSurvey1);
    await deletePendingSurvey(id);
    const all = await getPendingSurveys();
    expect(all.find((s) => s.id === id)).toBeUndefined();
  });

  test('savePendingSurvey stores complete: false for in-progress surveys', async () => {
    const id = await savePendingSurvey({ ...pendingSurvey1, complete: false });
    const all = await getPendingSurveys();
    const saved = all.find((s) => s.id === id);
    expect(saved?.complete).toBe(false);
    await deletePendingSurvey(id);
  });

  test('getPendingSurveyById returns the matching survey', async () => {
    const id = await savePendingSurvey(pendingSurvey1);
    const saved = await getPendingSurveyById(id);
    expect(saved?.id).toBe(id);
    expect(saved?.locationName).toBe(pendingSurvey1.locationName);
    await deletePendingSurvey(id);
  });

  test('getPendingSurveyById returns undefined for unknown id', async () => {
    const result = await getPendingSurveyById(99999);
    expect(result).toBeUndefined();
  });

  test('updatePendingSurvey updates a record in place', async () => {
    const id = await savePendingSurvey({ ...pendingSurvey1, complete: false });
    const saved = await getPendingSurveyById(id);
    if (saved?.id == null) throw new Error('expected saved record with id');
    await updatePendingSurvey({
      ...saved,
      id: saved.id,
      complete: true,
      locationName: 'Updated Field',
    });
    const updated = await getPendingSurveyById(id);
    expect(updated?.complete).toBe(true);
    expect(updated?.locationName).toBe('Updated Field');
    expect(updated?.id).toBe(id);
    await deletePendingSurvey(id);
  });

  test('getPendingSurveys defaults complete to true for legacy records without the field', async () => {
    // Simulate a pre-complete-field record by casting away the type
    const legacy = { ...pendingSurvey1 } as Record<string, unknown>;
    delete legacy.complete;
    const id = await savePendingSurvey(
      legacy as Omit<import('./db').PendingSurvey, 'id'>,
    );
    const all = await getPendingSurveys();
    const migrated = all.find((s) => s.id === id);
    expect(migrated?.complete).toBe(true);
    await deletePendingSurvey(id);
  });

  test('getPendingSurveys defaults incidentals to [] for legacy records without the field', async () => {
    const legacy = { ...pendingSurvey1 } as Record<string, unknown>;
    delete legacy.incidentals;
    const id = await savePendingSurvey(
      legacy as Omit<import('./db').PendingSurvey, 'id'>,
    );
    const all = await getPendingSurveys();
    const migrated = all.find((s) => s.id === id);
    expect(migrated?.incidentals).toEqual([]);
    await deletePendingSurvey(id);
  });

  test('getPendingSurveys migrates legacy publishGeo=true into publishPoint+Bbox=true, publishTrack=false', async () => {
    const legacy = { ...pendingSurvey1 } as Record<string, unknown>;
    delete legacy.publishPoint;
    delete legacy.publishBbox;
    delete legacy.publishTrack;
    legacy.publishGeo = true;
    const id = await savePendingSurvey(
      legacy as Omit<import('./db').PendingSurvey, 'id'>,
    );
    const all = await getPendingSurveys();
    const migrated = all.find((s) => s.id === id);
    expect(migrated?.publishPoint).toBe(true);
    expect(migrated?.publishBbox).toBe(true);
    expect(migrated?.publishTrack).toBe(false);
    expect((migrated as { publishGeo?: boolean }).publishGeo).toBeUndefined();
    await deletePendingSurvey(id);
  });

  test('getPendingSurveys migrates legacy publishGeo=false into all three flags false', async () => {
    const legacy = { ...pendingSurvey1 } as Record<string, unknown>;
    delete legacy.publishPoint;
    delete legacy.publishBbox;
    delete legacy.publishTrack;
    legacy.publishGeo = false;
    const id = await savePendingSurvey(
      legacy as Omit<import('./db').PendingSurvey, 'id'>,
    );
    const all = await getPendingSurveys();
    const migrated = all.find((s) => s.id === id);
    expect(migrated?.publishPoint).toBe(false);
    expect(migrated?.publishBbox).toBe(false);
    expect(migrated?.publishTrack).toBe(false);
    expect((migrated as { publishGeo?: boolean }).publishGeo).toBeUndefined();
    await deletePendingSurvey(id);
  });
});

// ── cached-surveys store ──────────────────────────────────────────────────────

const survey1 = {
  atUri: 'at://did:test:1/bio.cuanto.survey/cs1',
  did: 'did:test:1',
  rkey: 'cs1',
  handle: 'bob',
  protocolHandle: 'alice',
  protocolRkey: 'proto1',
  protocolTitle: 'Bird Count',
  record: {
    $type: 'bio.cuanto.survey' as const,
    protocol: {
      uri: 'at://did:test:1/bio.cuanto.surveyProtocol/sp1' as `at://did:${string}:${string}/${string}.${string}.${string}/${string}`,
      cid: 'bafycid1' as `bafy${string}`,
    },
    createdAt:
      '2026-04-01T00:00:00.000Z' as `${string}-${string}-${string}T${string}:${string}:${string}Z`,
    eventDate: '2026-04-01T00:00:00.000Z',
    eventDurationValue: 30,
    eventDurationUnit: 'minutes',
    location: { $type: 'org.atgeo.place' as const, name: 'Test Park' },
  },
  occurrences: [
    {
      atUri: 'at://did:test:1/bio.lexicons.temp.v0-1.occurrence/o1',
      record: {
        $type: 'bio.lexicons.temp.v0-1.occurrence' as const,
        eventID:
          'at://did:test:1/bio.cuanto.survey/cs1' as `at://did:${string}:${string}/${string}.${string}.${string}/${string}`,
        surveyTargetID:
          'at://did:test:1/bio.cuanto.protocolTarget/st1' as `at://did:${string}:${string}/${string}.${string}.${string}/${string}`,
        organismQuantity: '5',
        organismQuantityType: 'individuals',
      },
    },
  ],
};

describe('cached-surveys store', () => {
  test('stores and retrieves a survey by atUri', async () => {
    await cacheSurvey(survey1);
    const result = await getCachedSurvey(survey1.atUri);
    expect(result?.atUri).toBe(survey1.atUri);
    expect(result?.protocolTitle).toBe(survey1.protocolTitle);
    expect(result?.occurrences).toHaveLength(1);
  });

  test('returns undefined for unknown atUri', async () => {
    const result = await getCachedSurvey(
      'at://did:unknown/bio.cuanto.survey/missing',
    );
    expect(result).toBeUndefined();
  });

  test('getCachedSurveys returns stored surveys', async () => {
    const survey2 = {
      ...survey1,
      atUri: 'at://did:test:1/bio.cuanto.survey/cs2',
      rkey: 'cs2',
    };
    await cacheSurvey(survey1);
    await cacheSurvey(survey2);
    const all = await getCachedSurveys();
    const uris = all.map((s) => s.atUri);
    expect(uris).toContain(survey1.atUri);
    expect(uris).toContain(survey2.atUri);
  });

  test('adds cachedAt timestamp when storing', async () => {
    const before = Date.now();
    await cacheSurvey(survey1);
    const result = await getCachedSurvey(survey1.atUri);
    expect(result?.cachedAt).toBeGreaterThanOrEqual(before);
  });

  test('getCachedSurveyByRkey returns the matching survey', async () => {
    await cacheSurvey(survey1);
    const result = await getCachedSurveyByRkey(survey1.rkey);
    expect(result?.atUri).toBe(survey1.atUri);
    expect(result?.protocolTitle).toBe(survey1.protocolTitle);
  });

  test('getCachedSurveyByRkey returns undefined for unknown rkey', async () => {
    const result = await getCachedSurveyByRkey('does-not-exist');
    expect(result).toBeUndefined();
  });

  test('occurrence record fields are preserved', async () => {
    await cacheSurvey(survey1);
    const result = await getCachedSurvey(survey1.atUri);
    expect(result?.occurrences[0].record.organismQuantity).toBe('5');
    expect(result?.occurrences[0].record.surveyTargetID).toBe(
      survey1.occurrences[0].record.surveyTargetID,
    );
  });
});

// ── clearIdb ──────────────────────────────────────────────────────────────────

describe('clearIdb', () => {
  test('wipes all stores', async () => {
    await saveIdbUser({ did: 'did:test:clear', handle: 'cleartest' });
    await cacheProtocol(cachedProtocol1);
    await setCachedFollowedProtocols([protocol1]);
    await savePendingSurvey(pendingSurvey1);
    await cacheSurvey(survey1);

    await clearIdb();

    expect(await getIdbUser()).toBeUndefined();
    expect(await getCachedProtocols()).toHaveLength(0);
    expect(await getCachedFollowedProtocols()).toHaveLength(0);
    expect(await getPendingSurveys()).toHaveLength(0);
    expect(await getCachedSurveys()).toHaveLength(0);
  });
});
