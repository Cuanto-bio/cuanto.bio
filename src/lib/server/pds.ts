import { IdResolver } from '@atproto/identity';
import {
  OAuthResponseError,
  TokenRefreshError,
  TokenRevokedError,
} from '@atproto/oauth-client-node';
import { parseAtUri } from '$lib/atUri';
import sql from '$lib/server/db';
import logger from '$lib/server/logger';
import { getClient, isScopeSufficient } from './auth.js';

export { parseAtUri };

const log = logger.child({ component: 'pds' });

export class PdsSessionExpiredError extends Error {
  constructor(message = 'AT Protocol session expired. Please sign in again.') {
    super(message);
  }
}

// Thrown instead of PdsSessionExpiredError when a session is still valid but
// was granted before a scope the app now requires (e.g. a newly added
// repo:<nsid>), or the user only partially consented to the requested scope.
// Extends PdsSessionExpiredError so existing `instanceof PdsSessionExpiredError`
// checks across route handlers and UI components already route this through
// the same "please sign in again" flow.
export class PdsScopeInsufficientError extends PdsSessionExpiredError {
  constructor() {
    super(
      'Cuanto needs an additional permission. Please sign in again to grant it.',
    );
  }
}

export function isPdsSessionError(err: unknown): boolean {
  if (err instanceof TokenRevokedError) return true;
  if (err instanceof TokenRefreshError) return true;
  if (err instanceof OAuthResponseError) {
    return (
      err.error === 'invalid_request' ||
      err.error === 'invalid_token' ||
      err.error === 'invalid_grant'
    );
  }
  if (err instanceof Error) {
    return (
      err.message.includes('OAuth "invalid_request"') ||
      err.message.includes('OAuth "invalid_token"') ||
      err.message.includes('OAuth "invalid_grant"')
    );
  }
  return false;
}

let mockSeq = 0;
const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';

const idResolver = new IdResolver();

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

type FetchFn = typeof fetch;

/** Wraps fetch with retry logic for 429 responses, honouring Retry-After. */
export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit,
  fetchFn: FetchFn = fetch,
): Promise<Response> {
  let attempt = 0;
  while (true) {
    const resp = await fetchFn(url, init);
    if (resp.status !== 429) return resp;
    if (attempt >= MAX_RETRIES)
      throw new Error(`HTTP 429 after ${MAX_RETRIES} retries`);

    const retryAfter = resp.headers.get('Retry-After');
    const delayMs = retryAfter
      ? parseFloat(retryAfter) * 1000
      : BASE_DELAY_MS * 2 ** attempt;

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    attempt++;
  }
}

export interface AtRecord {
  uri: string;
  cid: string;
  value: unknown;
}

/** Returns the ATProto handle for a DID, or null if none is found or on error. */
export async function resolveHandle(did: string): Promise<string | null> {
  try {
    const data = await idResolver.did.resolveAtprotoData(did);
    return data.handle === 'handle.invalid' ? null : data.handle;
  } catch {
    return null;
  }
}

export interface BskyProfile {
  avatar: string | null;
  displayName: string | null;
  description: string | null;
}

/** Returns the public app.bsky.actor.profile view for a DID, or null if unavailable. */
export async function fetchBskyProfile(
  did: string,
): Promise<BskyProfile | null> {
  try {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      log.warn(
        { did, status: resp.status },
        'Bluesky getProfile returned a non-ok response',
      );
      return null;
    }
    const data = (await resp.json()) as {
      avatar?: string;
      displayName?: string;
      description?: string;
    };
    // getProfile returns displayName/description as "" (not an absent field)
    // for a user who never set one, so treat blank the same as missing.
    const avatar = data.avatar || null;
    const displayName = data.displayName || null;
    const description = data.description || null;
    // No avatar, displayName, or description means there's nothing
    // resembling an app.bsky.actor.profile record worth showing as a
    // Bluesky profile.
    if (!avatar && !displayName && !description) return null;
    return { avatar, displayName, description };
  } catch (err) {
    log.error({ did, err }, 'Bluesky getProfile fetch failed');
    return null;
  }
}

/** Returns the Bluesky avatar URL for a DID, or null if unavailable. */
export async function fetchAvatarUrl(did: string): Promise<string | null> {
  const profile = await fetchBskyProfile(did);
  return profile?.avatar ?? null;
}

export async function listAtRecords(
  did: string,
  collection: string,
): Promise<AtRecord[]> {
  const data = await idResolver.did.resolveAtprotoData(did);
  const pdsUrl = data.pds;
  const all: AtRecord[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${pdsUrl}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set('repo', did);
    url.searchParams.set('collection', collection);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const resp = await fetchWithRetry(url, {});
    if (!resp.ok)
      throw new Error(
        `Failed to list records for ${did}/${collection}: ${resp.status}`,
      );
    const body = (await resp.json()) as {
      records: AtRecord[];
      cursor?: string;
    };
    all.push(...body.records);
    cursor = body.cursor;
  } while (cursor);

  return all;
}

export async function fetchAtRecord(atUri: string): Promise<AtRecord | null> {
  const { did, collection, rkey } = parseAtUri(atUri);
  const data = await idResolver.did.resolveAtprotoData(did);
  const pdsUrl = data.pds;

  const url = new URL(`${pdsUrl}/xrpc/com.atproto.repo.getRecord`);
  url.searchParams.set('repo', did);
  url.searchParams.set('collection', collection);
  url.searchParams.set('rkey', rkey);

  const resp = await fetchWithRetry(url, {});
  if (!resp.ok) {
    const body = (await resp.json()) as { error?: string };
    if (resp.status === 400 && body.error === 'RecordNotFound') return null;
    throw new Error(
      `Failed to fetch record ${url} [status: ${resp.status}]: ${JSON.stringify(body)}`,
    );
  }
  return resp.json() as Promise<AtRecord>;
}

