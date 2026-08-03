import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/pds', () => {
  class PdsSessionExpiredError extends Error {
    constructor() {
      super('AT Protocol session expired. Please sign in again.');
    }
  }
  class PdsScopeInsufficientError extends PdsSessionExpiredError {}
  return {
    createRecord: vi.fn(),
    deleteRecord: vi.fn(),
    PdsSessionExpiredError,
    PdsScopeInsufficientError,
  };
});

vi.mock('$lib/server/db/protocol-follows', () => ({
  createFollow: vi.fn(),
  deleteFollow: vi.fn(),
  getFollowByDidAndProtocol: vi.fn(),
}));

vi.mock('$lib/server/materialize-targets', () => ({
  materializeSurveyTargets: vi.fn(),
  gcSurveyTargetsIfUnused: vi.fn(),
}));

vi.mock('$lib/server/db', () => ({
  default: vi.fn(),
}));

import sql from '$lib/server/db';
import {
  createFollow,
  deleteFollow,
  getFollowByDidAndProtocol,
} from '$lib/server/db/protocol-follows';
import {
  gcSurveyTargetsIfUnused,
  materializeSurveyTargets,
} from '$lib/server/materialize-targets';
import {
  createRecord,
  deleteRecord,
  PdsScopeInsufficientError,
  PdsSessionExpiredError,
} from '$lib/server/pds';
import { DELETE, POST } from './+server';

const DID = 'did:test:protocol-follow-actions-spec';
const OWNER_DID = 'did:test:protocol-follow-actions-owner';
const PROTOCOL_URI = `at://${OWNER_DID}/bio.cuanto.surveyProtocol/proto1`;

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

// These were form actions on /app/protocols/[handle]/[rkey] until phase 1 moved
// them here so /app could be built statically. The PDS failure contract is
// unchanged, so the assertions are too — only the transport differs (a Response
// with a status and JSON body, rather than a SvelteKit ActionFailure).
function callHandler(handler: typeof POST | typeof DELETE) {
  return handler({
    params: { handle: 'ownerhandle', rkey: 'proto1' },
    locals: { did: DID },
  } as unknown as Parameters<typeof POST>[0]);
}

describe('follow/unfollow — PDS auth errors (issue #27)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql
      .mockResolvedValueOnce([{ did: OWNER_DID }]) // user lookup
      .mockResolvedValueOnce([{ at_uri: PROTOCOL_URI }]); // protocol lookup
  });

  test('follow returns 401 with sessionExpired when createRecord throws PdsSessionExpiredError', async () => {
    vi.mocked(getFollowByDidAndProtocol).mockResolvedValue(null);
    vi.mocked(createRecord).mockRejectedValueOnce(new PdsSessionExpiredError());

    const res = await callHandler(POST);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ sessionExpired: true });
    expect(createFollow).not.toHaveBeenCalled();
    expect(materializeSurveyTargets).not.toHaveBeenCalled();
  });

  test('follow returns 403 with permissionRequired when createRecord throws PdsScopeInsufficientError', async () => {
    vi.mocked(getFollowByDidAndProtocol).mockResolvedValue(null);
    vi.mocked(createRecord).mockRejectedValueOnce(
      new PdsScopeInsufficientError(),
    );

    const res = await callHandler(POST);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ permissionRequired: true });
    expect(createFollow).not.toHaveBeenCalled();
    expect(materializeSurveyTargets).not.toHaveBeenCalled();
  });

  test('unfollow returns 401 with sessionExpired when deleteRecord throws PdsSessionExpiredError', async () => {
    const followUri = `at://${DID}/bio.cuanto.surveyProtocol.follow/follow1`;
    vi.mocked(getFollowByDidAndProtocol).mockResolvedValue({
      id: 1,
      at_uri: followUri,
      did: DID,
      rkey: 'follow1',
      protocol_uri: PROTOCOL_URI,
      created_at: new Date().toISOString(),
      indexed_at: new Date().toISOString(),
    });
    vi.mocked(deleteRecord).mockRejectedValueOnce(new PdsSessionExpiredError());

    const res = await callHandler(DELETE);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ sessionExpired: true });
    // The local row is deleted before the PDS call, so it is already gone by
    // the time the PDS rejects; the target GC is what gets skipped.
    expect(deleteFollow).toHaveBeenCalledWith(followUri);
    expect(gcSurveyTargetsIfUnused).not.toHaveBeenCalled();
  });

  test('unfollow returns 403 with permissionRequired when deleteRecord throws PdsScopeInsufficientError', async () => {
    const followUri = `at://${DID}/bio.cuanto.surveyProtocol.follow/follow1`;
    vi.mocked(getFollowByDidAndProtocol).mockResolvedValue({
      id: 1,
      at_uri: followUri,
      did: DID,
      rkey: 'follow1',
      protocol_uri: PROTOCOL_URI,
      created_at: new Date().toISOString(),
      indexed_at: new Date().toISOString(),
    });
    vi.mocked(deleteRecord).mockRejectedValueOnce(
      new PdsScopeInsufficientError(),
    );

    const res = await callHandler(DELETE);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ permissionRequired: true });
    expect(deleteFollow).toHaveBeenCalledWith(followUri);
    expect(gcSurveyTargetsIfUnused).not.toHaveBeenCalled();
  });

  test('returns 401 without touching the PDS when not authenticated', async () => {
    const res = await POST({
      params: { handle: 'ownerhandle', rkey: 'proto1' },
      locals: {},
    } as unknown as Parameters<typeof POST>[0]);

    expect(res.status).toBe(401);
    expect(createRecord).not.toHaveBeenCalled();
  });
});
