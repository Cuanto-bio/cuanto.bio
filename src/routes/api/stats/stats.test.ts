import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db/stats', () => ({
  getProtocolStats: vi.fn(),
}));

import { isHttpError } from '@sveltejs/kit';
import { getProtocolStats } from '$lib/server/db/stats';
import { GET } from './+server';

const PROTOCOL_URI = 'at://did:test:abc/bio.cuanto.surveyProtocol/proto1';

const fakeStats = {
  surveyCount: 3,
  distinctTargetCount: 2,
  totalIndividuals: 12,
  taxa: [
    {
      taxonId: 'https://www.inaturalist.org/taxa/12345',
      scientificName: 'Quercus agrifolia',
      taxonRank: 'species',
      totalCount: 12,
      surveyCount: 3,
    },
  ],
  targets: [],
  targetWeekly: {},
  taxonWeekly: {},
};

async function callGet(search: string): Promise<Response> {
  const url = new URL(`http://localhost/api/stats${search}`);
  try {
    return await GET({ url } as Parameters<typeof GET>[0]);
  } catch (e) {
    if (isHttpError(e)) {
      return new Response(JSON.stringify({ error: e.body.message }), {
        status: e.status,
      });
    }
    throw e;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProtocolStats).mockResolvedValue(fakeStats);
});

describe('GET /api/stats — validation', () => {
  test('returns 422 when protocols param is missing', async () => {
    const resp = await callGet('');
    expect(resp.status).toBe(422);
  });

  test('returns 422 when protocols param is empty string', async () => {
    const resp = await callGet('?protocols=');
    expect(resp.status).toBe(422);
  });

  test('returns 422 when start is not a valid date', async () => {
    const resp = await callGet(`?protocols=${PROTOCOL_URI}&start=not-a-date`);
    expect(resp.status).toBe(422);
  });

  test('returns 422 when end is not a valid date', async () => {
    const resp = await callGet(`?protocols=${PROTOCOL_URI}&end=not-a-date`);
    expect(resp.status).toBe(422);
  });

  test('returns 422 when start is after end', async () => {
    const resp = await callGet(
      `?protocols=${PROTOCOL_URI}&start=2026-06-02T00:00:00Z&end=2026-06-01T00:00:00Z`,
    );
    expect(resp.status).toBe(422);
  });

  test('returns 422 when only some bbox params are provided', async () => {
    const resp = await callGet(
      `?protocols=${PROTOCOL_URI}&bboxNorth=38&bboxSouth=37`,
    );
    expect(resp.status).toBe(422);
  });

  test('returns 422 when bbox latitude is out of range', async () => {
    const resp = await callGet(
      `?protocols=${PROTOCOL_URI}&bboxNorth=91&bboxSouth=37&bboxEast=-122&bboxWest=-123`,
    );
    expect(resp.status).toBe(422);
  });

  test('returns 422 when bbox longitude is out of range', async () => {
    const resp = await callGet(
      `?protocols=${PROTOCOL_URI}&bboxNorth=38&bboxSouth=37&bboxEast=181&bboxWest=-123`,
    );
    expect(resp.status).toBe(422);
  });

  test('returns 422 when bbox north is south of south', async () => {
    const resp = await callGet(
      `?protocols=${PROTOCOL_URI}&bboxNorth=36&bboxSouth=37&bboxEast=-122&bboxWest=-123`,
    );
    expect(resp.status).toBe(422);
  });

  test('returns 422 when bbox west is east of east (antimeridian crossing)', async () => {
    const resp = await callGet(
      `?protocols=${PROTOCOL_URI}&bboxNorth=38&bboxSouth=37&bboxEast=-123&bboxWest=-122`,
    );
    expect(resp.status).toBe(422);
  });
});

describe('GET /api/stats — success', () => {
  test('returns 200 with stats for valid protocol-only request', async () => {
    const resp = await callGet(`?protocols=${PROTOCOL_URI}`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toEqual(fakeStats);
  });

  test('passes parsed protocol URIs to getProtocolStats', async () => {
    const uri2 = 'at://did:test:abc/bio.cuanto.surveyProtocol/proto2';
    await callGet(`?protocols=${PROTOCOL_URI},${uri2}`);
    expect(getProtocolStats).toHaveBeenCalledWith(
      expect.objectContaining({
        protocolUris: [PROTOCOL_URI, uri2],
      }),
    );
  });

  test('passes parsed Date objects for start and end when provided', async () => {
    await callGet(
      `?protocols=${PROTOCOL_URI}&start=2026-06-01T00:00:00.000Z&end=2026-06-01T23:59:59.000Z`,
    );
    expect(getProtocolStats).toHaveBeenCalledWith(
      expect.objectContaining({
        start: new Date('2026-06-01T00:00:00.000Z'),
        end: new Date('2026-06-01T23:59:59.000Z'),
      }),
    );
  });

  test('passes parsed bbox to getProtocolStats when all four coords provided', async () => {
    await callGet(
      `?protocols=${PROTOCOL_URI}&bboxNorth=38&bboxSouth=37&bboxEast=-122&bboxWest=-123`,
    );
    expect(getProtocolStats).toHaveBeenCalledWith(
      expect.objectContaining({
        bbox: { north: 38, south: 37, east: -122, west: -123 },
      }),
    );
  });

  test('passes undefined bbox to getProtocolStats when bbox params are absent', async () => {
    await callGet(`?protocols=${PROTOCOL_URI}`);
    expect(getProtocolStats).toHaveBeenCalledWith(
      expect.objectContaining({ bbox: undefined }),
    );
  });
});
