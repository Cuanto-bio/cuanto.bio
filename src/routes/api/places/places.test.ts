import { beforeEach, describe, expect, test, vi } from 'vitest';

// Use dynamic imports per test so that module-level cache and lastRequest are
// reset between tests — vi.resetModules() gives a fresh module each time.
describe('GET /api/places', () => {
  let GET: typeof import('./+server')['GET'];

  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    ({ GET } = await import('./+server'));
  });

  test('returns empty results for missing query without calling Nominatim', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const resp = await GET({
      url: new URL('http://localhost/api/places'),
    } as Parameters<typeof GET>[0]);
    const data = await resp.json();
    expect(data.results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('returns empty results for query shorter than 2 chars without calling Nominatim', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const resp = await GET({
      url: new URL('http://localhost/api/places?q=y'),
    } as Parameters<typeof GET>[0]);
    const data = await resp.json();
    expect(data.results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('maps Nominatim response fields to PlaceResult shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            place_id: 12345,
            display_name: 'Yosemite National Park, California, United States',
            lat: '37.8393004',
            lon: '-119.5164635',
            address: {
              country: 'United States',
              country_code: 'us',
              state: 'California',
              city: 'Mariposa',
              postcode: '95389',
            },
          },
        ],
      }),
    );

    const resp = await GET({
      url: new URL('http://localhost/api/places?q=yosemite'),
    } as Parameters<typeof GET>[0]);
    const data = await resp.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toEqual({
      placeId: 12345,
      displayName: 'Yosemite National Park, California, United States',
      lat: '37.8393004',
      lon: '-119.5164635',
      address: {
        countryCode: 'US',
        region: 'California',
        locality: 'Mariposa',
        postalCode: '95389',
        street: undefined,
      },
    });
  });

  test('country_code is uppercased in response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            place_id: 1,
            display_name: 'Some Place, Germany',
            lat: '52.5',
            lon: '13.4',
            address: { country_code: 'de', state: 'Berlin' },
          },
        ],
      }),
    );

    const resp = await GET({
      url: new URL('http://localhost/api/places?q=berlin'),
    } as Parameters<typeof GET>[0]);
    const data = await resp.json();
    expect(data.results[0].address.countryCode).toBe('DE');
  });

  test('locality falls back to town then village when city is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            place_id: 2,
            display_name: 'Some Trail, Some Town, CA',
            lat: '38.0',
            lon: '-122.0',
            address: {
              country_code: 'us',
              state: 'California',
              town: 'Some Town',
            },
          },
          {
            place_id: 3,
            display_name: 'Some Trail, Some Village, CA',
            lat: '38.1',
            lon: '-122.1',
            address: {
              country_code: 'us',
              state: 'California',
              village: 'Some Village',
            },
          },
        ],
      }),
    );

    const resp = await GET({
      url: new URL('http://localhost/api/places?q=some+trail'),
    } as Parameters<typeof GET>[0]);
    const data = await resp.json();
    expect(data.results[0].address.locality).toBe('Some Town');
    expect(data.results[1].address.locality).toBe('Some Village');
  });

  test('street combines house_number and road', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            place_id: 4,
            display_name: '123 Main St, Springfield',
            lat: '40.0',
            lon: '-75.0',
            address: {
              country_code: 'us',
              house_number: '123',
              road: 'Main St',
            },
          },
        ],
      }),
    );

    const resp = await GET({
      url: new URL('http://localhost/api/places?q=123+main'),
    } as Parameters<typeof GET>[0]);
    const data = await resp.json();
    expect(data.results[0].address.street).toBe('123 Main St');
  });

  test('street uses road alone when house_number is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            place_id: 5,
            display_name: 'Elm Street, Springfield',
            lat: '40.1',
            lon: '-75.1',
            address: { country_code: 'us', road: 'Elm Street' },
          },
        ],
      }),
    );

    const resp = await GET({
      url: new URL('http://localhost/api/places?q=elm+street'),
    } as Parameters<typeof GET>[0]);
    const data = await resp.json();
    expect(data.results[0].address.street).toBe('Elm Street');
  });

  test('returns 502 when Nominatim returns an error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    const resp = await GET({
      url: new URL('http://localhost/api/places?q=broken'),
    } as Parameters<typeof GET>[0]);
    expect(resp.status).toBe(502);
  });

  test('returns empty results array when Nominatim returns no matches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      }),
    );

    const resp = await GET({
      url: new URL('http://localhost/api/places?q=xyznotfound'),
    } as Parameters<typeof GET>[0]);
    const data = await resp.json();
    expect(data.results).toEqual([]);
  });

  test('caches results so a second identical query does not call Nominatim again', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          place_id: 6,
          display_name: 'Alcatraz Island, San Francisco Bay',
          lat: '37.8269775',
          lon: '-122.4229555',
          address: {
            country_code: 'us',
            state: 'California',
            city: 'San Francisco',
          },
        },
      ],
    });
    vi.stubGlobal('fetch', mockFetch);

    const url = new URL('http://localhost/api/places?q=alcatraz');
    await GET({ url } as Parameters<typeof GET>[0]);
    await GET({ url } as Parameters<typeof GET>[0]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('sends User-Agent and Referer headers to Nominatim', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    vi.stubGlobal('fetch', mockFetch);

    await GET({
      url: new URL('http://localhost/api/places?q=golden+gate'),
    } as Parameters<typeof GET>[0]);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['User-Agent']).toContain(
      'cuanto.bio',
    );
    expect((init.headers as Record<string, string>).Referer).toContain(
      'cuanto.bio',
    );
  });
});
