import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { inatFetch } from './inat';

function rateLimited() {
  return new Response('rate limited', { status: 429 });
}

describe('inatFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('requests the path from the iNat API with a User-Agent', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', mockFetch);
    await inatFetch('/v2/taxa?q=oak');
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.inaturalist.org/v2/taxa?q=oak');
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(
      /^cuanto\.bio\//,
    );
  });

  test('passes the signal through', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', mockFetch);
    const { signal } = new AbortController();
    await inatFetch('/v2/taxa', { signal });
    expect((mockFetch.mock.calls[0][1] as RequestInit).signal).toBe(signal);
  });

  test('retries a 429', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', mockFetch);
    const promise = inatFetch('/v2/taxa');
    await vi.runAllTimersAsync();
    expect((await promise).status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('with retry: false, returns a 429 without retrying', async () => {
    const mockFetch = vi.fn().mockResolvedValue(rateLimited());
    vi.stubGlobal('fetch', mockFetch);
    const resp = await inatFetch('/v2/taxa', { retry: false });
    expect(resp.status).toBe(429);
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
