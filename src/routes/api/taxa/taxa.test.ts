import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GET } from './+server';

describe('GET /api/taxa', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('returns empty results for missing query without calling iNat', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const resp = await GET({
      url: new URL('http://localhost/api/taxa'),
    } as Parameters<typeof GET>[0]);
    const data = await resp.json();
    expect(data.results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('returns empty results for query shorter than 2 chars without calling iNat', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const resp = await GET({
      url: new URL('http://localhost/api/taxa?q=a'),
    } as Parameters<typeof GET>[0]);
    const data = await resp.json();
    expect(data.results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('maps iNat response fields to TaxonScope shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 12345,
              name: 'Quercus robur',
              rank: 'species',
              preferred_common_name: 'English oak',
              ancestors: [
                { rank: 'phylum', name: 'Tracheophyta' },
                { rank: 'kingdom', name: 'Plantae' },
                { rank: 'class', name: 'Magnoliopsida' },
              ],
            },
          ],
        }),
      }),
    );

    const resp = await GET({
      url: new URL('http://localhost/api/taxa?q=quercus'),
    } as Parameters<typeof GET>[0]);
    const data = await resp.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toEqual({
      inatId: 12345,
      scientificName: 'Quercus robur',
      taxonRank: 'species',
      commonName: 'English oak',
      kingdom: 'Plantae',
      taxonID: 'https://www.inaturalist.org/taxa/12345',
    });
  });

  test('returns null kingdom when no kingdom ancestor exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 99999,
              name: 'Candidatus Patescibacteria',
              rank: 'phylum',
              ancestors: [{ rank: 'stateofmatter', name: 'Life' }],
            },
          ],
        }),
      }),
    );

    const resp = await GET({
      url: new URL('http://localhost/api/taxa?q=patescibacteria'),
    } as Parameters<typeof GET>[0]);
    const data = await resp.json();
    expect(data.results[0].kingdom).toBeNull();
  });

  test('returns empty results array when iNat returns no matches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      }),
    );

    const resp = await GET({
      url: new URL('http://localhost/api/taxa?q=xyznotfound'),
    } as Parameters<typeof GET>[0]);
    const data = await resp.json();
    expect(data.results).toEqual([]);
  });

  test('returns 502 when iNat API returns an error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    const resp = await GET({
      url: new URL('http://localhost/api/taxa?q=quercus'),
    } as Parameters<typeof GET>[0]);
    expect(resp.status).toBe(502);
  });

  test('returns 502 on a 429 without retrying', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response('rate limited', { status: 429 }));
    vi.stubGlobal('fetch', mockFetch);
    const resp = await GET({
      url: new URL('http://localhost/api/taxa?q=quercus'),
    } as Parameters<typeof GET>[0]);
    expect(resp.status).toBe(502);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  test('retries a 429 when asked to with retry=true', async () => {
    vi.useFakeTimers();
    try {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] })));
      vi.stubGlobal('fetch', mockFetch);
      const promise = GET({
        url: new URL('http://localhost/api/taxa?q=quercus&retry=true'),
      } as Parameters<typeof GET>[0]);
      await vi.runAllTimersAsync();
      expect((await promise).status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
