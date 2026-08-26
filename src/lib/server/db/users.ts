import { type BskyProfile, fetchBskyProfile } from '$lib/server/pds';
import sql from './index.js';

const BSKY_PROFILE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export type UserSearchResult = {
  did: string;
  handle: string;
};

// Powers the surveyor picker on Stats Explorer.
export async function searchUsers(
  query: string,
  limit: number = 10,
): Promise<UserSearchResult[]> {
  const rows = await sql<{ did: string; handle: string }[]>`
    SELECT did, handle
    FROM users
    WHERE handle ILIKE ${`%${query}%`}
    ORDER BY handle
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ did: r.did, handle: r.handle }));
}

// Resolves a surveyedBy did to a handle for display, e.g. the "Surveys by
// @handle" chip on Stats Explorer and /surveys. Returns null for an unknown
// did so callers can degrade to an unfiltered view rather than show a chip
// for a user that doesn't exist.
export async function getHandleByDid(did: string): Promise<string | null> {
  const [row] = await sql<{ handle: string }[]>`
    SELECT handle FROM users WHERE did = ${did}
  `;
  return row?.handle ?? null;
}

export type UserByHandle = { did: string; handle: string };

export async function getUserByHandle(
  handle: string,
): Promise<UserByHandle | null> {
  const [row] = await sql<UserByHandle[]>`
    SELECT did, handle FROM users WHERE handle = ${handle.toLowerCase()}
  `;
  return row ?? null;
}

type CachedBskyProfileRow = {
  avatar_url: string | null;
  bsky_display_name: string | null;
  bsky_description: string | null;
  bsky_profile_fetched_at: Date | null;
};

function rowToBskyProfile(row: CachedBskyProfileRow): BskyProfile | null {
  if (!row.avatar_url && !row.bsky_display_name && !row.bsky_description) {
    return null;
  }
  return {
    avatar: row.avatar_url,
    displayName: row.bsky_display_name,
    description: row.bsky_description,
  };
}

// Read-through cache for the Bluesky profile card on /profile/[handle].
// fetchBskyProfile hits a live, external, rate-limited API; calling it on
// every page view would make that page's latency and reliability depend
// entirely on Bluesky's API being fast and up. Cached fields live on the
// same users row as avatar_url.
//
// fetched_at advances on every refresh attempt, success or failure, so a
// rate limit or outage is retried at most once per TTL per did rather than
// on every view -- but a failed attempt never overwrites previously-cached
// fields with a blank result, so a transient failure doesn't blank out data
// that was there before.
export async function getCachedBskyProfile(
  did: string,
): Promise<BskyProfile | null> {
  const [row] = await sql<CachedBskyProfileRow[]>`
    SELECT avatar_url, bsky_display_name, bsky_description, bsky_profile_fetched_at
    FROM users
    WHERE did = ${did}
  `;
  if (!row) return null;

  const isFresh =
    row.bsky_profile_fetched_at != null &&
    Date.now() - row.bsky_profile_fetched_at.getTime() <
      BSKY_PROFILE_CACHE_TTL_MS;
  if (isFresh) return rowToBskyProfile(row);

  const fetched = await fetchBskyProfile(did);
  await sql`
    UPDATE users
    SET
      avatar_url = ${fetched ? fetched.avatar : row.avatar_url},
      bsky_display_name = ${fetched ? fetched.displayName : row.bsky_display_name},
      bsky_description = ${fetched ? fetched.description : row.bsky_description},
      bsky_profile_fetched_at = now()
    WHERE did = ${did}
  `;

  return fetched ?? rowToBskyProfile(row);
}

export async function insertUser(
  did: string,
  handle: string,
  avatarUrl?: string | null,
): Promise<void> {
  const normalizedHandle = handle.toLowerCase();
  await sql`
    INSERT INTO users (
      did,
      handle,
      avatar_url
    )
    VALUES (
      ${did},
      ${normalizedHandle},
      ${avatarUrl ?? null}
    )
    ON CONFLICT (did) DO UPDATE SET
      handle = EXCLUDED.handle,
      avatar_url = EXCLUDED.avatar_url
  `;
}
