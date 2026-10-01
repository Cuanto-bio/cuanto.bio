import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/logger', () => ({
  default: {
    child: vi.fn().mockReturnValue({ error: vi.fn(), warn: vi.fn() }),
  },
}));

import { classifyTargets, fetchInatClassifications } from './inat-taxa';

const TAXON_TYPE = 'bio.cuanto.protocolTarget#taxonScope';

// Fake iNat v2 taxa search. Each taxon N has ancestors Animalia (id 1) and a
// family (id FAMILY_OFFSET + N); ancestor_ids includes the taxon itself, as
// iNat's does.
const FAMILY_OFFSET = 1_000_000;

function fakeTaxon(id: number, fields: string) {
  if (fields === 'id,ancestor_ids') {
    return { id, ancestor_ids: [1, FAMILY_OFFSET + id, id] };
  }
  if (id === 1) return { id, name: 'Animalia', rank: 'kingdom' };
  if (id > FAMILY_OFFSET) {
    return { id, name: `Family${id - FAMILY_OFFSET}`, rank: 'family' };
  }
  return { id, name: `Taxon ${id}`, rank: 'species' };
}

function echoingFetch() {
  return vi.fn(async (url: string) => {
    const params = new URL(url).searchParams;
    const ids = (params.get('id') ?? '').split(',').map(Number);
    const fields = params.get('fields') ?? '';
    return new Response(
      JSON.stringify({ results: ids.map((id) => fakeTaxon(id, fields)) }),
    );
  });
}

function requestsFor(mockFetch: ReturnType<typeof vi.fn>, fields: string) {
  return mockFetch.mock.calls
    .map(([url]) => new URL(url as string))
    .filter((url) => url.searchParams.get('fields') === fields);
}

