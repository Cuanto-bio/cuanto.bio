import { TokenRefreshError } from '@atproto/oauth-client-node';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db', () => {
  const tag = Object.assign(
    vi.fn(() => Promise.resolve([])),
    {
      json: (v: unknown) => v,
    },
  );
  return { default: tag };
});

vi.mock('./auth', () => ({
  getClient: vi.fn(),
  isScopeSufficient: vi.fn(),
}));

const mockLog = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock('$lib/server/logger', () => ({
  default: { child: () => mockLog },
}));

import sql from '$lib/server/db';
import { getClient, isScopeSufficient } from './auth';
import {
  createRecord,
  fetchAvatarUrl,
  fetchBskyProfile,
  isPdsSessionError,
  PdsScopeInsufficientError,
  PdsSessionExpiredError,
} from './pds';

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockGetClient = getClient as unknown as ReturnType<typeof vi.fn>;
const mockIsScopeSufficient = isScopeSufficient as unknown as ReturnType<
  typeof vi.fn
>;

describe('isPdsSessionError', () => {
  test('returns true for OAuth invalid_request error message', () => {
    expect(
      isPdsSessionError(
        new Error(
          'OAuth "invalid_request" error: client authentication method "private_key_jwt" required a "client_assertion"',
        ),
      ),
    ).toBe(true);
  });

  test('returns true for OAuth invalid_token error message', () => {
    expect(
      isPdsSessionError(
        new Error('OAuth "invalid_token" error: token expired'),
      ),
    ).toBe(true);
  });

  test('returns true for OAuth invalid_grant error message', () => {
    expect(
      isPdsSessionError(
        new Error('OAuth "invalid_grant" error: refresh token revoked'),
      ),
    ).toBe(true);
  });

  test('returns true for TokenRefreshError (session deleted by another process)', () => {
    expect(
      isPdsSessionError(
        new TokenRefreshError(
          'did:test:1',
          'The session was deleted by another process',
        ),
      ),
    ).toBe(true);
  });

  test('returns false for unrelated errors', () => {
    expect(isPdsSessionError(new Error('Network error'))).toBe(false);
    expect(isPdsSessionError(new Error('PDS unreachable'))).toBe(false);
    expect(isPdsSessionError(new TypeError('fetch failed'))).toBe(false);
  });

  test('returns false for non-Error values', () => {
    expect(isPdsSessionError('some string')).toBe(false);
    expect(isPdsSessionError(null)).toBe(false);
    expect(isPdsSessionError(undefined)).toBe(false);
    expect(isPdsSessionError(42)).toBe(false);
  });
});

describe('withSessionErrorHandling scope check (via createRecord)', () => {
  const did = 'did:plc:test';
  const restore = vi.fn();
  const fetchHandler = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PDS_MOCK;
    mockGetClient.mockResolvedValue({ restore });
    restore.mockResolvedValue({ fetchHandler });
    fetchHandler.mockResolvedValue(
      new Response(
        JSON.stringify({ uri: 'at://x/bio.cuanto.survey/z', cid: 'bafy' }),
        {
          status: 200,
        },
      ),
    );
  });

  test('throws PdsScopeInsufficientError and deletes the session without contacting the PDS when scope is insufficient', async () => {
    mockSql.mockResolvedValueOnce([{ scope: 'atproto' }]);
    mockIsScopeSufficient.mockReturnValue(false);

    let caught: unknown;
    try {
      await createRecord(did, 'bio.cuanto.survey', {});
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(PdsScopeInsufficientError);
    // PdsScopeInsufficientError extends PdsSessionExpiredError, so existing
    // `instanceof PdsSessionExpiredError` checks across the app keep working.
    expect(caught).toBeInstanceOf(PdsSessionExpiredError);
    expect(fetchHandler).not.toHaveBeenCalled();

    const deleteCall = mockSql.mock.calls.find((args) =>
      String(args[0][0]).includes('DELETE FROM oauth_sessions'),
    );
    expect(deleteCall).toBeDefined();
  });

  test('proceeds to the real write when scope is sufficient', async () => {
    mockSql.mockResolvedValueOnce([
      { scope: 'atproto repo:bio.cuanto.survey' },
    ]);
    mockIsScopeSufficient.mockReturnValue(true);

    const result = await createRecord(did, 'bio.cuanto.survey', {});

    expect(result).toEqual({ uri: 'at://x/bio.cuanto.survey/z', cid: 'bafy' });
    expect(fetchHandler).toHaveBeenCalledOnce();
  });
});

