import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db/survey-protocols', () => ({
  insertProtocol: vi.fn(),
  insertTarget: vi.fn(),
}));

vi.mock('$lib/server/db/surveys', () => ({
  insertSurvey: vi.fn(),
  insertOccurrence: vi.fn(),
}));

vi.mock('$lib/server/db/protocol-follows', () => ({
  createFollow: vi.fn(),
  deleteFollow: vi.fn(),
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

import { createFollow, deleteFollow } from '$lib/server/db/protocol-follows';
import { insertProtocol, insertTarget } from '$lib/server/db/survey-protocols';
import { insertOccurrence, insertSurvey } from '$lib/server/db/surveys';
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
    collection: 'bio.lexicons.temp.surveyProtocol',
    rkey: '3abc',
    action: 'create',
    record: {
      $type: 'bio.lexicons.temp.surveyProtocol',
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
    collection: 'bio.lexicons.temp.surveyTarget',
    rkey: '3def',
    action: 'create',
    record: {
      $type: 'bio.lexicons.temp.surveyTarget',
      protocol: 'at://did:plc:abc123/bio.lexicons.temp.surveyProtocol/3abc',
      scope: [
        {
          $type: 'bio.lexicons.temp.surveyTarget#verbatimScope',
          verbatimTargetScope: 'trees',
        },
      ],
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
    collection: 'bio.lexicons.temp.survey',
    rkey: '3svy',
    action: 'create',
    record: {
      $type: 'bio.lexicons.temp.survey',
      protocol: {
        uri: 'at://did:plc:abc123/bio.lexicons.temp.surveyProtocol/3abc',
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
    collection: 'bio.lexicons.temp.occurrence',
    rkey: '3occ',
    action: 'create',
    record: {
      $type: 'bio.lexicons.temp.occurrence',
      eventID: 'at://did:plc:abc123/bio.lexicons.temp.survey/3svy',
      surveyTargetID: 'at://did:plc:abc123/bio.lexicons.temp.surveyTarget/3def',
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
      subject: 'at://did:plc:abc123/bio.lexicons.temp.surveyProtocol/3abc',
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
      'at://did:plc:abc123/bio.lexicons.temp.surveyProtocol/3abc',
      TEST_CID,
    );
    expect(insertTarget).not.toHaveBeenCalled();
  });

  test('calls insertTarget for a surveyTarget update event', async () => {
    const updateEvent = {
      ...targetEvent,
      record: { ...targetEvent.record, action: 'update' },
    };
    const resp = await POST({
      request: makeRequest(updateEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertTarget).toHaveBeenCalled();
  });

  test('calls insertTarget for a surveyTarget create event', async () => {
    const resp = await POST({
      request: makeRequest(targetEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertTarget).toHaveBeenCalledWith(
      'did:plc:abc123',
      '3def',
      targetEvent.record.record,
      'at://did:plc:abc123/bio.lexicons.temp.surveyTarget/3def',
    );
    expect(insertProtocol).not.toHaveBeenCalled();
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
      'at://did:plc:abc123/bio.lexicons.temp.survey/3svy',
    );
  });

  test('fetches and inserts occurrences for a live survey create event', async () => {
    vi.mocked(listAtRecords).mockResolvedValueOnce([
      {
        uri: 'at://did:plc:abc123/bio.lexicons.temp.occurrence/3occ',
        cid: TEST_CID,
        value: {
          $type: 'bio.lexicons.temp.occurrence',
          eventID: 'at://did:plc:abc123/bio.lexicons.temp.survey/3svy',
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
      'bio.lexicons.temp.occurrence',
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
      'at://did:plc:abc123/bio.lexicons.temp.occurrence/3occ',
    );
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

  test('does not call insertProtocol or insertTarget for an identity event', async () => {
    const resp = await POST({
      request: makeRequest(identityEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(insertProtocol).not.toHaveBeenCalled();
    expect(insertTarget).not.toHaveBeenCalled();
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
    expect(insertTarget).not.toHaveBeenCalled();
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
      protocolUri: 'at://did:plc:abc123/bio.lexicons.temp.surveyProtocol/3abc',
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

  const fetchedProtocolRecord = {
    uri: 'at://did:plc:abc123/bio.lexicons.temp.surveyProtocol/3abc',
    cid: TEST_CID,
    value: {
      $type: 'bio.lexicons.temp.surveyProtocol',
      title: 'Test Protocol',
      description: 'A test',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  };

  const fetchedSurveyRecord = {
    uri: 'at://did:plc:abc123/bio.lexicons.temp.survey/3svy',
    cid: TEST_CID,
    value: {
      $type: 'bio.lexicons.temp.survey',
      protocol: {
        uri: 'at://did:plc:abc123/bio.lexicons.temp.surveyProtocol/3abc',
        cid: TEST_CID,
      },
      createdAt: '2026-04-13T10:00:00.000Z',
      eventDate: '2026-04-13T10:00:00.000Z',
      eventDurationValue: 30,
      eventDurationUnit: 'minutes',
      location: { $type: 'org.atgeo.place', name: 'Test Park' },
    },
  };

  test('backfills missing protocol when insertTarget gets FK violation', async () => {
    vi.mocked(insertTarget).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(fetchedProtocolRecord);
    const resp = await POST({
      request: makeRequest(targetEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(fetchAtRecord).toHaveBeenCalledWith(
      'at://did:plc:abc123/bio.lexicons.temp.surveyProtocol/3abc',
    );
    expect(insertProtocol).toHaveBeenCalledWith(
      'did:plc:abc123',
      '3abc',
      fetchedProtocolRecord.value,
      fetchedProtocolRecord.uri,
      TEST_CID,
    );
    expect(insertTarget).toHaveBeenCalledTimes(2);
  });

  test('backfills missing protocol when insertSurvey gets FK violation', async () => {
    vi.mocked(insertSurvey).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(fetchedProtocolRecord);
    const resp = await POST({
      request: makeRequest(surveyEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(fetchAtRecord).toHaveBeenCalledWith(
      'at://did:plc:abc123/bio.lexicons.temp.surveyProtocol/3abc',
    );
    expect(insertProtocol).toHaveBeenCalledOnce();
    expect(insertSurvey).toHaveBeenCalledTimes(2);
  });

  test('backfills missing survey when insertOccurrence gets FK violation', async () => {
    vi.mocked(insertOccurrence).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(fetchedSurveyRecord);
    const resp = await POST({
      request: makeRequest(occurrenceEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(fetchAtRecord).toHaveBeenCalledWith(
      'at://did:plc:abc123/bio.lexicons.temp.survey/3svy',
    );
    expect(insertSurvey).toHaveBeenCalledOnce();
    expect(insertOccurrence).toHaveBeenCalledTimes(2);
  });

  const fetchedTargetRecord = {
    uri: 'at://did:plc:abc123/bio.lexicons.temp.surveyTarget/3def',
    cid: TEST_CID,
    value: {
      $type: 'bio.lexicons.temp.surveyTarget',
      protocol: 'at://did:plc:abc123/bio.lexicons.temp.surveyProtocol/3abc',
      scope: [],
    },
  };

  const fetchedOccurrenceRecord = {
    uri: 'at://did:plc:abc123/bio.lexicons.temp.occurrence/3occ',
    cid: TEST_CID,
    value: {
      $type: 'bio.lexicons.temp.occurrence',
      eventID: 'at://did:plc:abc123/bio.lexicons.temp.survey/3svy',
      surveyTargetID: 'at://did:plc:abc123/bio.lexicons.temp.surveyTarget/3def',
      organismQuantity: '3',
      organismQuantityType: 'individuals',
    },
  };

  test('backfillProtocol also inserts related targets', async () => {
    vi.mocked(insertTarget).mockRejectedValueOnce(fkError);
    vi.mocked(fetchAtRecord).mockResolvedValueOnce(fetchedProtocolRecord);
    vi.mocked(listAtRecords).mockResolvedValueOnce([fetchedTargetRecord]);
    const resp = await POST({
      request: makeRequest(targetEvent, VALID_AUTH),
    } as Parameters<typeof POST>[0]);
    expect(resp.status).toBe(200);
    expect(listAtRecords).toHaveBeenCalledWith(
      'did:plc:abc123',
      'bio.lexicons.temp.surveyTarget',
    );
    expect(insertTarget).toHaveBeenCalledTimes(3); // 1 fail + 1 backfill + 1 retry
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
      'bio.lexicons.temp.occurrence',
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
      'at://did:plc:abc123/bio.lexicons.temp.survey/3svy',
    );
    expect(fetchAtRecord).toHaveBeenNthCalledWith(
      2,
      'at://did:plc:abc123/bio.lexicons.temp.surveyProtocol/3abc',
    );
    expect(insertProtocol).toHaveBeenCalledOnce();
    expect(insertSurvey).toHaveBeenCalledTimes(2);
    expect(insertOccurrence).toHaveBeenCalledTimes(2);
  });
});
