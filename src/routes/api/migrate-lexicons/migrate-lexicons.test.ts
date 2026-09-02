import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/pds', () => {
  class PdsSessionExpiredError extends Error {
    constructor() {
      super('PDS session expired');
    }
  }
  class PdsScopeInsufficientError extends PdsSessionExpiredError {}
  return {
    assertActiveSession: vi.fn(),
    PdsSessionExpiredError,
    PdsScopeInsufficientError,
  };
});

vi.mock('$lib/server/migrate-lexicons', () => ({
  migrateUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/logger', () => ({
  default: { child: () => ({ error: vi.fn() }) },
}));

import { migrateUser } from '$lib/server/migrate-lexicons';
import {
  assertActiveSession,
  PdsScopeInsufficientError,
  PdsSessionExpiredError,
} from '$lib/server/pds';
import { POST } from './+server';

const DID = 'did:test:migrate-lexicons';

function callPost(authenticated = true) {
  return POST({
    locals: authenticated ? { did: DID } : {},
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertActiveSession).mockResolvedValue(undefined);
});

describe('POST /api/migrate-lexicons', () => {
  test('returns 401 when not authenticated', async () => {
    const res = await callPost(false);
    expect(res.status).toBe(401);
    expect(migrateUser).not.toHaveBeenCalled();
  });

  test('returns 202 and kicks off the migration for an active session', async () => {
    const res = await callPost();
    expect(res.status).toBe(202);
    expect(migrateUser).toHaveBeenCalledWith(DID);
  });

  test('returns 401 pds_session_expired when the session is dead', async () => {
    vi.mocked(assertActiveSession).mockRejectedValueOnce(
      new PdsSessionExpiredError(),
    );
    const res = await callPost();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'pds_session_expired' });
    expect(migrateUser).not.toHaveBeenCalled();
  });

  test('returns 403 permissionRequired when the session is missing a scope', async () => {
    vi.mocked(assertActiveSession).mockRejectedValueOnce(
      new PdsScopeInsufficientError(),
    );
    const res = await callPost();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: 'pds_permission_required',
      permissionRequired: true,
    });
    expect(migrateUser).not.toHaveBeenCalled();
  });
});
