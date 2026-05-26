import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// fetchWithRetry is exported for testing
import { fetchWithRetry } from './pds';

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
