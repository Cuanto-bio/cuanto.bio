import { afterEach, describe, expect, test, vi } from 'vitest';
import { checkConnectivity } from './online.svelte';

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