/**
 * Creates a record on the PDS.
 *
 * When PDS_MOCK=true, returns a fake AT-URI/CID without making any HTTP call.
 * This exists because Playwright integration tests run the app as a live server
 * process, which means there is no way to mock this function from the test layer
 * (e.g. vi.mock) — any mocking must be configured via the environment.
 */
async function getGrantedScope(did: string): Promise<string | undefined> {
  const rows = await sql<{ scope: string | null }[]>`
    SELECT value->'tokenSet'->>'scope' AS scope FROM oauth_sessions WHERE key = ${did}
  `;
  return rows[0]?.scope ?? undefined;
}

async function withSessionErrorHandling<T>(
  did: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isScopeSufficient(await getGrantedScope(did))) {
    await sql`DELETE FROM oauth_sessions WHERE key = ${did}`;
    throw new PdsScopeInsufficientError();
  }
  try {
    return await fn();
  } catch (err) {
    if (isPdsSessionError(err)) {
      await sql`DELETE FROM oauth_sessions WHERE key = ${did}`;
      throw new PdsSessionExpiredError();
    }
    throw err;
  }
}

// Validates that the stored OAuth session for a DID is usable (refreshing the
// token if needed), throwing PdsSessionExpiredError if it is dead. Cheap enough
// to await before kicking off a long-running background migration so the caller
// gets immediate re-auth feedback.
export async function assertActiveSession(did: string): Promise<void> {
  if (process.env.PDS_MOCK === 'true') return;
  await withSessionErrorHandling(did, async () => {
    await (await getClient()).restore(did);
  });
}

export async function createRecord(
  did: string,
  collection: string,
  record: unknown,
): Promise<{ uri: string; cid: string }> {
  if (process.env.PDS_MOCK === 'true') {
    mockSeq++;
    return { uri: `at://${did}/${collection}/test${mockSeq}`, cid: FAKE_CID };
  }

  return withSessionErrorHandling(did, async () => {
    const session = await (await getClient()).restore(did);
    const resp = await session.fetchHandler(
      '/xrpc/com.atproto.repo.createRecord',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: did, collection, record }),
      },
    );
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json() as Promise<{ uri: string; cid: string }>;
  });
}

export interface BlobRefResponse {
  $type: 'blob';
  ref: { $link: string };
  mimeType: string;
  size: number;
}

/**
 * Uploads a blob to the PDS.
 *
 * When PDS_MOCK=true, returns a fake BlobRef without making any HTTP call.
 */
export async function uploadBlob(
  did: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<BlobRefResponse> {
  if (process.env.PDS_MOCK === 'true') {
    return {
      $type: 'blob',
      ref: { $link: FAKE_CID },
      mimeType,
      size: bytes.byteLength,
    };
  }

  return withSessionErrorHandling(did, async () => {
    const session = await (await getClient()).restore(did);
    const resp = await session.fetchHandler(
      '/xrpc/com.atproto.repo.uploadBlob',
      {
        method: 'POST',
        headers: { 'Content-Type': mimeType },
        body: new Blob([bytes as BlobPart], { type: mimeType }),
      },
    );
    if (!resp.ok) throw new Error(await resp.text());
    const body = (await resp.json()) as { blob: BlobRefResponse };
    return body.blob;
  });
}

/**
 * Fetches a blob from the user's PDS by CID.
 *
 * Returns the raw fetch Response so callers can stream the body or inspect headers.
 * When PDS_MOCK=true, returns a fake response with no body.
 */
export async function fetchBlob(did: string, cid: string): Promise<Response> {
  if (process.env.PDS_MOCK === 'true') {
    return new Response('', { status: 200 });
  }
  const data = await idResolver.did.resolveAtprotoData(did);
  const pdsUrl = data.pds;
  const url = new URL(`${pdsUrl}/xrpc/com.atproto.sync.getBlob`);
  url.searchParams.set('did', did);
  url.searchParams.set('cid', cid);
  return fetchWithRetry(url, {});
}

/**
 * Updates (or creates) a record on the PDS at a specific rkey.
 *
 * When PDS_MOCK=true, returns the expected AT-URI/CID without making any HTTP call.
 */
export async function putRecord(
  did: string,
  collection: string,
  rkey: string,
  record: unknown,
): Promise<{ uri: string; cid: string }> {
  if (process.env.PDS_MOCK === 'true') {
    return { uri: `at://${did}/${collection}/${rkey}`, cid: FAKE_CID };
  }

  return withSessionErrorHandling(did, async () => {
    const session = await (await getClient()).restore(did);
    const resp = await session.fetchHandler(
      '/xrpc/com.atproto.repo.putRecord',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: did, collection, rkey, record }),
      },
    );
    if (!resp.ok) throw new Error(await resp.text());
    return resp.json() as Promise<{ uri: string; cid: string }>;
  });
}

/**
 * Deletes a record from the PDS by AT-URI.
 *
 * When PDS_MOCK=true, does nothing (the record was never really created).
 */
export async function deleteRecord(atUri: string): Promise<void> {
  if (process.env.PDS_MOCK === 'true') return;

  const { did, collection, rkey } = parseAtUri(atUri);
  return withSessionErrorHandling(did, async () => {
    const session = await (await getClient()).restore(did);
    const resp = await session.fetchHandler(
      '/xrpc/com.atproto.repo.deleteRecord',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: did, collection, rkey }),
      },
    );
    if (!resp.ok) throw new Error(await resp.text());
  });
}
