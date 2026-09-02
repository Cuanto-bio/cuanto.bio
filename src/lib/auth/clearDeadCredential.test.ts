import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// clearDeadCredential() drops whichever local credential the client presented
// once the server has told us the underlying PDS/OAuth session is dead. The two
// clients keep their credential in different places, so the two branches are
// genuinely different code paths (see $lib/auth/token.ts for the native token
// and src/routes/oauth/callback/+server.ts for the httpOnly `did` cookie).

const env = { native: false };
vi.mock('$lib/platform', () => ({ isNative: () => env.native }));

const mocks = vi.hoisted(() => ({ clearToken: vi.fn() }));
vi.mock('$lib/auth/token', () => ({ clearToken: mocks.clearToken }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // The module memoises the in-flight clear; each test needs a fresh instance.
  vi.resetModules();
  env.native = false;
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clearDeadCredential', () => {
  test('native: clears the bearer token and makes no request', async () => {
    env.native = true;
    const { clearDeadCredential } = await import('./clearDeadCredential');
    await clearDeadCredential();

    expect(mocks.clearToken).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('web: hits the cookie-clearing route and never touches the token store', async () => {
    const { clearDeadCredential } = await import('./clearDeadCredential');
    await clearDeadCredential();

    expect(fetchMock).toHaveBeenCalledWith('/auth/signout');
    expect(mocks.clearToken).not.toHaveBeenCalled();
  });

  test('web: a failed sign-out request does not reject', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const { clearDeadCredential } = await import('./clearDeadCredential');
    await expect(clearDeadCredential()).resolves.toBeUndefined();
  });

  test('dedupes concurrent callers into a single sign-out', async () => {
    const { clearDeadCredential } = await import('./clearDeadCredential');
    await Promise.all([
      clearDeadCredential(),
      clearDeadCredential(),
      clearDeadCredential(),
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('clearDeadCredentialForActionResult', () => {
  test('clears on fail(401, { sessionExpired: true })', async () => {
    const { clearDeadCredentialForActionResult } = await import(
      './clearDeadCredential'
    );
    clearDeadCredentialForActionResult({
      type: 'failure',
      status: 401,
      data: { sessionExpired: true },
    });
    expect(fetchMock).toHaveBeenCalledWith('/auth/signout');
  });

  test('ignores a failure without the sessionExpired flag', async () => {
    const { clearDeadCredentialForActionResult } = await import(
      './clearDeadCredential'
    );
    clearDeadCredentialForActionResult({
      type: 'failure',
      status: 422,
      data: { error: 'Title is required' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('ignores a successful submission', async () => {
    const { clearDeadCredentialForActionResult } = await import(
      './clearDeadCredential'
    );
    clearDeadCredentialForActionResult({ type: 'success', status: 200 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
