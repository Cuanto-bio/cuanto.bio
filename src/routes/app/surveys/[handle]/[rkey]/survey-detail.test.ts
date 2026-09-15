import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('$lib/offline/db', () => ({
  getCachedSurveyByRkey: vi.fn(),
  cacheSurvey: vi.fn().mockResolvedValue(undefined),
  getCachedProtocolByRkey: vi.fn(),
  cacheProtocol: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/logger', () => ({
  default: { child: vi.fn().mockReturnValue({ error: vi.fn() }) },
}));

import {
  cacheProtocol,
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
  vi.mocked(cacheProtocol).mockResolvedValue(undefined);
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

// Regression test: a cached protocol used to be trusted forever (only
// fetched when nothing was cached at all), so a change the author made
// after caching it — deleting it, issue #25 — never surfaced here. Now it's
// refreshed in the background every load, same as the survey itself above.
test('refreshes a cached protocol in the background instead of trusting it forever', async () => {
  vi.mocked(getCachedSurveyByRkey).mockResolvedValue(STALE_SURVEY as never);
  vi.mocked(getCachedProtocolByRkey).mockResolvedValue(PROTOCOL as never);
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ protocol: PROTOCOL }),
  });

  await load({
    fetch: mockFetch,
    params: { handle: 'testuser', rkey: 'abc' },
    parent: async () => ({ handle: 'testuser' }),
    url: new URL('http://localhost/app/surveys/testuser/abc'),
  } as unknown as Parameters<typeof load>[0]);

  // fetchAndCacheProtocol's fetch() call happens synchronously the moment
  // it's invoked, even though it isn't awaited here (a fire-and-forget
  // background refresh) — so this is observable right after load() resolves.
  const calledProtocolEndpoint = mockFetch.mock.calls.some((c) =>
    String(c[0]).includes('/api/protocols/'),
  );
  expect(calledProtocolEndpoint).toBe(true);
});
