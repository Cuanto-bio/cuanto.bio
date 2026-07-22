import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/server/db', () => {
  const tag = Object.assign(
    vi.fn(() => Promise.resolve([])),
    {
      json: (v: unknown) => v,
      array: (v: unknown) => v,
    },
  );
  return { default: tag };
});

import sql from '$lib/server/db';
import {
  densifyWeekly,
  getProtocolStats,
  SPARKBAR_WEEKS,
  startOfWeekUtc,
  weekStartKeys,
} from './stats';

const PROTOCOL_URI = 'at://did:test:abc/bio.cuanto.surveyProtocol/proto1';

const scalarRow = {
  survey_count: 2,
  distinct_target_count: 3,
  total_individuals: 10,
};

const taxonRow = {
  taxon_id: 'https://www.inaturalist.org/taxa/12345',
  scientific_name: 'Quercus agrifolia',
  taxon_rank: 'species',
  total_count: 4,
  survey_count: 2,
};

const targetRow = {
  protocol_target_uri: 'at://did:test:abc/bio.cuanto.protocolTarget/tgt1',
  label: 'Quercus agrifolia',
  scope_type: 'taxon',
  taxon_rank: 'species',
  scope_count: 1,
  total_count: 4,
  survey_count: 2,
};

// The implementation creates sql fragments (for conditional clauses and the
// shared CTE/expression) before running the five main queries. Without optional
// params: 5 fragment calls + 5 main = 10. With bbox: 6 fragment calls + 5 main
// = 11. Each call to sql() is counted by the mock.
const FRAGMENT_CALLS_BASE = 5; // startFilter, endFilter, bboxSurveyFilter (empty), binned, sum
const FRAGMENT_CALLS_BBOX = 6; // the above plus bboxEnvelope

function setupMockWithData(extraFragments = 0) {
  const totalFragments = FRAGMENT_CALLS_BASE + extraFragments;
  // biome-ignore lint/suspicious/noExplicitAny: sql mock needs any cast
  let mock = vi.mocked(sql as any);
  for (let i = 0; i < totalFragments; i++) {
    mock = mock.mockResolvedValueOnce([]);
  }
  mock
    .mockResolvedValueOnce([scalarRow])
    .mockResolvedValueOnce([taxonRow])
    .mockResolvedValueOnce([targetRow])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getProtocolStats', () => {
  test('returns correctly shaped result with data', async () => {
    setupMockWithData();
    const result = await getProtocolStats({ protocolUris: [PROTOCOL_URI] });
    expect(result.surveyCount).toBe(2);
    expect(result.distinctTargetCount).toBe(3);
    expect(result.totalIndividuals).toBe(10);
    expect(result.taxa).toHaveLength(1);
    expect(result.taxa[0]).toEqual({
      taxonId: 'https://www.inaturalist.org/taxa/12345',
      scientificName: 'Quercus agrifolia',
      taxonRank: 'species',
      totalCount: 4,
      surveyCount: 2,
    });
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]).toEqual({
      protocolTargetUri: 'at://did:test:abc/bio.cuanto.protocolTarget/tgt1',
      label: 'Quercus agrifolia',
      scopeType: 'taxon',
      // Carried through so the UI can tell a target that names one taxon from
      // one that ANDs several scopes together, and render the former as a
      // taxon rather than as a bare string.
      taxonRank: 'species',
      scopeCount: 1,
      totalCount: 4,
      surveyCount: 2,
    });
  });

  test('returns zeroed result when queries return no rows', async () => {
    // Default mock returns [] for all calls; optional chaining + nullish coalescing in
    // the implementation handles undefined scalar gracefully.
    const result = await getProtocolStats({ protocolUris: [PROTOCOL_URI] });
    expect(result.surveyCount).toBe(0);
    expect(result.distinctTargetCount).toBe(0);
    expect(result.totalIndividuals).toBe(0);
    expect(result.taxa).toEqual([]);
    expect(result.targets).toEqual([]);
  });

  test('accepts optional start and end dates without error', async () => {
    setupMockWithData();
    const result = await getProtocolStats({
      protocolUris: [PROTOCOL_URI],
      start: new Date('2026-06-01T00:00:00Z'),
      end: new Date('2026-06-01T23:59:59Z'),
    });
    expect(result.surveyCount).toBe(2);
    expect(result.taxa).toHaveLength(1);
    expect(result.targets).toHaveLength(1);
  });

  test('accepts optional bbox without error', async () => {
    setupMockWithData(FRAGMENT_CALLS_BBOX - FRAGMENT_CALLS_BASE);
    const result = await getProtocolStats({
      protocolUris: [PROTOCOL_URI],
      bbox: { north: 38, south: 37, east: -122, west: -123 },
    });
    expect(result.surveyCount).toBe(2);
    expect(result.taxa).toHaveLength(1);
    expect(result.targets).toHaveLength(1);
  });

  test('accepts all optional filters together', async () => {
    setupMockWithData(FRAGMENT_CALLS_BBOX - FRAGMENT_CALLS_BASE);
    const result = await getProtocolStats({
      protocolUris: [PROTOCOL_URI],
      start: new Date('2026-06-01T00:00:00Z'),
      end: new Date('2026-06-01T23:59:59Z'),
      bbox: { north: 38, south: 37, east: -122, west: -123 },
    });
    expect(result.surveyCount).toBe(2);
    expect(result.taxa).toHaveLength(1);
    expect(result.targets).toHaveLength(1);
  });

  test('returns shaped result with bbox filter', async () => {
    setupMockWithData(FRAGMENT_CALLS_BBOX - FRAGMENT_CALLS_BASE);
    const result = await getProtocolStats({
      protocolUris: [PROTOCOL_URI],
      bbox: { north: 38, south: 37, east: -122, west: -123 },
    });
    expect(result.surveyCount).toBe(2);
    expect(result.taxa).toHaveLength(1);
    expect(result.targets).toHaveLength(1);
  });
});

