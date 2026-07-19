import { IdResolver } from '@atproto/identity';
import postgres from 'postgres';

const TARGET_NSID = 'bio.cuanto.protocolTarget';

interface AtRecord {
  uri: string;
  cid: string;
  value: unknown;
}

function parseAtUri(uri: string): {
  did: string;
  collection: string;
  rkey: string;
} {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!match) throw new Error(`Invalid AT-URI: ${uri}`);
  return { did: match[1], collection: match[2], rkey: match[3] };
}

const idResolver = new IdResolver();

async function resolveHandle(did: string): Promise<string | null> {
  try {
    const data = await idResolver.did.resolveAtprotoData(did);
    return data.handle === 'handle.invalid' ? null : data.handle;
  } catch {
    return null;
  }
}

async function fetchAvatarUrl(did: string): Promise<string | null> {
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

async function fetchAtRecord(atUri: string, pdsUrl: string): Promise<AtRecord> {
  const { did, collection, rkey } = parseAtUri(atUri);
  const url = new URL(`${pdsUrl}/xrpc/com.atproto.repo.getRecord`);
  url.searchParams.set('repo', did);
  url.searchParams.set('collection', collection);
  url.searchParams.set('rkey', rkey);
  const resp = await fetch(url);
  if (!resp.ok)
    throw new Error(`Failed to fetch record ${atUri}: ${resp.status}`);
  return resp.json() as Promise<AtRecord>;
}

async function listAtRecords(
  did: string,
  collection: string,
  pdsUrl: string,
): Promise<AtRecord[]> {
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

async function main() {
  const protocolUri = process.argv[2];
  if (!protocolUri) {
    console.error('Usage: reindex-protocol.ts <protocol-at-uri>');
    console.error(
      'Example: reindex-protocol.ts at://did:plc:abc123/bio.cuanto.surveyProtocol/abc',
    );
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const sql = postgres(dbUrl);
  try {
    const { did, rkey } = parseAtUri(protocolUri);
    const atProtoData = await idResolver.did.resolveAtprotoData(did);
    const pdsUrl = atProtoData.pds;

    console.log(`Fetching protocol ${protocolUri}...`);
    const rec = await fetchAtRecord(protocolUri, pdsUrl);

    const [handle, avatarUrl] = await Promise.all([
      resolveHandle(did),
      fetchAvatarUrl(did),
    ]);
    if (handle) {
      await sql`
        INSERT INTO users (did, handle, avatar_url)
        VALUES (${did}, ${handle.toLowerCase()}, ${avatarUrl ?? null})
        ON CONFLICT (did) DO UPDATE SET handle = EXCLUDED.handle, avatar_url = EXCLUDED.avatar_url
      `;
      console.log(`Upserted user ${handle}`);
    }

    const protocol = rec.value as Record<string, unknown>;

    console.log(`Fetching targets for DID ${did}...`);
    const allTargets = await listAtRecords(did, TARGET_NSID, pdsUrl);
    const protocolTargets = allTargets.filter(
      (t) => (t.value as Record<string, unknown>).protocol === protocolUri,
    );
    console.log(`Found ${protocolTargets.length} target(s) for this protocol`);

    // Insert the protocol and its targets in one transaction. Otherwise a
    // reader between the two writes (e.g. reconcileRetirements in
    // materialize-targets.ts) sees the protocol as indexed with zero targets
    // and mistakes "not yet reindexed" for "the author deleted every target,"
    // mass-retiring every surveyor's targets for it.
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO survey_protocols (at_uri, did, rkey, cid, record, indexed_at)
        VALUES (${protocolUri}, ${did}, ${rkey}, ${rec.cid}, ${tx.json(protocol)}, now())
        ON CONFLICT (at_uri) DO UPDATE SET cid = EXCLUDED.cid, record = EXCLUDED.record
      `;
      console.log('Upserted protocol');

      for (const t of protocolTargets) {
        const { rkey: tRkey } = parseAtUri(t.uri);
        const target = t.value as Record<string, unknown>;
        await tx`
          INSERT INTO protocol_targets (at_uri, did, rkey, protocol_uri, record, indexed_at)
          VALUES (${t.uri}, ${did}, ${tRkey}, ${protocolUri}, ${tx.json(target)}, now())
          ON CONFLICT (at_uri) DO UPDATE SET protocol_uri = EXCLUDED.protocol_uri, record = EXCLUDED.record
        `;
        console.log(`Upserted target ${t.uri}`);
      }
    });

    console.log('Done.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