function taxon(id: number | string, fields: Record<string, string> = {}) {
  return {
    scope: [
      {
        $type: TAXON_TYPE,
        scientificName: `Taxon ${id}`,
        taxonRank: 'species',
        taxonID:
          typeof id === 'number'
            ? `https://www.inaturalist.org/taxa/${id}`
            : id,
        ...fields,
      },
    ],
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('fetchInatClassifications', () => {
  test('requests ancestors for the ids and maps them to classifications', async () => {
    const mockFetch = echoingFetch();
    vi.stubGlobal('fetch', mockFetch);
    const result = await fetchInatClassifications([48662]);
    expect(result.get(48662)).toEqual({
      kingdom: 'Animalia',
      family: 'Family48662',
      higherClassification: 'Animalia | Family48662',
    });
    const [url] = requestsFor(mockFetch, 'id,ancestor_ids');
    expect(url.origin + url.pathname).toBe(
      'https://api.inaturalist.org/v2/taxa',
    );
    expect(url.searchParams.get('id')).toBe('48662');
  });

  test('splits more than 500 ids across requests', async () => {
    const mockFetch = echoingFetch();
    vi.stubGlobal('fetch', mockFetch);
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    const result = await fetchInatClassifications(ids);
    expect(requestsFor(mockFetch, 'id,ancestor_ids')).toHaveLength(2);
    // 501 taxa, 501 families, and Animalia
    expect(requestsFor(mockFetch, 'id,name,rank')).toHaveLength(3);
    expect(result.size).toBe(501);
    expect(result.get(501)?.family).toBe('Family501');
  });

  test('looks up inactive taxa, which the default search leaves out', async () => {
    const INACTIVE = 122382;
    const echo = echoingFetch();
    // Like iNat: without is_active=false, the search skips inactive taxa
    const mockFetch = vi.fn(async (url: string) => {
      const params = new URL(url).searchParams;
      if (params.get('is_active') === 'false') return echo(url);
      params.set(
        'id',
        (params.get('id') ?? '')
          .split(',')
          .filter((id) => Number(id) !== INACTIVE)
          .join(','),
      );
      return echo(`https://api.inaturalist.org/v2/taxa?${params}`);
    });
    vi.stubGlobal('fetch', mockFetch);
    const result = await fetchInatClassifications([48662, INACTIVE]);
    expect(result.get(48662)?.family).toBe('Family48662');
    expect(result.get(INACTIVE)?.family).toBe(`Family${INACTIVE}`);
    const inactiveSearches = requestsFor(mockFetch, 'id,ancestor_ids').filter(
      (url) => url.searchParams.get('is_active') === 'false',
    );
    expect(inactiveSearches.map((url) => url.searchParams.get('id'))).toEqual([
      String(INACTIVE),
    ]);
  });

  test('gives up on iNat after a timeout rather than waiting forever', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const mockFetch = echoingFetch();
    vi.stubGlobal('fetch', mockFetch);
    await fetchInatClassifications([48662]);
    expect(timeout).toHaveBeenCalledWith(expect.any(Number));
    for (const call of mockFetch.mock.calls as unknown as [
      string,
      RequestInit,
    ][]) {
      expect(call[1].signal).toBe(timeout.mock.results[0].value);
    }
    timeout.mockRestore();
  });

  test('looks up inactive ancestors, which the default search leaves out', async () => {
    const inactiveFamily = 1_000_000 + 48662;
    const echo = echoingFetch();
    const mockFetch = vi.fn(async (url: string) => {
      const params = new URL(url).searchParams;
      if (params.get('is_active') === 'false') return echo(url);
      params.set(
        'id',
        (params.get('id') ?? '')
          .split(',')
          .filter((id) => Number(id) !== inactiveFamily)
          .join(','),
      );
      return echo(`https://api.inaturalist.org/v2/taxa?${params}`);
    });
    vi.stubGlobal('fetch', mockFetch);
    const result = await fetchInatClassifications([48662]);
    expect(result.get(48662)).toEqual({
      kingdom: 'Animalia',
      family: 'Family48662',
      higherClassification: 'Animalia | Family48662',
    });
  });

  test('makes no request for no ids', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    expect((await fetchInatClassifications([])).size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('throws when iNat responds with an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    await expect(fetchInatClassifications([1])).rejects.toThrow();
  });

  test('with INAT_MOCK=true, answers from canned data without a request', async () => {
    vi.stubEnv('INAT_MOCK', 'true');
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    const result = await fetchInatClassifications([1655734, 999999999]);
    expect(result.get(1655734)?.kingdom).toBe('Animalia');
    expect(result.has(999999999)).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('classifyTargets', () => {
  test('adds classification to iNat targets that need it', async () => {
    vi.stubGlobal('fetch', echoingFetch());
    const [target] = await classifyTargets([taxon(48662)]);
    expect(target.scope[0]).toMatchObject({
      kingdom: 'Animalia',
      family: 'Family48662',
      higherClassification: 'Animalia | Family48662',
    });
  });

  test('leaves other targets alone and asks only for the ones that need it', async () => {
    const mockFetch = echoingFetch();
    vi.stubGlobal('fetch', mockFetch);
    const classified = taxon(1, {
      family: 'Nymphalidae',
      higherClassification: 'Animalia | Nymphalidae',
    });
    const gbif = taxon('https://www.gbif.org/species/102151594');
    const verbatim = {
      scope: [
        {
          $type: 'bio.cuanto.protocolTarget#verbatimScope',
          verbatimTargetScope: 'x',
        },
      ],
    };
    const result = await classifyTargets([
      classified,
      gbif,
      verbatim,
      taxon(2),
    ]);
    expect(result.slice(0, 3)).toEqual([classified, gbif, verbatim]);
    expect(result[3].scope[0]).toMatchObject({ family: 'Family2' });
    const [url] = requestsFor(mockFetch, 'id,ancestor_ids');
    expect(url.searchParams.get('id')).toBe('2');
  });

  test('makes no request when nothing needs classification', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    await classifyTargets([
      taxon(1, {
        family: 'Nymphalidae',
        higherClassification: 'Animalia | Nymphalidae',
      }),
    ]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('returns targets unchanged when iNat fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const targets = [taxon(48662)];
    expect(await classifyTargets(targets)).toEqual(targets);
  });

  test('keeps other fields on the target', async () => {
    vi.stubGlobal('fetch', echoingFetch());
    const [target] = await classifyTargets([
      { ...taxon(48662), atUri: 'at://x/y/z' },
    ]);
    expect(target.atUri).toBe('at://x/y/z');
  });
});
