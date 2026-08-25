import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db/survey-protocols', () => ({
  insertProtocol: vi.fn(),
  insertProtocolTarget: vi.fn(),
  tombstoneProtocolTargetsByUris: vi.fn(),
}));

// backfillProtocol wraps its writes in sql.begin; stand in a fake transaction
// handle ('tx') so tests can assert insertProtocol/insertProtocolTarget were
// called with it rather than the default connection.
vi.mock('$lib/server/db', () => ({
  default: { begin: vi.fn((cb: (tx: unknown) => unknown) => cb('tx')) },
}));

vi.mock('$lib/server/db/surveys', () => ({
  insertSurvey: vi.fn(),
  insertOccurrence: vi.fn(),
  deleteOccurrenceByAtUri: vi.fn(),
  countOccurrencesBySurveyTargetUri: vi.fn(),
}));

// Hoisted so the vi.mock factory below can close over it: every log.child()
// call returns this same object, so tests can assert on what was logged.
const { logMock } = vi.hoisted(() => ({
  logMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('$lib/server/logger', () => ({
  default: { child: () => logMock },
}));

vi.mock('$lib/server/db/protocol-follows', () => ({
  createFollow: vi.fn(),
  deleteFollow: vi.fn(),
}));

vi.mock('$lib/server/db/survey-targets', () => ({
  insertSurveyTarget: vi.fn(),
  tombstoneSurveyTargetByUri: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({
  env: { TAP_ADMIN_PASSWORD: 'testpassword' },
}));

vi.mock('$lib/server/pds', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    fetchAtRecord: vi.fn(),
    resolveHandle: vi.fn(),
    listAtRecords: vi.fn(),
  };
});

vi.mock('$lib/server/db/users', () => ({
  insertUser: vi.fn(),
}));

vi.mock('$lib/server/db/identifications', () => ({
  insertIdentification: vi.fn(),
  deleteIdentificationsByOccurrenceUris: vi.fn(() => Promise.resolve([])),
  deleteIdentificationByAtUri: vi.fn(),
}));

import {
  deleteIdentificationByAtUri,
  deleteIdentificationsByOccurrenceUris,
  insertIdentification,
} from '$lib/server/db/identifications';
import { createFollow, deleteFollow } from '$lib/server/db/protocol-follows';
import {
  insertProtocol,
  insertProtocolTarget,
  tombstoneProtocolTargetsByUris,
} from '$lib/server/db/survey-protocols';
import {
  insertSurveyTarget,
  tombstoneSurveyTargetByUri,
} from '$lib/server/db/survey-targets';
import {
  countOccurrencesBySurveyTargetUri,
  deleteOccurrenceByAtUri,
  insertOccurrence,
  insertSurvey,
} from '$lib/server/db/surveys';
import { insertUser } from '$lib/server/db/users';
import { fetchAtRecord, listAtRecords, resolveHandle } from '$lib/server/pds';
import { POST } from './+server';

const VALID_AUTH = `Basic ${btoa('admin:testpassword')}`;
const TEST_CID = 'bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a';

const makeRequest = (body: unknown, auth?: string) =>
  new Request('http://localhost/api/tap/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth !== undefined ? { Authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  });

const protocolEvent = {
  id: 1,
  type: 'record',
  record: {
    did: 'did:plc:abc123',
    rev: 'abc',
    collection: 'bio.cuanto.surveyProtocol',
    rkey: '3abc',
    action: 'create',
    record: {
      $type: 'bio.cuanto.surveyProtocol',
      title: 'Test Protocol',
      description: 'A test',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    cid: TEST_CID,
    live: true,
  },
};

const targetEvent = {
  id: 2,
  type: 'record',
  record: {
    did: 'did:plc:abc123',
    rev: 'abc',
    collection: 'bio.cuanto.protocolTarget',
    rkey: '3def',
    action: 'create',
    record: {
      $type: 'bio.cuanto.protocolTarget',
      protocol: 'at://did:plc:abc123/bio.cuanto.surveyProtocol/3abc',
      scope: [
        {
          $type: 'bio.cuanto.protocolTarget#verbatimScope',
          verbatimTargetScope: 'trees',
        },
      ],
    },
    cid: TEST_CID,
    live: true,
  },
};

const surveyTargetEvent = {
  id: 9,
  type: 'record',
  record: {
    did: 'did:plc:abc123',
    rev: 'revabc',
    collection: 'bio.cuanto.surveyTarget',
    rkey: '3tgt',
    action: 'create',
    record: {
      $type: 'bio.cuanto.surveyTarget',
      protocol: 'at://did:plc:abc123/bio.cuanto.surveyProtocol/3abc',
      protocolTargetID: 'at://did:plc:abc123/bio.cuanto.protocolTarget/3def',
      createdAt: '2026-01-01T00:00:00.000Z',
      scope: [],
    },
    cid: TEST_CID,
    live: true,
  },
};

const surveyEvent = {
  id: 3,
  type: 'record',
  record: {
    did: 'did:plc:abc123',
    rev: 'abc',
    collection: 'bio.cuanto.survey',
    rkey: '3svy',
    action: 'create',
    record: {
      $type: 'bio.cuanto.survey',
      protocol: {
        uri: 'at://did:plc:abc123/bio.cuanto.surveyProtocol/3abc',
        cid: TEST_CID,
      },
      createdAt: '2026-04-13T10:00:00.000Z',
      eventDate: '2026-04-13T10:00:00.000Z',
      eventDurationValue: 30,
      eventDurationUnit: 'minutes',
      location: { $type: 'org.atgeo.place', name: 'Test Park' },
    },
    cid: TEST_CID,
    live: true,
  },
};

const occurrenceEvent = {
  id: 4,
  type: 'record',
  record: {
    did: 'did:plc:abc123',
    rev: 'abc',
    collection: 'bio.lexicons.temp.v0-1.occurrence',
    rkey: '3occ',
    action: 'create',
    record: {
      $type: 'bio.lexicons.temp.v0-1.occurrence',
      eventID: 'at://did:plc:abc123/bio.cuanto.survey/3svy',
      surveyTargetID: 'at://did:plc:abc123/bio.cuanto.protocolTarget/3def',
      organismQuantity: '3',
      organismQuantityType: 'individuals',
    },
    cid: TEST_CID,
    live: true,
  },
};

const followCreateEvent = {
  id: 5,
  type: 'record',
  record: {
    did: 'did:plc:follower',
    rev: 'abc',
    collection: 'bio.cuanto.surveyProtocol.follow',
    rkey: '3flw',
    action: 'create',
    record: {
      $type: 'bio.cuanto.surveyProtocol.follow',
      subject: 'at://did:plc:abc123/bio.cuanto.surveyProtocol/3abc',
      createdAt: '2026-04-15T00:00:00.000Z',
    },
    cid: TEST_CID,
    live: true,
  },
};

const followDeleteEvent = {
  id: 6,
  type: 'record',
  record: {
    did: 'did:plc:follower',
    rev: 'abc',
    collection: 'bio.cuanto.surveyProtocol.follow',
    rkey: '3flw',
    action: 'delete',
    record: undefined,
    cid: TEST_CID,
    live: true,
  },
};

const identificationEvent = {
  id: 8,
  type: 'record',
  record: {
    did: 'did:plc:abc123',
    rev: 'abc',
    collection: 'bio.lexicons.temp.v0-1.identification',
    rkey: '3ident',
    action: 'create',
    record: {
      $type: 'bio.lexicons.temp.v0-1.identification',
      occurrence: {
        uri: 'at://did:plc:abc123/bio.lexicons.temp.v0-1.occurrence/3occ',
        cid: TEST_CID,
      },
      scientificName: 'Quercus agrifolia',
      taxonRank: 'species',
    },
    cid: TEST_CID,
    live: true,
  },
};

const identityEvent = {
  id: 7,
  type: 'identity',
  identity: {
    did: 'did:plc:abc123',
    handle: 'test.bsky.social',
    is_active: true,
    status: 'active',
  },
};

describe('POST /api/tap/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns 401 for missing Authorization header', async () => {
    const resp = await POST({
      request: makeRequest(protocolEvent),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(401);
  });

  test('returns 401 for wrong password', async () => {
    const resp = await POST({
      request: makeRequest(
        protocolEvent,
        `Basic ${btoa('admin:wrongpassword')}`,
      ),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(401);
  });

  test('calls insertProtocol for a surveyProtocol update event', async () => {
    const updateEvent = {
      ...protocolEvent,
      record: { ...protocolEvent.record, action: 'update' },
    };
    const resp = await POST({
      request: makeRequest(updateEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertProtocol).toHaveBeenCalled();
  });

  test('calls insertProtocol for a surveyProtocol create event', async () => {
    const resp = await POST({
      request: makeRequest(protocolEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertProtocol).toHaveBeenCalledWith(
      'did:plc:abc123',
      '3abc',
      protocolEvent.record.record,
      'at://did:plc:abc123/bio.cuanto.surveyProtocol/3abc',
      TEST_CID,
    );
    expect(insertProtocolTarget).not.toHaveBeenCalled();
  });

  test('calls insertProtocolTarget for a protocolTarget update event', async () => {
    const updateEvent = {
      ...targetEvent,
      record: { ...targetEvent.record, action: 'update' },
    };
    const resp = await POST({
      request: makeRequest(updateEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertProtocolTarget).toHaveBeenCalled();
  });

  test('calls insertProtocolTarget for a protocolTarget create event', async () => {
    const resp = await POST({
      request: makeRequest(targetEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertProtocolTarget).toHaveBeenCalledWith(
      'did:plc:abc123',
      '3def',
      targetEvent.record.record,
      'at://did:plc:abc123/bio.cuanto.protocolTarget/3def',
    );
    expect(insertProtocol).not.toHaveBeenCalled();
  });

  test('calls tombstoneProtocolTargetsByUris for a protocolTarget delete event', async () => {
    const deleteEvent = {
      ...targetEvent,
      record: { ...targetEvent.record, action: 'delete', record: undefined },
    };
    const resp = await POST({
      request: makeRequest(deleteEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(tombstoneProtocolTargetsByUris).toHaveBeenCalledWith([
      'at://did:plc:abc123/bio.cuanto.protocolTarget/3def',
    ]);
    expect(insertProtocolTarget).not.toHaveBeenCalled();
  });

  test('calls insertSurveyTarget with the event rev for a surveyTarget create event', async () => {
    const resp = await POST({
      request: makeRequest(surveyTargetEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    // evt.rev is threaded through so insertSurveyTarget's staleness guard can
    // reject an out-of-order/replayed event instead of clobbering a newer
    // retired_at with an older one.
    expect(insertSurveyTarget).toHaveBeenCalledWith(
      'did:plc:abc123',
      '3tgt',
      surveyTargetEvent.record.record,
      'at://did:plc:abc123/bio.cuanto.surveyTarget/3tgt',
      'at://did:plc:abc123/bio.cuanto.protocolTarget/3def',
      'revabc',
    );
  });

  const surveyTargetDeleteEvent = {
    ...surveyTargetEvent,
    record: {
      ...surveyTargetEvent.record,
      action: 'delete',
      record: undefined,
    },
  };

  test('calls tombstoneSurveyTargetByUri with the event rev for a surveyTarget delete event', async () => {
    const resp = await POST({
      request: makeRequest(surveyTargetDeleteEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    // evt.rev is threaded through for the same reason the create path does it:
    // now that the delete tombstones rather than removes the row (issue #41), a
    // replayed delete could otherwise re-tombstone a record a newer create
    // already revived.
    expect(tombstoneSurveyTargetByUri).toHaveBeenCalledWith(
      'at://did:plc:abc123/bio.cuanto.surveyTarget/3tgt',
      'revabc',
    );
    expect(insertSurveyTarget).not.toHaveBeenCalled();
  });

  // Issue #41, decision 4: the tombstone is what actually preserves the data,
  // but a delete that would have severed real detections is worth surfacing.
  test('warns when the deleted surveyTarget had occurrences', async () => {
    vi.mocked(countOccurrencesBySurveyTargetUri).mockResolvedValue(2);
    const resp = await POST({
      request: makeRequest(surveyTargetDeleteEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(logMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        atUri: 'at://did:plc:abc123/bio.cuanto.surveyTarget/3tgt',
        occurrences: 2,
      }),
      expect.any(String),
    );
  });

  test('does not warn when the deleted surveyTarget had no occurrences', async () => {
    vi.mocked(countOccurrencesBySurveyTargetUri).mockResolvedValue(0);
    const resp = await POST({
      request: makeRequest(surveyTargetDeleteEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(logMock.warn).not.toHaveBeenCalled();
  });

  test('calls insertSurvey for a survey update event', async () => {
    const updateEvent = {
      ...surveyEvent,
      record: { ...surveyEvent.record, action: 'update' },
    };
    const resp = await POST({
      request: makeRequest(updateEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertSurvey).toHaveBeenCalled();
  });

  test('calls insertSurvey for a survey create event', async () => {
    const resp = await POST({
      request: makeRequest(surveyEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertSurvey).toHaveBeenCalledWith(
      'did:plc:abc123',
      '3svy',
      surveyEvent.record.record,
      'at://did:plc:abc123/bio.cuanto.survey/3svy',
    );
  });

  test('fetches and inserts occurrences for a live survey create event', async () => {
    vi.mocked(listAtRecords).mockResolvedValueOnce([
      {
        uri: 'at://did:plc:abc123/bio.lexicons.temp.v0-1.occurrence/3occ',
        cid: TEST_CID,
        value: {
          $type: 'bio.lexicons.temp.v0-1.occurrence',
          eventID: 'at://did:plc:abc123/bio.cuanto.survey/3svy',
          organismQuantity: '1',
          organismQuantityType: 'individuals',
        },
      },
    ]);
    const resp = await POST({
      request: makeRequest(surveyEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(listAtRecords).toHaveBeenCalledWith(
      'did:plc:abc123',
      'bio.lexicons.temp.v0-1.occurrence',
    );
    expect(insertOccurrence).toHaveBeenCalledOnce();
  });

  test('calls insertOccurrence for an occurrence update event', async () => {
    const updateEvent = {
      ...occurrenceEvent,
      record: { ...occurrenceEvent.record, action: 'update' },
    };
    const resp = await POST({
      request: makeRequest(updateEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertOccurrence).toHaveBeenCalled();
  });

  test('calls insertOccurrence for an occurrence create event', async () => {
    const resp = await POST({
      request: makeRequest(occurrenceEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertOccurrence).toHaveBeenCalledWith(
      'did:plc:abc123',
      '3occ',
      occurrenceEvent.record.record,
      'at://did:plc:abc123/bio.lexicons.temp.v0-1.occurrence/3occ',
    );
  });

  test('calls deleteOccurrenceByAtUri for an occurrence delete event', async () => {
    const deleteEvent = {
      ...occurrenceEvent,
      record: {
        ...occurrenceEvent.record,
        action: 'delete',
        record: undefined,
      },
    };
    const resp = await POST({
      request: makeRequest(deleteEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    const occUri = 'at://did:plc:abc123/bio.lexicons.temp.v0-1.occurrence/3occ';
    expect(deleteIdentificationsByOccurrenceUris).toHaveBeenCalledWith([
      occUri,
    ]);
    expect(deleteOccurrenceByAtUri).toHaveBeenCalledWith(occUri);
    // Dependent identifications must be removed before the occurrence, or the
    // occurrence delete fails the identifications_occurrence_uri_fkey constraint.
    const idOrder = (
      deleteIdentificationsByOccurrenceUris as ReturnType<typeof vi.fn>
    ).mock.invocationCallOrder[0];
    const occOrder = (deleteOccurrenceByAtUri as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(idOrder).toBeLessThan(occOrder);
    expect(insertOccurrence).not.toHaveBeenCalled();
  });

  test('returns 200 without inserting for a delete operation', async () => {
    const deleteEvent = {
      ...protocolEvent,
      record: { ...protocolEvent.record, action: 'delete', record: undefined },
    };
    const resp = await POST({
      request: makeRequest(deleteEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertProtocol).not.toHaveBeenCalled();
  });

  test('does not call insertProtocol or insertProtocolTarget for an identity event', async () => {
    const resp = await POST({
      request: makeRequest(identityEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertProtocol).not.toHaveBeenCalled();
    expect(insertProtocolTarget).not.toHaveBeenCalled();
  });

  test('returns 200 without inserting for an unrecognised collection', async () => {
    const unknownEvent = {
      ...protocolEvent,
      record: { ...protocolEvent.record, collection: 'app.bsky.feed.post' },
    };
    const resp = await POST({
      request: makeRequest(unknownEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertProtocol).not.toHaveBeenCalled();
    expect(insertProtocolTarget).not.toHaveBeenCalled();
  });

  test('calls createFollow for a follow create event', async () => {
    const resp = await POST({
      request: makeRequest(followCreateEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(createFollow).toHaveBeenCalledWith({
      atUri: 'at://did:plc:follower/bio.cuanto.surveyProtocol.follow/3flw',
      did: 'did:plc:follower',
      rkey: '3flw',
      protocolUri: 'at://did:plc:abc123/bio.cuanto.surveyProtocol/3abc',
      createdAt: '2026-04-15T00:00:00.000Z',
    });
    expect(deleteFollow).not.toHaveBeenCalled();
  });

  test('calls deleteFollow for a follow delete event', async () => {
    const resp = await POST({
      request: makeRequest(followDeleteEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(deleteFollow).toHaveBeenCalledWith(
      'at://did:plc:follower/bio.cuanto.surveyProtocol.follow/3flw',
    );
    expect(createFollow).not.toHaveBeenCalled();
  });

  test('returns 200 when createFollow throws unique violation (duplicate follow)', async () => {
    vi.mocked(createFollow).mockRejectedValueOnce(uniqueError);
    const resp = await POST({
      request: makeRequest(followCreateEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
  });

  test('calls insertUser for identity events', async () => {
    const resp = await POST({
      request: makeRequest(identityEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertUser).toHaveBeenCalledWith(
      'did:plc:abc123',
      'test.bsky.social',
      null,
    );
    expect(resolveHandle).not.toHaveBeenCalled();
  });

  test('does not call insertUser when resolveHandle returns null', async () => {
    vi.mocked(resolveHandle).mockResolvedValueOnce(null);
    const resp = await POST({
      request: makeRequest(protocolEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertUser).not.toHaveBeenCalled();
    expect(insertProtocol).toHaveBeenCalled();
  });

  test('resolves handle and calls insertUser before insertProtocol', async () => {
    vi.mocked(resolveHandle).mockResolvedValueOnce('test.bsky.social');
    const resp = await POST({
      request: makeRequest(protocolEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(resolveHandle).toHaveBeenCalledWith('did:plc:abc123');
    expect(insertUser).toHaveBeenCalledWith(
      'did:plc:abc123',
      'test.bsky.social',
      null,
    );
    expect(insertProtocol).toHaveBeenCalled();
  });

  test('resolves handle and calls insertUser before insertSurvey', async () => {
    vi.mocked(resolveHandle).mockResolvedValueOnce('test.bsky.social');
    const resp = await POST({
      request: makeRequest(surveyEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(resolveHandle).toHaveBeenCalledWith('did:plc:abc123');
    expect(insertUser).toHaveBeenCalledWith(
      'did:plc:abc123',
      'test.bsky.social',
      null,
    );
    expect(insertSurvey).toHaveBeenCalled();
  });

  const fkError = Object.assign(new Error('FK violation'), { code: '23503' });
  const uniqueError = Object.assign(new Error('unique violation'), {
    code: '23505',
  });

  const fetchedProtocolRecord = {
    uri: 'at://did:plc:abc123/bio.cuanto.surveyProtocol/3abc',
    cid: TEST_CID,
    value: {
      $type: 'bio.cuanto.surveyProtocol',
      title: 'Test Protocol',
      description: 'A test',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };

  const fetchedSurveyRecord = {
    uri: 'at://did:plc:abc123/bio.cuanto.survey/3svy',
    cid: TEST_CID,
    value: {
      $type: 'bio.cuanto.survey',
      protocol: {
        uri: 'at://did:plc:abc123/bio.cuanto.surveyProtocol/3abc',
        cid: TEST_CID,
      },
      createdAt: '2026-04-13T10:00:00.000Z',
      eventDate: '2026-04-13T10:00:00.000Z',
      eventDurationValue: 30,
      eventDurationUnit: 'minutes',
      location: { $type: 'org.atgeo.place', name: 'Test Park' },
    },
  };

  test('backfills missing protocol when insertProtocolTarget gets FK violation', async () => {
    vi.mocked(insertProtocolTarget).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(fetchedProtocolRecord);
    const resp = await POST({
      request: makeRequest(targetEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(fetchAtRecord).toHaveBeenCalledWith(
      'at://did:plc:abc123/bio.cuanto.surveyProtocol/3abc',
    );
    expect(insertProtocol).toHaveBeenCalledWith(
      'did:plc:abc123',
      '3abc',
      fetchedProtocolRecord.value,
      fetchedProtocolRecord.uri,
      TEST_CID,
      'tx',
    );
    expect(insertProtocolTarget).toHaveBeenCalledTimes(2);
  });

  test('backfills missing protocol when insertSurvey gets FK violation', async () => {
    vi.mocked(insertSurvey).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(fetchedProtocolRecord);
    const resp = await POST({
      request: makeRequest(surveyEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(fetchAtRecord).toHaveBeenCalledWith(
      'at://did:plc:abc123/bio.cuanto.surveyProtocol/3abc',
    );
    expect(insertProtocol).toHaveBeenCalledOnce();
    expect(insertSurvey).toHaveBeenCalledTimes(2);
  });

  test('does not backfill a protocol when the fetched record has an unexpected $type', async () => {
    // Regression for #22: an eventID/protocol URI can resolve to a record from
    // an unexpected (e.g. migrated) collection. backfillProtocol must not insert
    // a non-surveyProtocol record as a protocol.
    vi.mocked(insertSurvey).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce({
      uri: 'at://did:plc:abc123/bio.cuanto.surveyProtocol/3abc',
      cid: TEST_CID,
      value: {
        // Wrong $type for a protocol URI.
        $type: 'bio.cuanto.survey',
        protocol: { uri: 'at://x', cid: TEST_CID },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const resp = await POST({
      request: makeRequest(surveyEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertProtocol).not.toHaveBeenCalled();
  });

  test('does not backfill a survey when the fetched record has an unexpected $type', async () => {
    // Regression for #22: an occurrence eventID can point at a record from an
    // unexpected collection. backfillSurvey must not insert a non-survey record
    // as a survey (this is what duplicated every survey in production).
    vi.mocked(insertOccurrence).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce({
      uri: 'at://did:plc:abc123/bio.cuanto.survey/3svy',
      cid: TEST_CID,
      value: {
        // Wrong $type for a survey URI.
        $type: 'bio.lexicons.temp.v0-1.occurrence',
        eventID: 'at://did:plc:abc123/bio.cuanto.survey/3svy',
      },
    });
    const resp = await POST({
      request: makeRequest(occurrenceEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertSurvey).not.toHaveBeenCalled();
    // The survey backfill was skipped, so the occurrence's survey FK can't be
    // satisfied: insertOccurrence must not be retried and the occurrence is not
    // ingested (only the initial failing attempt happened).
    expect(insertOccurrence).toHaveBeenCalledTimes(1);
  });

  test('does not backfill an occurrence when the fetched record has an unexpected $type', async () => {
    // Regression for #22: an identification's occurrence.uri can resolve to a
    // record from an unexpected collection. backfill must not insert a
    // non-occurrence record into the occurrences table.
    vi.mocked(insertIdentification).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce({
      uri: 'at://did:plc:abc123/bio.lexicons.temp.v0-1.occurrence/3occ',
      cid: TEST_CID,
      value: {
        // Wrong $type for an occurrence URI.
        $type: 'bio.cuanto.survey',
        protocol: { uri: 'at://x', cid: TEST_CID },
      },
    });
    const resp = await POST({
      request: makeRequest(identificationEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertOccurrence).not.toHaveBeenCalled();
  });

  test('backfills missing survey when insertOccurrence gets FK violation', async () => {
    vi.mocked(insertOccurrence).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(fetchedSurveyRecord);
    const resp = await POST({
      request: makeRequest(occurrenceEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(fetchAtRecord).toHaveBeenCalledWith(
      'at://did:plc:abc123/bio.cuanto.survey/3svy',
    );
    expect(insertSurvey).toHaveBeenCalledOnce();
    expect(insertOccurrence).toHaveBeenCalledTimes(2);
  });

  const fetchedTargetRecord = {
    uri: 'at://did:plc:abc123/bio.cuanto.protocolTarget/3def',
    cid: TEST_CID,
    value: {
      $type: 'bio.cuanto.protocolTarget',
      protocol: 'at://did:plc:abc123/bio.cuanto.surveyProtocol/3abc',
      scope: [],
    },
  };

  const fetchedOccurrenceRecord = {
    uri: 'at://did:plc:abc123/bio.lexicons.temp.v0-1.occurrence/3occ',
    cid: TEST_CID,
    value: {
      $type: 'bio.lexicons.temp.v0-1.occurrence',
      eventID: 'at://did:plc:abc123/bio.cuanto.survey/3svy',
      surveyTargetID: 'at://did:plc:abc123/bio.cuanto.protocolTarget/3def',
      organismQuantity: '3',
      organismQuantityType: 'individuals',
    },
  };

  test('backfillProtocol also inserts related targets', async () => {
    vi.mocked(insertProtocolTarget).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(fetchedProtocolRecord);
    vi.mocked(listAtRecords).mockResolvedValueOnce([fetchedTargetRecord]);
    const resp = await POST({
      request: makeRequest(targetEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(listAtRecords).toHaveBeenCalledWith(
      'did:plc:abc123',
      'bio.cuanto.protocolTarget',
    );
    expect(insertProtocolTarget).toHaveBeenCalledTimes(3); // 1 fail + 1 backfill + 1 retry
  });

  test('backfillProtocol inserts the protocol and its targets inside one transaction', async () => {
    vi.mocked(insertProtocolTarget).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(fetchedProtocolRecord);
    vi.mocked(listAtRecords).mockResolvedValueOnce([fetchedTargetRecord]);
    const resp = await POST({
      request: makeRequest(targetEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);

    // The original (pre-backfill) attempt uses the default connection.
    expect(insertProtocolTarget).toHaveBeenNthCalledWith(
      1,
      'did:plc:abc123',
      '3def',
      targetEvent.record.record,
      'at://did:plc:abc123/bio.cuanto.protocolTarget/3def',
    );
    // backfillProtocol's own writes are routed through the same transaction
    // handle ('tx'), so a failed target insert can't leave a committed
    // protocol row with zero targets (see materialize-targets.ts's
    // reconcileRetirements, which would otherwise mass-retire every
    // surveyor's targets on seeing that empty state).
    expect(insertProtocol).toHaveBeenCalledWith(
      'did:plc:abc123',
      '3abc',
      fetchedProtocolRecord.value,
      fetchedProtocolRecord.uri,
      TEST_CID,
      'tx',
    );
    expect(insertProtocolTarget).toHaveBeenNthCalledWith(
      2,
      'did:plc:abc123',
      '3def',
      fetchedTargetRecord.value,
      fetchedTargetRecord.uri,
      'tx',
    );
  });

  test('backfillSurvey also inserts related occurrences', async () => {
    vi.mocked(insertOccurrence).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(fetchedSurveyRecord);
    vi.mocked(listAtRecords).mockResolvedValueOnce([fetchedOccurrenceRecord]);
    const resp = await POST({
      request: makeRequest(occurrenceEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(listAtRecords).toHaveBeenCalledWith(
      'did:plc:abc123',
      'bio.lexicons.temp.v0-1.occurrence',
    );
    expect(insertOccurrence).toHaveBeenCalledTimes(3); // 1 fail + 1 backfill + 1 retry
  });

  test('nested backfill: backfills survey and protocol when survey is also missing', async () => {
    vi.mocked(insertOccurrence).mockRejectedValueOnce(fkError);
    vi.mocked(insertSurvey).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord)
      .mockResolvedValueOnce(fetchedSurveyRecord)
      .mockResolvedValueOnce(fetchedProtocolRecord);
    const resp = await POST({
      request: makeRequest(occurrenceEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(fetchAtRecord).toHaveBeenNthCalledWith(
      1,
      'at://did:plc:abc123/bio.cuanto.survey/3svy',
    );
    expect(fetchAtRecord).toHaveBeenNthCalledWith(
      2,
      'at://did:plc:abc123/bio.cuanto.surveyProtocol/3abc',
    );
    expect(insertProtocol).toHaveBeenCalledOnce();
    expect(insertSurvey).toHaveBeenCalledTimes(2);
    expect(insertOccurrence).toHaveBeenCalledTimes(2);
  });

  // Regression for #43: backfillSurvey can report success while the
  // occurrence's FK is still unsatisfiable (root cause undetermined), so the
  // retry after a "successful" backfill must not be allowed to 500.
  test('returns 200 and skips ingestion when the occurrence retry still violates the FK after a successful survey backfill', async () => {
    vi.mocked(insertOccurrence)
      .mockRejectedValueOnce(fkError)
      .mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(fetchedSurveyRecord);
    vi.mocked(listAtRecords).mockResolvedValueOnce([]);
    const resp = await POST({
      request: makeRequest(occurrenceEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertSurvey).toHaveBeenCalledOnce();
    expect(insertOccurrence).toHaveBeenCalledTimes(2); // 1 fail + 1 failed retry
    expect(logMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        atUri: 'at://did:plc:abc123/bio.lexicons.temp.v0-1.occurrence/3occ',
        surveyUri: 'at://did:plc:abc123/bio.cuanto.survey/3svy',
      }),
      expect.stringContaining('skipping ingestion'),
    );
  });

  // Regression for #43: the insertSurvey retry inside backfillSurvey, after a
  // successful protocol backfill, is equally capable of hitting an
  // unsatisfiable FK and must not be allowed to 500 either.
  test('returns 200 and skips ingestion when the survey retry still violates the FK after a successful protocol backfill', async () => {
    vi.mocked(insertOccurrence).mockRejectedValueOnce(fkError);
    vi.mocked(insertSurvey)
      .mockRejectedValueOnce(fkError)
      .mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord)
      .mockResolvedValueOnce(fetchedSurveyRecord)
      .mockResolvedValueOnce(fetchedProtocolRecord);
    const resp = await POST({
      request: makeRequest(occurrenceEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertProtocol).toHaveBeenCalledOnce();
    expect(insertSurvey).toHaveBeenCalledTimes(2);
    // The survey backfill ultimately failed, so the occurrence FK can't be
    // satisfied and the retry must not be attempted.
    expect(insertOccurrence).toHaveBeenCalledTimes(1);
    expect(logMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        atUri: 'at://did:plc:abc123/bio.lexicons.temp.v0-1.occurrence/3occ',
        surveyUri: 'at://did:plc:abc123/bio.cuanto.survey/3svy',
      }),
      expect.stringContaining('skipping ingestion'),
    );
  });

  test('calls insertIdentification for an identification create event', async () => {
    const resp = await POST({
      request: makeRequest(identificationEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);

    expect(resp.status).toBe(200);
    expect(insertIdentification).toHaveBeenCalledOnce();
    expect(insertIdentification).toHaveBeenCalledWith(
      'did:plc:abc123',
      '3ident',
      identificationEvent.record.record,
      'at://did:plc:abc123/bio.lexicons.temp.v0-1.identification/3ident',
    );
  });

  test('calls deleteIdentificationByAtUri for an identification delete event', async () => {
    const deleteEvent = {
      ...identificationEvent,
      record: {
        ...identificationEvent.record,
        action: 'delete',
        record: undefined,
      },
    };
    const resp = await POST({
      request: makeRequest(deleteEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(deleteIdentificationByAtUri).toHaveBeenCalledWith(
      'at://did:plc:abc123/bio.lexicons.temp.v0-1.identification/3ident',
    );
    expect(insertIdentification).not.toHaveBeenCalled();
  });

  test('fetches missing occurrence by URI and retries when insertIdentification gets FK violation', async () => {
    vi.mocked(insertIdentification)
      .mockRejectedValueOnce(fkError)
      .mockResolvedValue(undefined);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce({
      uri: 'at://did:plc:abc123/bio.lexicons.temp.v0-1.occurrence/3occ',
      cid: TEST_CID,
      value: {
        $type: 'bio.lexicons.temp.v0-1.occurrence',
        eventID: 'at://did:plc:abc123/bio.cuanto.survey/3svy',
      },
    });

    const resp = await POST({
      request: makeRequest(identificationEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);

    expect(resp.status).toBe(200);
    expect(fetchAtRecord).toHaveBeenCalledOnce();
    expect(fetchAtRecord).toHaveBeenCalledWith(
      'at://did:plc:abc123/bio.lexicons.temp.v0-1.occurrence/3occ',
    );
    expect(insertOccurrence).toHaveBeenCalledOnce();
    expect(insertSurvey).not.toHaveBeenCalled();
    expect(insertIdentification).toHaveBeenCalledTimes(2);
  });

  test('returns 200 without backfilling when protocol is RecordNotFound (insertProtocolTarget FK)', async () => {
    vi.mocked(insertProtocolTarget).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(null);
    const resp = await POST({
      request: makeRequest(targetEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertProtocol).not.toHaveBeenCalled();
    expect(insertProtocolTarget).toHaveBeenCalledOnce();
  });

  test('returns 200 without backfilling when protocol is RecordNotFound (insertSurvey FK)', async () => {
    vi.mocked(insertSurvey).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(null);
    const resp = await POST({
      request: makeRequest(surveyEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertProtocol).not.toHaveBeenCalled();
    expect(insertSurvey).toHaveBeenCalledOnce();
  });

  test('returns 200 without backfilling when protocol is RecordNotFound (createFollow FK)', async () => {
    vi.mocked(createFollow).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(null);
    const resp = await POST({
      request: makeRequest(followCreateEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertProtocol).not.toHaveBeenCalled();
    expect(createFollow).toHaveBeenCalledOnce();
  });

  test('returns 200 without backfilling when survey is RecordNotFound (insertOccurrence FK)', async () => {
    vi.mocked(insertOccurrence).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(null);
    const resp = await POST({
      request: makeRequest(occurrenceEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertSurvey).not.toHaveBeenCalled();
    expect(insertOccurrence).toHaveBeenCalledOnce();
  });

  test('returns 200 when occurrence is RecordNotFound during identification backfill', async () => {
    vi.mocked(insertIdentification).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(null);
    const resp = await POST({
      request: makeRequest(identificationEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertOccurrence).not.toHaveBeenCalled();
    expect(insertIdentification).toHaveBeenCalledOnce();
  });

  test('returns 200 when survey is RecordNotFound during identification nested backfill', async () => {
    vi.mocked(insertIdentification).mockRejectedValueOnce(fkError);
    vi.mocked(insertOccurrence).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord)
      .mockResolvedValueOnce({
        uri: 'at://did:plc:abc123/bio.lexicons.temp.v0-1.occurrence/3occ',
        cid: TEST_CID,
        value: {
          $type: 'bio.lexicons.temp.v0-1.occurrence',
          eventID: 'at://did:plc:abc123/bio.cuanto.survey/3svy',
        },
      })
      .mockResolvedValueOnce(null);
    const resp = await POST({
      request: makeRequest(identificationEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertSurvey).not.toHaveBeenCalled();
    expect(insertOccurrence).toHaveBeenCalledOnce();
    expect(insertIdentification).toHaveBeenCalledOnce();
  });

  test('backfills survey when insertOccurrence also gets FK violation', async () => {
    vi.mocked(insertIdentification)
      .mockRejectedValueOnce(fkError)
      .mockResolvedValue(undefined);
    vi.mocked(insertOccurrence)
      .mockRejectedValueOnce(fkError)
      .mockResolvedValue(undefined);
    vi.mocked(fetchAtRecord)
      .mockResolvedValueOnce({
        uri: 'at://did:plc:abc123/bio.lexicons.temp.v0-1.occurrence/3occ',
        cid: TEST_CID,
        value: {
          $type: 'bio.lexicons.temp.v0-1.occurrence',
          eventID: 'at://did:plc:abc123/bio.cuanto.survey/3svy',
        },
      })
      .mockResolvedValueOnce(fetchedSurveyRecord);
    vi.mocked(resolveHandle).mockResolvedValue('test.bsky.social');
    vi.mocked(listAtRecords).mockResolvedValue([]);

    const resp = await POST({
      request: makeRequest(identificationEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);

    expect(resp.status).toBe(200);
    expect(insertSurvey).toHaveBeenCalledOnce();
    expect(insertOccurrence).toHaveBeenCalledTimes(2);
    expect(insertIdentification).toHaveBeenCalledTimes(2);
  });
});
