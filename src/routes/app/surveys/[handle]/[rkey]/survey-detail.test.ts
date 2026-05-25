import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('$lib/offline/db', () => ({
  getCachedSurveyByRkey: vi.fn(),
  cacheSurvey: vi.fn().mockResolvedValue(undefined),
  getCachedProtocolByRkey: vi.fn(),
}));

vi.mock('$lib/logger', () => ({
  default: { child: vi.fn().mockReturnValue({ error: vi.fn() }) },
}));

import {
  cacheSurvey,
  getCachedProtocolByRkey,
  getCachedSurveyByRkey,
} from '$lib/offline/db';
import { load } from './+page';

const STALE_SURVEY = {
  rkey: 'abc',
  handle: 'testuser',
  protocolRkey: 'proto1',
  record: { eventDate: '2026-01-01T00:00:00.000Z' },
  occurrences: [],
};
const FRESH_SURVEY = {
  rkey: 'abc',
  handle: 'testuser',
  protocolRkey: 'proto1',
  record: { eventDate: '2026-05-01T00:00:00.000Z' },
  occurrences: [],
};
const PROTOCOL = { rkey: 'proto1', record: { title: 'Test Protocol' } };

function makeLoad(urlStr: string, cachedSurvey: unknown = STALE_SURVEY) {
  vi.mocked(getCachedSurveyByRkey).mockResolvedValue(cachedSurvey as never);
  vi.mocked(getCachedProtocolByRkey).mockResolvedValue(PROTOCOL as never);

  const url = new URL(urlStr);
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(FRESH_SURVEY),
  });

  return load({
    fetch: mockFetch,
    params: { handle: 'testuser', rkey: 'abc' },
    parent: async () => ({ handle: 'testuser' }),
    url,
  } as unknown as Parameters<typeof load>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cacheSurvey).mockResolvedValue(undefined);
  vi.mocked(getCachedProtocolByRkey).mockResolvedValue(PROTOCOL as never);
});

test('returns cached survey when no ?updated param', async () => {
  const result = (await makeLoad(
    'http://localhost/app/surveys/testuser/abc',
  )) as unknown as Record<string, unknown>;
  expect(result.survey).toEqual(STALE_SURVEY);
});

test('returns fresh survey when ?updated=1 is present even if cache exists', async () => {
  const updatedUrl = 'http://localhost/app/surveys/testuser/abc?updated=1';
  const result = (await makeLoad(updatedUrl)) as unknown as Record<
    string,
    unknown
  >;
  expect(result.survey).toEqual(FRESH_SURVEY);
});
