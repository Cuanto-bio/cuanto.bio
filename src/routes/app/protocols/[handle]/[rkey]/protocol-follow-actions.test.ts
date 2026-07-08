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
import { actions } from './+page.server';

const DID = 'did:test:protocol-follow-actions-spec';
const OWNER_DID = 'did:test:protocol-follow-actions-owner';
const PROTOCOL_URI = `at://${OWNER_DID}/bio.cuanto.surveyProtocol/proto1`;

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

function runAction(name: 'follow' | 'unfollow') {
  // biome-ignore lint/complexity/noBannedTypes: Seems ok for a test
  return (actions as Record<string, Function>)[name]({
    params: { handle: 'ownerhandle', rkey: 'proto1' },
    locals: { did: DID },
  });
}

describe('follow/unfollow — PDS auth errors (issue #27)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql
      .mockResolvedValueOnce([{ did: OWNER_DID }]) // user lookup
      .mockResolvedValueOnce([{ at_uri: PROTOCOL_URI }]); // protocol lookup
  });

  test('follow returns fail(401) with sessionExpired when createRecord throws PdsSessionExpiredError', async () => {
    vi.mocked(getFollowByDidAndProtocol).mockResolvedValue(null);
    vi.mocked(createRecord).mockRejectedValueOnce(new PdsSessionExpiredError());

    const result = await runAction('follow');

    expect(result?.status).toBe(401);
    expect((result?.data as { sessionExpired?: boolean }).sessionExpired).toBe(
      true,
    );
    expect(createFollow).not.toHaveBeenCalled();
    expect(materializeSurveyTargets).not.toHaveBeenCalled();
  });

  test('follow returns fail(403) with permissionRequired when createRecord throws PdsScopeInsufficientError', async () => {
    vi.mocked(getFollowByDidAndProtocol).mockResolvedValue(null);
    vi.mocked(createRecord).mockRejectedValueOnce(
      new PdsScopeInsufficientError(),
    );

    const result = await runAction('follow');

    expect(result?.status).toBe(403);
    expect(
      (result?.data as { permissionRequired?: boolean }).permissionRequired,
    ).toBe(true);
    expect(createFollow).not.toHaveBeenCalled();
    expect(materializeSurveyTargets).not.toHaveBeenCalled();
  });

  test('unfollow returns fail(401) with sessionExpired when deleteRecord throws PdsSessionExpiredError', async () => {
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

    const result = await runAction('unfollow');

    expect(result?.status).toBe(401);
    expect((result?.data as { sessionExpired?: boolean }).sessionExpired).toBe(
      true,
    );
    expect(deleteFollow).toHaveBeenCalledWith(followUri);
    expect(gcSurveyTargetsIfUnused).not.toHaveBeenCalled();
  });

  test('unfollow returns fail(403) with permissionRequired when deleteRecord throws PdsScopeInsufficientError', async () => {
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

    const result = await runAction('unfollow');

    expect(result?.status).toBe(403);
    expect(
      (result?.data as { permissionRequired?: boolean }).permissionRequired,
    ).toBe(true);
    expect(deleteFollow).toHaveBeenCalledWith(followUri);
    expect(gcSurveyTargetsIfUnused).not.toHaveBeenCalled();
  });
});
