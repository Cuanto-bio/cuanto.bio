import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  checkConnectivity,
  failFastWhenUnreachable,
  UNREACHABLE_TIMEOUT_MS,
  useOnline,
} from './online.svelte';
import { markServerUnreachable, restoreConnectivity } from './onlineTestUtils';

/** A fetch stub that never answers and rejects with an AbortError on abort. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  ) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('checkConnectivity', () => {
  test('returns true when ping endpoint responds ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    expect(await checkConnectivity()).toBe(true);
  });

  test('returns false when ping endpoint returns non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await checkConnectivity()).toBe(false);
  });

  test('returns false when fetch throws (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network error')),
    );
    expect(await checkConnectivity()).toBe(false);
  });

  test('aborts request after 5 seconds and returns false', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        capturedSignal = init?.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          capturedSignal?.addEventListener('abort', () => {
            reject(
              new DOMException('The user aborted a request.', 'AbortError'),
            );
          });
        });
      }),
    );
    const promise = checkConnectivity();
    vi.advanceTimersByTime(5001);
    const result = await promise;
    expect(result).toBe(false);
    expect(capturedSignal?.aborted).toBe(true);
  });
});

describe('failFastWhenUnreachable', () => {
  afterEach(restoreConnectivity);

  // https://tangled.org/cuanto.bio/cuanto.bio/issues/83
  test('gives up on a hung request after a short deadline', async () => {
    markServerUnreachable();
    vi.useFakeTimers();
    const fetchFn = hangingFetch();

    const promise = failFastWhenUnreachable(fetchFn)('/api/me');
    // A network-style TypeError, not an AbortError: callers treat the latter
    // as "merely slow, retry".
    const rejects = expect(promise).rejects.toBeInstanceOf(TypeError);
    await vi.advanceTimersByTimeAsync(UNREACHABLE_TIMEOUT_MS);

    await rejects;
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test('reaches a server that came back since the last ping', async () => {
    markServerUnreachable();
    const res = new Response('ok');
    const fetchFn = vi.fn().mockResolvedValue(res);

    await expect(failFastWhenUnreachable(fetchFn)('/api/me')).resolves.toBe(
      res,
    );
    // The response is proof the server is back; no need to wait for a ping.
    expect(useOnline().value).toBe(true);
  });

  test("leaves the caller's own abort as an AbortError", async () => {
    markServerUnreachable();
    const caller = new AbortController();

    const promise = failFastWhenUnreachable(hangingFetch())('/api/me', {
      signal: caller.signal,
    });
    caller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('passes requests through while the server is reachable', async () => {
    const res = new Response('ok');
    const fetchFn = vi.fn().mockResolvedValue(res);

    await expect(failFastWhenUnreachable(fetchFn)('/api/me')).resolves.toBe(
      res,
    );
    expect(fetchFn).toHaveBeenCalledWith('/api/me');
  });
});
