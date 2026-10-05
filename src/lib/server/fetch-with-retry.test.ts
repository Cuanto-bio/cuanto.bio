import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fetchWithRetry } from './fetch-with-retry';

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

  test('respects Retry-After header as an HTTP date', async () => {
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('rate limited', {
          status: 429,
          headers: { 'Retry-After': 'Wed, 30 Sep 2026 12:00:07 GMT' },
        }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const promise = fetchWithRetry('https://example.com', {}, mockFetch);
    await vi.advanceTimersByTimeAsync(6_900);
    expect(mockFetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(100);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect((await promise).status).toBe(200);
  });

  test('waits at least the backoff when Retry-After is zero or in the past', async () => {
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    for (const retryAfter of ['0', 'Wed, 30 Sep 2026 11:59:00 GMT']) {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response('rate limited', {
            status: 429,
            headers: { 'Retry-After': retryAfter },
          }),
        )
        .mockResolvedValueOnce(new Response('ok', { status: 200 }));

      const promise = fetchWithRetry('https://example.com', {}, mockFetch);
      await vi.advanceTimersByTimeAsync(900);
      expect(mockFetch).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(100);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect((await promise).status).toBe(200);
    }
  });

  test('returns the 429 without waiting when Retry-After is too long', async () => {
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'));
    for (const retryAfter of ['3600', 'Wed, 30 Sep 2026 13:00:00 GMT']) {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('rate limited', {
          status: 429,
          headers: { 'Retry-After': retryAfter },
        }),
      );
      const result = await fetchWithRetry('https://example.com', {}, mockFetch);
      expect(result.status).toBe(429);
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  test('discards the body of a 429 it retries', async () => {
    const rateLimited = new Response('rate limited', { status: 429 });
    const cancel = vi.spyOn(rateLimited.body as ReadableStream, 'cancel');
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const promise = fetchWithRetry('https://example.com', {}, mockFetch);
    await vi.runAllTimersAsync();
    await promise;
    expect(cancel).toHaveBeenCalledOnce();
  });

  test('stops waiting to retry when the signal aborts', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response('rate limited', { status: 429 }));
    const controller = new AbortController();

    const promise = fetchWithRetry(
      'https://example.com',
      { signal: controller.signal },
      mockFetch,
    );
    const expectation = expect(promise).rejects.toThrow(/aborted/i);
    // Let the first 429 come back, then abort partway through the 1s backoff
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await expectation;
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('returns the last 429 after max retries are exhausted', async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation(
        async () => new Response('rate limited', { status: 429 }),
      );

    const promise = fetchWithRetry('https://example.com', {}, mockFetch);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.status).toBe(429);
    expect(await result.text()).toBe('rate limited');
    expect(mockFetch).toHaveBeenCalledTimes(4);
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
