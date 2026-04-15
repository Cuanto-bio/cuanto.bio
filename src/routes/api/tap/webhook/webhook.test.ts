import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/protocols', () => ({
  insertProtocol: vi.fn(),
  insertTarget: vi.fn(),
}));

vi.mock('$lib/server/surveys', () => ({
  insertSurvey: vi.fn(),
  insertOccurrence: vi.fn(),
}));

vi.mock('$env/static/private', () => ({
  TAP_ADMIN_PASSWORD: 'testpassword',
}));

import { insertProtocol, insertTarget } from '$lib/server/protocols';
import { insertOccurrence, insertSurvey } from '$lib/server/surveys';
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

  test('returns 200 without inserting for an identity event', async () => {
    const identityEvent = {
      id: 5,
      type: 'identity',
      identity: {
        did: 'did:plc:abc123',
        handle: 'test.bsky.social',
        is_active: true,
        status: 'active',
      },
    };
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
});