describe('fetchBskyProfile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns avatar, displayName, and description on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            avatar: 'https://example.com/avatar.jpg',
            displayName: 'Ken-ichi',
            description: 'Naturalist',
          }),
          { status: 200 },
        ),
      ),
    );

    const profile = await fetchBskyProfile('did:plc:test');

    expect(profile).toEqual({
      avatar: 'https://example.com/avatar.jpg',
      displayName: 'Ken-ichi',
      description: 'Naturalist',
    });
    vi.unstubAllGlobals();
  });

  // An account with no avatar, displayName, or description has nothing
  // resembling an app.bsky.actor.profile worth showing as a Bluesky profile,
  // so callers should treat it the same as no profile at all.
  test('returns null when avatar, displayName, and description are all absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    );

    expect(await fetchBskyProfile('did:plc:test')).toBeNull();
    vi.unstubAllGlobals();
  });

  test('returns a profile when only description is set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ description: 'Naturalist' }), {
          status: 200,
        }),
      ),
    );

    const profile = await fetchBskyProfile('did:plc:test');

    expect(profile).toEqual({
      avatar: null,
      displayName: null,
      description: 'Naturalist',
    });
    vi.unstubAllGlobals();
  });

  // Bluesky's getProfile returns displayName: "" (not an absent field) for an
  // account that never set one, e.g. {"displayName":"","avatar":"..."}. Only
  // nullish-coalescing that would leave callers rendering an empty heading.
  test('treats an empty-string displayName/description as absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            avatar: 'https://example.com/avatar.jpg',
            displayName: '',
            description: '',
          }),
          { status: 200 },
        ),
      ),
    );

    const profile = await fetchBskyProfile('did:plc:test');

    expect(profile).toEqual({
      avatar: 'https://example.com/avatar.jpg',
      displayName: null,
      description: null,
    });
    vi.unstubAllGlobals();
  });

  // A non-ok response and a genuinely absent profile both return null, which
  // otherwise makes a rate limit or outage indistinguishable from "this
  // account has no Bluesky profile" -- both from the profile page and from
  // whoever is trying to debug why it's not showing up.
  test('returns null and logs a warning when the profile request fails', async () => {
    mockLog.warn.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not found', { status: 404 })),
    );

    expect(await fetchBskyProfile('did:plc:test')).toBeNull();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ did: 'did:plc:test', status: 404 }),
      expect.any(String),
    );
    vi.unstubAllGlobals();
  });

  test('returns null and logs an error when the fetch throws', async () => {
    mockLog.error.mockClear();
    const err = new Error('network down');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));

    expect(await fetchBskyProfile('did:plc:test')).toBeNull();
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ did: 'did:plc:test', err }),
      expect.any(String),
    );
    vi.unstubAllGlobals();
  });
});

describe('fetchAvatarUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('returns just the avatar from the Bluesky profile', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            avatar: 'https://example.com/avatar.jpg',
            displayName: 'Ken-ichi',
          }),
          { status: 200 },
        ),
      ),
    );

    expect(await fetchAvatarUrl('did:plc:test')).toBe(
      'https://example.com/avatar.jpg',
    );
  });

  test('returns null when there is no avatar', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    );

    expect(await fetchAvatarUrl('did:plc:test')).toBeNull();
  });
});
