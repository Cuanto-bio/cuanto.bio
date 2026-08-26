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

vi.mock('$lib/server/pds', () => ({
  fetchBskyProfile: vi.fn(),
}));

import sql from '$lib/server/db';
import { fetchBskyProfile } from '$lib/server/pds';
import { getCachedBskyProfile } from './users';

// biome-ignore lint/suspicious/noExplicitAny: sql mock needs any cast
const mockSql = sql as unknown as ReturnType<typeof vi.fn> & any;
const mockFetchBskyProfile = fetchBskyProfile as unknown as ReturnType<
  typeof vi.fn
>;

const DID = 'did:plc:test';
const FRESH_PROFILE = {
  avatar: 'https://example.com/avatar.jpg',
  displayName: 'Ken-ichi',
  description: 'Naturalist',
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    avatar_url: null,
    bsky_display_name: null,
    bsky_description: null,
    bsky_profile_fetched_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getCachedBskyProfile', () => {
  test('returns null without fetching when there is no matching users row', async () => {
    mockSql.mockResolvedValueOnce([]);

    const result = await getCachedBskyProfile(DID);

    expect(result).toBeNull();
    expect(mockFetchBskyProfile).not.toHaveBeenCalled();
  });

  test('returns cached data without a live fetch when the cache is fresh', async () => {
    mockSql.mockResolvedValueOnce([
      row({
        avatar_url: 'https://example.com/avatar.jpg',
        bsky_display_name: 'Ken-ichi',
        bsky_description: 'Naturalist',
        bsky_profile_fetched_at: new Date(), // just now: well within the TTL
      }),
    ]);

    const result = await getCachedBskyProfile(DID);

    expect(result).toEqual(FRESH_PROFILE);
    expect(mockFetchBskyProfile).not.toHaveBeenCalled();
  });

  test('fetches live and returns null when the cache confirms no profile and is fresh', async () => {
    mockSql.mockResolvedValueOnce([
      row({ bsky_profile_fetched_at: new Date() }),
    ]);

    const result = await getCachedBskyProfile(DID);

    expect(result).toBeNull();
    expect(mockFetchBskyProfile).not.toHaveBeenCalled();
  });

  test('fetches live and writes back when the cache has never been populated', async () => {
    mockSql.mockResolvedValueOnce([row()]); // bsky_profile_fetched_at: null
    mockFetchBskyProfile.mockResolvedValueOnce(FRESH_PROFILE);
    mockSql.mockResolvedValueOnce([]); // the UPDATE

    const result = await getCachedBskyProfile(DID);

    expect(result).toEqual(FRESH_PROFILE);
    expect(mockFetchBskyProfile).toHaveBeenCalledWith(DID);
    const updateCall = mockSql.mock.calls.find((call: unknown[]) =>
      String((call[0] as string[])[0]).includes('UPDATE users'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall).toContain('https://example.com/avatar.jpg');
    expect(updateCall).toContain('Ken-ichi');
    expect(updateCall).toContain('Naturalist');
  });

  test('fetches live and writes back when the cache is older than the TTL', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    mockSql.mockResolvedValueOnce([
      row({
        avatar_url: 'https://example.com/old.jpg',
        bsky_profile_fetched_at: twoHoursAgo,
      }),
    ]);
    mockFetchBskyProfile.mockResolvedValueOnce(FRESH_PROFILE);
    mockSql.mockResolvedValueOnce([]);

    const result = await getCachedBskyProfile(DID);

    expect(result).toEqual(FRESH_PROFILE);
    expect(mockFetchBskyProfile).toHaveBeenCalledWith(DID);
  });

  // A rate limit, timeout, or outage should back off for the TTL like a
  // success would (so a stale cache doesn't retry on every single view during
  // an outage), but must never blank out data that was there before.
  test('falls back to stale cached data when a refresh attempt fails', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    mockSql.mockResolvedValueOnce([
      row({
        avatar_url: 'https://example.com/avatar.jpg',
        bsky_display_name: 'Ken-ichi',
        bsky_description: 'Naturalist',
        bsky_profile_fetched_at: twoHoursAgo,
      }),
    ]);
    mockFetchBskyProfile.mockResolvedValueOnce(null);
    mockSql.mockResolvedValueOnce([]); // the UPDATE

    const result = await getCachedBskyProfile(DID);

    expect(result).toEqual(FRESH_PROFILE);
    const updateCall = mockSql.mock.calls.find((call: unknown[]) =>
      String((call[0] as string[])[0]).includes('UPDATE users'),
    );
    expect(updateCall).toContain('https://example.com/avatar.jpg');
    expect(updateCall).toContain('Ken-ichi');
    expect(updateCall).toContain('Naturalist');
  });

  test('returns null when a refresh attempt fails and there was never any cached data', async () => {
    mockSql.mockResolvedValueOnce([row()]); // bsky_profile_fetched_at: null
    mockFetchBskyProfile.mockResolvedValueOnce(null);
    mockSql.mockResolvedValueOnce([]);

    const result = await getCachedBskyProfile(DID);

    expect(result).toBeNull();
  });

  test('advances fetched_at even when a refresh attempt fails, so a stale cache is not retried on every view', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    mockSql.mockResolvedValueOnce([
      row({ bsky_profile_fetched_at: twoHoursAgo }),
    ]);
    mockFetchBskyProfile.mockResolvedValueOnce(null);
    mockSql.mockResolvedValueOnce([]);

    await getCachedBskyProfile(DID);

    const updateCall = mockSql.mock.calls.find((call: unknown[]) =>
      String((call[0] as string[])[0]).includes('UPDATE users'),
    );
    expect(updateCall).toBeDefined();
  });
});
