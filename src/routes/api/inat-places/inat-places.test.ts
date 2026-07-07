import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GET } from './+server';

function call(query: string) {
  return GET({
    url: new URL(`http://localhost/api/inat-places${query}`),
  } as Parameters<typeof GET>[0]);
}

describe('GET /api/inat-places', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('returns empty results for a missing query without calling iNat', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const resp = await call('');
    const data = await resp.json();
    expect(data.results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('returns empty results for a query shorter than 2 chars', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const resp = await call('?q=a');
    const data = await resp.json();
    expect(data.results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('maps iNat place autocomplete results to id/name/displayName', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { id: 14, name: 'California', display_name: 'California, US' },
          ],
        }),
      }),
    );

    const resp = await call('?q=calif');
    const data = await resp.json();
    expect(data.results).toEqual([
      { id: 14, name: 'California', displayName: 'California, US' },
    ]);
  });

  test('falls back to name when display_name is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ id: 1, name: 'Somewhere' }] }),
      }),
    );

    const resp = await call('?q=some');
    const data = await resp.json();
    expect(data.results[0].displayName).toBe('Somewhere');
  });

  test('returns 502 when iNat responds with an error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    const resp = await call('?q=calif');
    expect(resp.status).toBe(502);
  });
});
