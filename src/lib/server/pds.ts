import { IdResolver } from '@atproto/identity';
import { getClient } from './auth.js';

let mockSeq = 0;
const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';

const idResolver = new IdResolver();

export interface AtRecord {
  uri: string;
  cid: string;
  value: unknown;
}

export function parseAtUri(uri: string): {
  did: string;
  collection: string;
  rkey: string;
} {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!match) throw new Error(`Invalid AT-URI: ${uri}`);
  return { did: match[1], collection: match[2], rkey: match[3] };
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

/** Returns the Bluesky avatar URL for a DID, or null if unavailable. */
export async function fetchAvatarUrl(did: string): Promise<string | null> {
  try {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = (await resp.json()) as { avatar?: string };
    return data.avatar ?? null;
  } catch {
    return null;
  }
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

    const resp = await fetch(url);
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

export async function fetchAtRecord(atUri: string): Promise<AtRecord> {
  const { did, collection, rkey } = parseAtUri(atUri);
  const data = await idResolver.did.resolveAtprotoData(did);
  const pdsUrl = data.pds;

  const url = new URL(`${pdsUrl}/xrpc/com.atproto.repo.getRecord`);
  url.searchParams.set('repo', did);
  url.searchParams.set('collection', collection);
  url.searchParams.set('rkey', rkey);

  const resp = await fetch(url);
  if (!resp.ok)
    throw new Error(`Failed to fetch record ${atUri}: ${resp.status}`);
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
export async function createRecord(
  did: string,
  collection: string,
  record: unknown,
): Promise<{ uri: string; cid: string }> {
  if (process.env.PDS_MOCK === 'true') {
    mockSeq++;
    return { uri: `at://${did}/${collection}/test${mockSeq}`, cid: FAKE_CID };
  }

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
}

/**
 * Deletes a record from the PDS by AT-URI.
 *
 * When PDS_MOCK=true, does nothing (the record was never really created).
 */
export async function deleteRecord(atUri: string): Promise<void> {
  if (process.env.PDS_MOCK === 'true') return;

  const { did, collection, rkey } = parseAtUri(atUri);
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
}
