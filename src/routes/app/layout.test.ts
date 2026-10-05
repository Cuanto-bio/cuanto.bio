import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const getIdbUser = vi.fn();
const saveIdbUser = vi.fn();
const clearIdbUser = vi.fn();
const resetIdbConnection = vi.fn();
vi.mock('$lib/offline/db', () => ({
  getIdbUser: () => getIdbUser(),
  saveIdbUser: (...args: unknown[]) => saveIdbUser(...args),
  clearIdbUser: () => clearIdbUser(),
  resetIdbConnection: () => resetIdbConnection(),
}));

const invalidateAll = vi.fn();
vi.mock('$app/navigation', () => ({
  invalidateAll: () => invalidateAll(),
}));

// The page currently on screen, which the guard compares against the URL it
// was run for. Tests set `page.url`; beforeEach defaults it.
const page = vi.hoisted(() => ({ url: new URL('https://cuanto.bio/app') }));
vi.mock('$app/state', () => ({ page }));

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

import {
  markServerUnreachable,
  restoreConnectivity,
} from '$lib/composables/onlineTestUtils';
import { IDB_TIMEOUT_MS } from '$lib/offline/idbDeadline';
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
  resetIdbConnection.mockReset();
  invalidateAll.mockReset().mockResolvedValue(undefined);
  // Most tests here load /app/account as the page being shown.
  page.url = URL_APP_ACCOUNT;
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

  // https://tangled.org/cuanto.bio/cuanto.bio/issues/83
  describe('with a cached user', () => {
    test('returns the cached user without waiting on /api/me', async () => {
      // A server that's down behind a proxy hangs rather than refusing the
      // connection, so waiting on /api/me (3s, then a 12s retry) stalled
      // every /app navigation, the launch included, for ~15s.
      getIdbUser.mockResolvedValue({ ...USER });
      // Fake timers, never advanced: any wait on a timeout would hang here.
      vi.useFakeTimers();
      const { fetchFn } = deferredFetch();

      await expect(
        load({
          fetch: fetchFn,
          url: URL_APP_ACCOUNT,
        } as unknown as Parameters<typeof load>[0]),
      ).resolves.toMatchObject(USER);
    });

    test('checks /api/me in the background and syncs', async () => {
      getIdbUser.mockResolvedValue({ ...USER });
      const fetchFn = vi.fn().mockResolvedValue(meResponse(USER));

      await expect(
        load({
          fetch: fetchFn,
          url: URL_APP_ACCOUNT,
        } as unknown as Parameters<typeof load>[0]),
      ).resolves.toMatchObject(USER);
      await vi.waitFor(() => expect(syncOfflineData).toHaveBeenCalled());
    });

    test('streams needsLexiconMigration in from the background check', async () => {
      // A live server signal that is never cached, so it can't come back
      // with the cached user; the layout's banner awaits it instead.
      getIdbUser.mockResolvedValue({ ...USER });
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ...USER, needsLexiconMigration: true }), {
          status: 200,
        }),
      );

      const data = (await load({
        fetch: fetchFn,
        url: URL_APP_ACCOUNT,
      } as unknown as Parameters<typeof load>[0])) as {
        needsLexiconMigration: Promise<boolean | undefined>;
      };

      await expect(data.needsLexiconMigration).resolves.toBe(true);
    });

    test('streams needsLexiconMigration as unknown when the server cannot be reached', async () => {
      getIdbUser.mockResolvedValue({ ...USER });
      const fetchFn = vi
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch'));

      const data = (await load({
        fetch: fetchFn,
        url: URL_APP_ACCOUNT,
      } as unknown as Parameters<typeof load>[0])) as {
        needsLexiconMigration: Promise<boolean | undefined>;
      };

      await expect(data.needsLexiconMigration).resolves.toBeUndefined();
    });

    test('clears the cached user and re-runs the guard when the background check finds a revoked session', async () => {
      // The page rendered from the cache; with the cache cleared, re-running
      // the loads sends the guard down the no-cache path to the sign-in wall.
      getIdbUser.mockResolvedValue({ ...USER });
      const fetchFn = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 401 }));

      await expect(
        load({
          fetch: fetchFn,
          url: URL_APP_ACCOUNT,
        } as unknown as Parameters<typeof load>[0]),
      ).resolves.toMatchObject(USER);
      await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalled());
      expect(clearIdbUser).toHaveBeenCalled();

      // The re-run acts on the server's answer even if the clear didn't take
      // (IDB can wedge), rather than trusting the cache again and looping.
      await expect(
        load({
          fetch: fetchFn,
          url: URL_APP_ACCOUNT,
        } as unknown as Parameters<typeof load>[0]),
      ).rejects.toMatchObject({ status: 302, location: '/auth/signin' });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    test('re-runs the loads when the server says we are someone else', async () => {
      // E.g. the session expired and a different account signed in without
      // a sign-out in between. Rendering as the cached user would get
      // ownership checks wrong, so this can't wait for the next navigation.
      const other = { did: 'did:plc:eli', handle: 'eli', avatarUrl: 'e.png' };
      getIdbUser.mockResolvedValue({ ...USER });
      const fetchFn = vi.fn().mockResolvedValue(meResponse(other));

      await load({
        fetch: fetchFn,
        url: URL_APP_ACCOUNT,
      } as unknown as Parameters<typeof load>[0]);

      await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalled());
      expect(saveIdbUser).toHaveBeenCalledWith(other);

      // The re-run answers with the server's user, not the cached one.
      await expect(
        load({
          fetch: fetchFn,
          url: URL_APP_ACCOUNT,
        } as unknown as Parameters<typeof load>[0]),
      ).resolves.toEqual(other);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    test('a revoked session found after the user left the page does not ambush a later sign-in', async () => {
      // E.g. the 401 lands once the user is already on the sign-in page.
      // An answer left waiting there would be picked up by the first /app
      // load after they sign in, bouncing them straight back out.
      getIdbUser.mockResolvedValue({ ...USER });
      const { fetchFn, resolve } = deferredFetch();

      await load({
        fetch: fetchFn,
        url: URL_APP_ACCOUNT,
      } as unknown as Parameters<typeof load>[0]);
      page.url = new URL('https://cuanto.bio/auth/signin');
      resolve(new Response(null, { status: 401 }));
      await vi.waitFor(() => expect(clearIdbUser).toHaveBeenCalled());

      expect(invalidateAll).not.toHaveBeenCalled();

      // Signed in again: nothing cached yet, and the server says who we are.
      page.url = URL_APP_ACCOUNT;
      getIdbUser.mockResolvedValue(undefined);
      await expect(
        load({
          fetch: vi.fn().mockResolvedValue(meResponse(USER)),
          url: URL_APP_ACCOUNT,
        } as unknown as Parameters<typeof load>[0]),
      ).resolves.toEqual(USER);
    });

    test('a revoked session found by a link preload does not redirect the page being shown', async () => {
      // app.html preloads on hover, and a preload runs this guard for the
      // hovered link. Redirecting the current page from that would throw
      // away e.g. a survey form in progress because the pointer crossed a
      // link.
      getIdbUser.mockResolvedValue({ ...USER });
      page.url = URL_APP_ACCOUNT;
      const fetchFn = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 401 }));

      await load({
        fetch: fetchFn,
        url: URL_APP_PROTOCOL,
      } as unknown as Parameters<typeof load>[0]);
      await vi.waitFor(() => expect(clearIdbUser).toHaveBeenCalled());

      expect(invalidateAll).not.toHaveBeenCalled();
    });

    test('still re-runs the loads for a different account when caching it fails', async () => {
      // The server's answer stands whether or not the cache could be
      // updated; a failed write must not leave the page as the wrong user.
      const other = { did: 'did:plc:eli', handle: 'eli', avatarUrl: 'e.png' };
      getIdbUser.mockResolvedValue({ ...USER });
      saveIdbUser.mockRejectedValue(
        new DOMException('quota', 'QuotaExceededError'),
      );
      const fetchFn = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ...other, needsLexiconMigration: true }),
          {
            status: 200,
          },
        ),
      );

      const data = (await load({
        fetch: fetchFn,
        url: URL_APP_ACCOUNT,
      } as unknown as Parameters<typeof load>[0])) as {
        needsLexiconMigration: Promise<boolean | undefined>;
      };

      await expect(data.needsLexiconMigration).resolves.toBe(true);
      expect(invalidateAll).toHaveBeenCalled();
      expect(syncOfflineData).toHaveBeenCalled();
      // Use up the answer handed to the re-run, as the real re-run would.
      await load({
        fetch: fetchFn,
        url: URL_APP_ACCOUNT,
      } as unknown as Parameters<typeof load>[0]);
    });

    test('still re-runs the guard on a revoked session when clearing the cache fails', async () => {
      getIdbUser.mockResolvedValue({ ...USER });
      clearIdbUser.mockRejectedValue(
        new DOMException('connection closing', 'InvalidStateError'),
      );
      const fetchFn = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 401 }));

      await load({
        fetch: fetchFn,
        url: URL_APP_ACCOUNT,
      } as unknown as Parameters<typeof load>[0]);

      await vi.waitFor(() => expect(invalidateAll).toHaveBeenCalled());
      await expect(
        load({
          fetch: fetchFn,
          url: URL_APP_ACCOUNT,
        } as unknown as Parameters<typeof load>[0]),
      ).rejects.toMatchObject({ status: 302, location: '/auth/signin' });
    });

    test('does not re-run the loads for a mere handle or avatar change', async () => {
      // Re-running every load resets page state; a stale avatar for one
      // navigation isn't worth that.
      getIdbUser.mockResolvedValue({ ...USER, avatarUrl: 'stale.png' });
      const fetchFn = vi.fn().mockResolvedValue(meResponse(USER));

      const data = (await load({
        fetch: fetchFn,
        url: URL_APP_ACCOUNT,
      } as unknown as Parameters<typeof load>[0])) as {
        needsLexiconMigration: Promise<boolean | undefined>;
      };
      await data.needsLexiconMigration;

      expect(invalidateAll).not.toHaveBeenCalled();
    });
  });

  describe('once the connectivity ping has found the server unreachable', () => {
    beforeEach(markServerUnreachable);
    afterEach(restoreConnectivity);

    test('keeps the full /api/me budget when there is no cached user to fall back on', async () => {
      // A cold server can fail the 5s ping and still be reachable
      // (https://tangled.org/cuanto.bio/cuanto.bio/issues/59). With nothing
      // cached, giving up early would bounce a signed-in user to sign-in.
      getIdbUser.mockResolvedValue(undefined);
      vi.useFakeTimers();
      const { fetchFn, resolve } = deferredFetch();

      const promise = load({
        fetch: fetchFn,
        url: URL_APP_PROTOCOL,
      } as unknown as Parameters<typeof load>[0]);

      await vi.advanceTimersByTimeAsync(3000);
      resolve(meResponse(USER));

      await expect(promise).resolves.toEqual(USER);
    });
  });

  // https://tangled.org/cuanto.bio/cuanto.bio/issues/70
  test('does not rewrite the cached user when /api/me still matches it', async () => {
    // The guard re-runs on every /app navigation; rewriting a byte-identical
    // record each time is the exposure this trims. A live-only server signal
    // like needsLexiconMigration must not count as a difference.
    getIdbUser.mockResolvedValue({ ...USER });
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...USER, needsLexiconMigration: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const data = (await load({
      fetch: fetchFn,
      url: URL_APP_ACCOUNT,
    } as unknown as Parameters<typeof load>[0])) as {
      needsLexiconMigration: Promise<boolean | undefined>;
    };
    // Settles once the background check has finished with the cache.
    await data.needsLexiconMigration;
    expect(saveIdbUser).not.toHaveBeenCalled();
  });

  // https://tangled.org/cuanto.bio/cuanto.bio/issues/70
  test('rewrites the cached user when the avatar changed but the did did not', async () => {
    // Comparing only `did` would pin a stale avatar forever.
    getIdbUser.mockResolvedValue({ ...USER, avatarUrl: 'stale.png' });
    const fetchFn = vi.fn().mockResolvedValue(meResponse(USER));

    const data = (await load({
      fetch: fetchFn,
      url: URL_APP_ACCOUNT,
    } as unknown as Parameters<typeof load>[0])) as {
      needsLexiconMigration: Promise<boolean | undefined>;
    };
    // This navigation renders the cached avatar; the next one gets the new.
    await data.needsLexiconMigration;
    expect(saveIdbUser).toHaveBeenCalledWith({
      did: USER.did,
      handle: USER.handle,
      avatarUrl: USER.avatarUrl,
    });
  });

  // https://tangled.org/cuanto.bio/cuanto.bio/issues/70
  test('keeps a confirmed 200 authoritative when the cached-user read fails', async () => {
    // withIdbDeadline rethrows a non-timeout rejection; without a guard it
    // would fall into the outer "offline" catch and bounce a signed-in user
    // to sign-in.
    getIdbUser.mockRejectedValue(
      new DOMException('connection closing', 'InvalidStateError'),
    );
    const fetchFn = vi.fn().mockResolvedValue(meResponse(USER));

    await expect(
      load({
        fetch: fetchFn,
        url: URL_APP_ACCOUNT,
      } as unknown as Parameters<typeof load>[0]),
    ).resolves.toEqual(USER);
    expect(saveIdbUser).not.toHaveBeenCalled();
  });

  // https://tangled.org/cuanto.bio/cuanto.bio/issues/70
  test('does not pile a write on an unresponsive IDB when the cached-user read times out', async () => {
    // A wedged read is not "nothing cached": treating it that way would fire
    // a redundant write on every navigation while IDB is down, doubling how
    // long the guard blocks.
    getIdbUser.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers();
    const fetchFn = vi.fn().mockResolvedValue(meResponse(USER));

    const promise = load({
      fetch: fetchFn,
      url: URL_APP_ACCOUNT,
    } as unknown as Parameters<typeof load>[0]);

    await vi.advanceTimersByTimeAsync(IDB_TIMEOUT_MS);

    await expect(promise).resolves.toEqual(USER);
    expect(saveIdbUser).not.toHaveBeenCalled();
    expect(resetIdbConnection).toHaveBeenCalled();
  });

  // https://tangled.org/cuanto.bio/cuanto.bio/issues/68
  test('returns the user when an IDB write never settles', async () => {
    // Backstop for a write whenVisible did not catch. A hung IDB promise
    // looks exactly like a slow one, and this guard runs on every /app
    // navigation, so without a deadline one wedged write strands the app on
    // whatever page it was on -- /api/me having already answered 200.
    saveIdbUser.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers();
    const fetchFn = vi.fn().mockResolvedValue(meResponse(USER));

    const promise = load({
      fetch: fetchFn,
      url: URL_APP_ACCOUNT,
    } as unknown as Parameters<typeof load>[0]);

    await vi.advanceTimersByTimeAsync(IDB_TIMEOUT_MS);

    await expect(promise).resolves.toEqual(USER);
    expect(resetIdbConnection).toHaveBeenCalled();
  });

  test('still decides when the IDB read never settles', async () => {
    getIdbUser.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers();
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const promise = load({
      fetch: fetchFn,
      url: URL_APP_ACCOUNT,
    } as unknown as Parameters<typeof load>[0]);
    // Attached before the timers advance so the redirect is never briefly an
    // unhandled rejection.
    const rejects = expect(promise).rejects.toMatchObject({ status: 302 });

    await vi.advanceTimersByTimeAsync(IDB_TIMEOUT_MS);

    await rejects;
    expect(resetIdbConnection).toHaveBeenCalled();
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

  // https://tangled.org/cuanto.bio/cuanto.bio/issues/68
  test('still decides on a 401 when clearing local auth never settles', async () => {
    // clearIdbUser is a readwrite delete, so it can hang exactly as a write
    // does. This guard runs on every /app navigation, so without the same
    // deadline the other IDB awaits get, one wedged delete strands the app.
    clearIdbUser.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers();
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));

    const promise = load({
      fetch: fetchFn,
      url: URL_APP_ACCOUNT,
    } as unknown as Parameters<typeof load>[0]);
    const rejects = expect(promise).rejects.toMatchObject({
      status: 302,
      location: '/auth/signin',
    });

    await vi.advanceTimersByTimeAsync(IDB_TIMEOUT_MS);

    await rejects;
    expect(resetIdbConnection).toHaveBeenCalled();
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
