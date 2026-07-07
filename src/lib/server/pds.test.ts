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

import sql from '$lib/server/db';
import { getClient, isScopeSufficient } from './auth';
import {
  createRecord,
  fetchWithRetry,
  isPdsSessionError,
  PdsScopeInsufficientError,
  PdsSessionExpiredError,
} from './pds';

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;
const mockGetClient = getClient as unknown as ReturnType<typeof vi.fn>;
const mockIsScopeSufficient = isScopeSufficient as unknown as ReturnType<
  typeof vi.fn
>;

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('returns response immediately on 200', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const result = await fetchWithRetry('https://example.com', {}, mockFetch);
    expect(result.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  test('retries once on 429 and succeeds', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const promise = fetchWithRetry('https://example.com', {}, mockFetch);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('respects Retry-After header in seconds', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('rate limited', {
          status: 429,
          headers: { 'Retry-After': '5' },
        }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const advanceSpy = vi.spyOn(global, 'setTimeout');
    const promise = fetchWithRetry('https://example.com', {}, mockFetch);
    await vi.runAllTimersAsync();
    await promise;

    // Should have waited at least 5000ms (5 seconds from Retry-After)
    const delay = advanceSpy.mock.calls[0]?.[1] ?? 0;
    expect(delay).toBeGreaterThanOrEqual(5000);
  });

  test('throws after max retries are exhausted', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response('rate limited', { status: 429 }));

    const promise = fetchWithRetry('https://example.com', {}, mockFetch);
    // Attach rejection handler before running timers to avoid unhandled rejection
    const expectation = expect(promise).rejects.toThrow(/429/);
    await vi.runAllTimersAsync();
    await expectation;
  });

  test('does not retry on non-429 error responses', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response('not found', { status: 404 }));

    const result = await fetchWithRetry('https://example.com', {}, mockFetch);
    expect(result.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

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
