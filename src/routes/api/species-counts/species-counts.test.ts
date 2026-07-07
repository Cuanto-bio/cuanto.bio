import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GET } from './+server';

function call(query: string) {
  return GET({
    url: new URL(`http://localhost/api/species-counts${query}`),
  } as Parameters<typeof GET>[0]);
}

describe('GET /api/species-counts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('returns 422 without a place_id and does not call iNat', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const resp = await call('');
    expect(resp.status).toBe(422);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('returns 422 for a non-numeric place_id', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const resp = await call('?place_id=abc');
    expect(resp.status).toBe(422);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('returns 422 for a non-numeric taxon_id', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const resp = await call('?place_id=14&taxon_id=notanumber');
    expect(resp.status).toBe(422);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('requests research-grade species counts scoped to place and taxon', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await call('?place_id=14&taxon_id=775801');

    const requestedUrl = mockFetch.mock.calls[0][0] as string;
    expect(requestedUrl).toContain('place_id=14');
    expect(requestedUrl).toContain('taxon_id=775801');
    expect(requestedUrl).toContain('quality_grade=research');
    expect(requestedUrl).toContain('per_page=500');
  });

  test('omits taxon_id from the iNat request when not provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await call('?place_id=14');

    const requestedUrl = mockFetch.mock.calls[0][0] as string;
    expect(requestedUrl).not.toContain('taxon_id');
  });

  test('maps species_counts results to the TaxonResult shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              count: 42,
              taxon: {
                id: 52381,
                name: 'Danaus plexippus',
                rank: 'species',
                preferred_common_name: 'Monarch',
              },
            },
          ],
        }),
      }),
    );

    const resp = await call('?place_id=14');
    const data = await resp.json();
    expect(data.results).toEqual([
      {
        inatId: 52381,
        scientificName: 'Danaus plexippus',
        taxonRank: 'species',
        commonName: 'Monarch',
        kingdom: null,
        taxonID: 'https://www.inaturalist.org/taxa/52381',
      },
    ]);
  });

  test('skips result rows that have no taxon', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { count: 1, taxon: null },
            {
              count: 2,
              taxon: { id: 1, name: 'Bombus', rank: 'genus' },
            },
          ],
        }),
      }),
    );

    const resp = await call('?place_id=14');
    const data = await resp.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0].inatId).toBe(1);
    expect(data.results[0].commonName).toBeNull();
  });

  test('returns 502 when iNat responds with an error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    const resp = await call('?place_id=14');
    expect(resp.status).toBe(502);
  });

  test('requests per_page=0 when count=true', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ total_results: 0, results: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await call('?place_id=14&taxon_id=775801&count=true');

    const requestedUrl = mockFetch.mock.calls[0][0] as string;
    expect(requestedUrl).toContain('place_id=14');
    expect(requestedUrl).toContain('taxon_id=775801');
    expect(requestedUrl).toContain('per_page=0');
  });

  test('returns the iNat total_results as `total` when count=true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ total_results: 42, results: [] }),
      }),
    );

    const resp = await call('?place_id=14&count=true');
    const data = await resp.json();
    expect(data).toEqual({ total: 42 });
  });

  test('returns 502 for count=true when iNat responds with an error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    const resp = await call('?place_id=14&count=true');
    expect(resp.status).toBe(502);
  });
});
