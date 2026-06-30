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
import { getProtocolStats } from './stats';

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
  total_count: 4,
  survey_count: 2,
};

// The implementation creates sql fragments (for conditional clauses) before running
// the three main queries. Without optional params: 3 fragment calls + 3 main = 6.
// With bbox: 4 fragment calls + 3 main = 7. Each call to sql() is counted by the mock.
const FRAGMENT_CALLS_BASE = 3; // startFilter, endFilter, bboxSurveyFilter (empty)
const FRAGMENT_CALLS_BBOX = 4; // startFilter, endFilter, bboxEnvelope, bboxSurveyFilter

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
    .mockResolvedValueOnce([targetRow]);
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
