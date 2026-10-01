import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/inat-taxa', () => ({
  fetchInatClassifications: vi.fn(),
}));

vi.mock('$lib/logger', () => ({
  default: {
    child: vi.fn().mockReturnValue({ error: vi.fn(), warn: vi.fn() }),
  },
}));

import { fetchInatClassifications } from '$lib/server/inat-taxa';
import { GET } from './+server';

async function get(query: string, did: string | null = 'did:test:author') {
  const resp = await GET({
    url: new URL(`http://localhost/api/taxa/classifications${query}`),
    locals: { did },
  } as unknown as Parameters<typeof GET>[0]);
  return { status: resp.status, body: await resp.json() };
}

describe('GET /api/taxa/classifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns classifications keyed by iNat taxon id', async () => {
    vi.mocked(fetchInatClassifications).mockResolvedValue(
      new Map([[48548, { kingdom: 'Animalia', genus: 'Vanessa' }]]),
    );
    const { status, body } = await get('?ids=48548,999');
    expect(status).toBe(200);
    expect(body).toEqual({
      results: { 48548: { kingdom: 'Animalia', genus: 'Vanessa' } },
    });
    expect(fetchInatClassifications).toHaveBeenCalledWith([48548, 999]);
  });

  test('returns 401 when signed out, without calling iNat', async () => {
    expect((await get('?ids=1', null)).status).toBe(401);
    expect(fetchInatClassifications).not.toHaveBeenCalled();
  });

  test('returns 422 without ids', async () => {
    expect((await get('')).status).toBe(422);
    expect((await get('?ids=')).status).toBe(422);
    expect(fetchInatClassifications).not.toHaveBeenCalled();
  });

  test('returns 422 for ids that are not integers', async () => {
    expect((await get('?ids=1,abc')).status).toBe(422);
    expect(fetchInatClassifications).not.toHaveBeenCalled();
  });

  test('returns 422 for more than 500 ids', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => i + 1).join(',');
    expect((await get(`?ids=${ids}`)).status).toBe(422);
    expect(fetchInatClassifications).not.toHaveBeenCalled();
  });

  test('returns 502 when iNat fails', async () => {
    vi.mocked(fetchInatClassifications).mockRejectedValue(new Error('down'));
    expect((await get('?ids=1')).status).toBe(502);
  });
});
