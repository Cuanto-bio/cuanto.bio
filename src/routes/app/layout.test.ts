import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const getIdbUser = vi.fn();
const saveIdbUser = vi.fn();
const clearIdbUser = vi.fn();
vi.mock('$lib/offline/db', () => ({
  getIdbUser: () => getIdbUser(),
  saveIdbUser: (...args: unknown[]) => saveIdbUser(...args),
  clearIdbUser: () => clearIdbUser(),
}));

const syncOfflineData = vi.fn();
vi.mock('$lib/offline/sync', () => ({
  syncOfflineData: (...args: unknown[]) => syncOfflineData(...args),
}));

// $lib/auth/signin calls isNative(), which touches Capacitor's web fallback —
// that fallback assumes a `window`, which the node test environment has none
// of. Stub it the same way fillUserFromCache.test.ts does.
vi.mock('$lib/platform', () => ({
  isNative: () => false,
}));

import { load } from './+layout';

const USER = { did: 'did:plc:dana', handle: 'dana', avatarUrl: 'd.png' };
const URL_APP_PROTOCOL = new URL('https://cuanto.bio/app/protocols/dana/x');
const URL_APP_SURVEY = new URL('https://cuanto.bio/app/surveys/dana/x');
// No public equivalent exists for this one — it must still hit the sign-in
// wall, guarding against the public-equivalent fallback matching too broadly.
const URL_APP_ACCOUNT = new URL('https://cuanto.bio/app/account');

function meResponse(user: typeof USER) {
  return new Response(JSON.stringify(user), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * A fetch stub whose promise only settles when the test tells it to (via
 * `resolve`/`reject`), and that rejects with an AbortError the moment its
 * request's AbortSignal fires — mirroring what a real `fetch` does under an
 * AbortController-driven timeout.
 */
function deferredFetch() {
  let resolveFn!: (res: Response) => void;
  let rejectFn!: (err: unknown) => void;
  const fetchFn = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
    return new Promise<Response>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted', 'AbortError'));
      });
    });
  });
  return {
    fetchFn,
    resolve: (res: Response) => resolveFn(res),
    reject: (err: unknown) => rejectFn(err),
  };
}

beforeEach(() => {
  getIdbUser.mockReset();
  saveIdbUser.mockReset().mockResolvedValue(undefined);
  clearIdbUser.mockReset().mockResolvedValue(undefined);
  syncOfflineData.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('/app layout auth guard', () => {
  test('does not bounce to sign-in when /api/me is merely slow, not unauthorized', async () => {
    // Nothing cached yet in IndexedDB — e.g. the first /app visit this
    // session — so the guard has nothing to fall back on if it gives up.
    getIdbUser.mockResolvedValue(undefined);
    vi.useFakeTimers();
    const { fetchFn, resolve } = deferredFetch();

    const promise = load({
      fetch: fetchFn,
      url: URL_APP_PROTOCOL,
    } as unknown as Parameters<typeof load>[0]);

    // Trip the guard's abort timeout while the real response is still on
    // its way (a cold server/DB after a quiet period, say).
    await vi.advanceTimersByTimeAsync(3000);
    resolve(meResponse(USER));

    await expect(promise).resolves.toEqual(USER);
  });

  test('still redirects to sign-in on a genuine network failure with nothing cached', async () => {
    getIdbUser.mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      load({
        fetch: fetchFn,
        url: URL_APP_ACCOUNT,
      } as unknown as Parameters<typeof load>[0]),
    ).rejects.toMatchObject({ status: 302, location: '/auth/signin' });
  });

  test('still redirects to sign-in on a real 401', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      load({
        fetch: fetchFn,
        url: URL_APP_ACCOUNT,
      } as unknown as Parameters<typeof load>[0]),
    ).rejects.toMatchObject({ status: 302, location: '/auth/signin' });
    expect(clearIdbUser).toHaveBeenCalled();
  });

  // https://tangled.org/cuanto.bio/cuanto.bio/issues/61
  test('sends a signed-out visitor to the public protocol page on a real 401, not sign-in', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      load({
        fetch: fetchFn,
        url: URL_APP_PROTOCOL,
      } as unknown as Parameters<typeof load>[0]),
    ).rejects.toMatchObject({ status: 302, location: '/protocols/dana/x' });
    expect(clearIdbUser).toHaveBeenCalled();
  });

  test('sends a signed-out visitor to the public protocol page when offline with nothing cached', async () => {
    getIdbUser.mockResolvedValue(undefined);
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      load({
        fetch: fetchFn,
        url: URL_APP_PROTOCOL,
      } as unknown as Parameters<typeof load>[0]),
    ).rejects.toMatchObject({ status: 302, location: '/protocols/dana/x' });
  });

  // https://tangled.org/cuanto.bio/cuanto.bio/issues/63
  test('sends a signed-out visitor to the public survey page on a real 401, not sign-in', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      load({
        fetch: fetchFn,
        url: URL_APP_SURVEY,
      } as unknown as Parameters<typeof load>[0]),
    ).rejects.toMatchObject({ status: 302, location: '/surveys/dana/x' });
    expect(clearIdbUser).toHaveBeenCalled();
  });
});
