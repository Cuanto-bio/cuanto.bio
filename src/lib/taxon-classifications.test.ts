import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchClassifications } from './taxon-classifications';

afterEach(() => {
  vi.unstubAllGlobals();
});

// Answers /api/taxa/classifications with a family for each id, failing any
// request whose first id is in `failFirstIds`
function classificationsFetch(failFirstIds: number[] = []) {
  return vi.fn(async (url: string) => {
    const ids = (new URL(url, 'http://localhost').searchParams.get('ids') ?? '')
      .split(',')
      .map(Number);
    if (failFirstIds.includes(ids[0])) {
      return new Response('{}', { status: 502 });
    }
    return new Response(
      JSON.stringify({
        results: Object.fromEntries(
          ids.map((id) => [id, { family: `Family${id}` }]),
        ),
      }),
    );
  });
}

describe('fetchClassifications', () => {
  test('asks for at most 500 ids per request and merges the results', async () => {
    const mockFetch = classificationsFetch();
    vi.stubGlobal('fetch', mockFetch);
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    const { classifications, error } = await fetchClassifications(ids);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(classifications.size).toBe(501);
    expect(classifications.get(501)).toEqual({ family: 'Family501' });
    expect(error).toBeNull();
  });

  test('keeps the classifications from requests that succeeded when one fails', async () => {
    vi.stubGlobal('fetch', classificationsFetch([1001]));
    const ids = Array.from({ length: 1200 }, (_, i) => i + 1);
    const { classifications, error } = await fetchClassifications(ids);
    expect(error).toBe('failed');
    expect(classifications.size).toBe(1000);
    expect(classifications.get(1000)).toEqual({ family: 'Family1000' });
  });

  test('reports a failure when the request throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const { classifications, error } = await fetchClassifications([1]);
    expect(error).toBe('failed');
    expect(classifications.size).toBe(0);
  });

  test('reports a signed-out author separately from an iNat failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    const { error } = await fetchClassifications([1]);
    expect(error).toBe('signedOut');
  });
});