// ── weekly series helpers ─────────────────────────────────────────────────────

describe('startOfWeekUtc', () => {
  test('returns the same day for a Monday', () => {
    expect(startOfWeekUtc(new Date('2026-07-20T13:45:00Z')).toISOString()).toBe(
      '2026-07-20T00:00:00.000Z',
    );
  });

  test('walks back to Monday for a Sunday', () => {
    expect(startOfWeekUtc(new Date('2026-07-26T23:59:59Z')).toISOString()).toBe(
      '2026-07-20T00:00:00.000Z',
    );
  });

  test('crosses a month boundary', () => {
    expect(startOfWeekUtc(new Date('2026-08-02T06:00:00Z')).toISOString()).toBe(
      '2026-07-27T00:00:00.000Z',
    );
  });
});

describe('weekStartKeys', () => {
  test('returns SPARKBAR_WEEKS consecutive Mondays ending with the anchor week', () => {
    const keys = weekStartKeys(new Date('2026-07-22T00:00:00Z'));
    expect(keys).toHaveLength(SPARKBAR_WEEKS);
    expect(keys.at(-1)).toBe('2026-07-20');
    expect(keys[0]).toBe('2026-05-18');
  });

  test('is strictly increasing with no gaps', () => {
    const keys = weekStartKeys(new Date('2026-07-22T00:00:00Z'));
    for (let i = 1; i < keys.length; i++) {
      const prev = new Date(`${keys[i - 1]}T00:00:00Z`).getTime();
      const cur = new Date(`${keys[i]}T00:00:00Z`).getTime();
      expect(cur - prev).toBe(7 * 24 * 60 * 60 * 1000);
    }
  });
});

describe('densifyWeekly', () => {
  const weeks = ['2026-07-06', '2026-07-13', '2026-07-20'];

  test('divides total by survey count to get the mean', () => {
    const out = densifyWeekly(
      [
        {
          series_key: 'tgt1',
          week_start: '2026-07-13',
          survey_count: 4,
          total_count: 10,
        },
      ],
      weeks,
    );
    expect(out.tgt1[1]).toEqual({
      weekStart: '2026-07-13',
      mean: 2.5,
      surveyCount: 4,
      totalCount: 10,
    });
  });

  test('reports a surveyed week with no detections as a real zero, not a gap', () => {
    const out = densifyWeekly(
      [
        {
          series_key: 'tgt1',
          week_start: '2026-07-13',
          survey_count: 3,
          total_count: 0,
        },
      ],
      weeks,
    );
    expect(out.tgt1[1].mean).toBe(0);
    expect(out.tgt1[1].surveyCount).toBe(3);
  });

  test('reports an unsurveyed week as null, not zero', () => {
    const out = densifyWeekly(
      [
        {
          series_key: 'tgt1',
          week_start: '2026-07-13',
          survey_count: 3,
          total_count: 6,
        },
      ],
      weeks,
    );
    expect(out.tgt1[0].mean).toBeNull();
    expect(out.tgt1[2].mean).toBeNull();
  });

  test('pads every series to the full week list in order', () => {
    const out = densifyWeekly(
      [
        {
          series_key: 'a',
          week_start: '2026-07-06',
          survey_count: 1,
          total_count: 1,
        },
        {
          series_key: 'b',
          week_start: '2026-07-20',
          survey_count: 1,
          total_count: 2,
        },
      ],
      weeks,
    );
    expect(out.a).toHaveLength(3);
    expect(out.b).toHaveLength(3);
    expect(out.a.map((p) => p.weekStart)).toEqual(weeks);
  });

  test('coerces numeric strings from postgres', () => {
    const out = densifyWeekly(
      [
        {
          series_key: 'tgt1',
          week_start: '2026-07-06',
          survey_count: 2,
          total_count: '7',
        },
      ],
      weeks,
    );
    expect(out.tgt1[0].mean).toBe(3.5);
    expect(out.tgt1[0].totalCount).toBe(7);
  });

  test('treats a zero denominator as unknown rather than dividing by zero', () => {
    const out = densifyWeekly(
      [
        {
          series_key: 'tgt1',
          week_start: '2026-07-06',
          survey_count: 0,
          total_count: 0,
        },
      ],
      weeks,
    );
    expect(out.tgt1[0].mean).toBeNull();
  });

  test('returns an empty object for no rows', () => {
    expect(densifyWeekly([], weeks)).toEqual({});
  });
});
