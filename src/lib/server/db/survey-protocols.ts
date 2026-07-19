import type { ISql } from 'postgres';
import type { Main as AtProtocolTarget } from '$lib/lexicons/bio/cuanto/protocolTarget.defs.js';
import type { Main as AtSurveyProtocol } from '$lib/lexicons/bio/cuanto/surveyProtocol.defs.js';
import type { Protocol, Target } from '$lib/offline/db.js';
import sql from './index.js';

// db defaults to the module-level connection but accepts a transaction handle
// (from sql.begin) so a caller that must insert a protocol and its targets
// atomically can do so (see backfillProtocol in the tap webhook). Without
// that, a reader between the two statements could see the protocol as
// indexed with zero targets, which reconcileRetirements
// (materialize-targets.ts) reads as "all targets were removed" and
// mass-retires every surveyor's targets. scripts/reindex-protocol.ts has the
// same failure mode but doesn't use these helpers, so it wraps its own
// writes in a transaction directly.
export async function insertProtocol(
  did: string,
  rkey: string,
  record: AtSurveyProtocol,
  atUri: string,
  cid: string,
  db: ISql = sql,
): Promise<void> {
  await db`
    INSERT INTO survey_protocols (at_uri, did, rkey, cid, record, indexed_at)
    VALUES (
      ${atUri},
      ${did},
      ${rkey},
      ${cid},
      ${db.json(record as Parameters<typeof db.json>[0])},
      now()
    )
    ON CONFLICT (at_uri) DO UPDATE SET
      cid = EXCLUDED.cid,
      record = EXCLUDED.record
  `;
}

// A create/update event means the record currently exists on the PDS, so this
// clears deleted_at on conflict -- the write-side half of the tombstone: if a
// protocolTarget reappears (or a stale delete is corrected) under the same
// at_uri, the next create/update event un-tombstones it.
export async function insertProtocolTarget(
  did: string,
  rkey: string,
  record: AtProtocolTarget,
  atUri: string,
  db: ISql = sql,
): Promise<void> {
  await db`
    INSERT INTO protocol_targets (at_uri, did, rkey, protocol_uri, record, indexed_at)
    VALUES (
      ${atUri},
      ${did},
      ${rkey},
      ${record.protocol},
      ${db.json(record as Parameters<typeof db.json>[0])},
      now()
    )
    ON CONFLICT (at_uri) DO UPDATE SET
      protocol_uri = EXCLUDED.protocol_uri,
      record = EXCLUDED.record,
      deleted_at = NULL
  `;
}

// Tombstones rather than hard-deletes: reconcileRetirements (materialize-targets.ts)
// needs to tell "the author deleted this target" (deleted_at set) apart from "we
// haven't indexed it yet" (no row at all).
export async function deleteProtocolTargetsByUris(
  uris: string[],
): Promise<void> {
  if (uris.length === 0) return;
  await sql`
    UPDATE protocol_targets SET deleted_at = now()
    WHERE at_uri = ANY(${uris}) AND deleted_at IS NULL
  `;
}

export interface ProtocolRow {
  at_uri: string;
  rkey: string;
  cid: string | null;
  handle: string;
  avatar_url: string | null;
  record: AtSurveyProtocol;
  followed_at?: string;
  last_survey_at?: string;
}

interface ProtocolTargetRow {
  protocol_uri: string;
  at_uri: string;
  record: AtProtocolTarget;
}

export async function getProtocolTargetsForProtocols(
  protocolUris: string[],
): Promise<ProtocolTargetRow[]> {
  if (protocolUris.length === 0) return [];
  return sql<ProtocolTargetRow[]>`
    SELECT protocol_uri, at_uri, record
    FROM protocol_targets
    WHERE protocol_uri = ANY(${protocolUris}) AND deleted_at IS NULL
  `;
}

export interface ProtocolTargetStatusRow {
  rkey: string;
  deleted_at: Date | null;
}

// Every protocolTarget ever indexed for the protocol, live or tombstoned, keyed
// by rkey -- reconcileRetirements (materialize-targets.ts) needs this to
// distinguish "deleted" (deleted_at set) from "never indexed" (no row at all),
// which getProtocolTargetsForProtocols' live-only view can't express.
export async function getProtocolTargetStatusesByProtocol(
  protocolUri: string,
): Promise<ProtocolTargetStatusRow[]> {
  return sql<ProtocolTargetStatusRow[]>`
    SELECT rkey, deleted_at
    FROM protocol_targets
    WHERE protocol_uri = ${protocolUri}
  `;
}

function toProtocolTarget(row: ProtocolTargetRow): Target {
  return { atUri: row.at_uri, record: row.record };
}

export async function getProtocolByUri(
  uri: string,
): Promise<ProtocolRow | null> {
  const [row] = await sql<ProtocolRow[]>`
    SELECT sp.at_uri, sp.rkey, sp.cid, sp.record, u.handle, u.avatar_url
    FROM survey_protocols sp
    JOIN users u ON u.did = sp.did
    WHERE sp.at_uri = ${uri}
    LIMIT 1
  `;
  return row ?? null;
}

async function getProtocolByDidAndRkey(
  did: string,
  rkey: string,
): Promise<ProtocolRow | null> {
  const [row] = await sql<ProtocolRow[]>`
    SELECT sp.at_uri, sp.rkey, sp.cid, sp.record, u.handle, u.avatar_url
    FROM survey_protocols sp
    JOIN users u ON u.did = sp.did
    WHERE sp.did = ${did} AND sp.rkey = ${rkey}
    LIMIT 1
  `;
  return row ?? null;
}

function toProtocol(row: ProtocolRow, targets: ProtocolTargetRow[]): Protocol {
  return {
    atUri: row.at_uri,
    rkey: row.rkey,
    handle: row.handle,
    avatarUrl: row.avatar_url ?? undefined,
    record: row.record,
    targets: targets.map(toProtocolTarget),
    ...(row.followed_at ? { followedAt: row.followed_at } : {}),
    ...(row.last_survey_at ? { lastSurveyAt: row.last_survey_at } : {}),
  };
}

function groupTargetsByProtocol(
  targets: ProtocolTargetRow[],
): Map<string, ProtocolTargetRow[]> {
  const map = new Map<string, ProtocolTargetRow[]>();
  for (const t of targets) {
    const list = map.get(t.protocol_uri) ?? [];
    list.push(t);
    map.set(t.protocol_uri, list);
  }
  return map;
}

export async function getProtocolDetailByHandleAndRkey(
  handle: string,
  rkey: string,
): Promise<Protocol | null> {
  const [user] = await sql<{ did: string }[]>`
    SELECT did FROM users WHERE handle = ${handle.toLowerCase()}
  `;
  if (!user) return null;
  const protocol = await getProtocolByDidAndRkey(user.did, rkey);
  if (!protocol) return null;
  const targets = await getProtocolTargetsForProtocols([protocol.at_uri]);
  return toProtocol(protocol, targets);
}

export async function getFollowedProtocolsByDid(
  did: string,
): Promise<Protocol[]> {
  // last_survey_at is the most recent survey (by any user) of any of the
  // protocol's targets — same "last survey" concept shown per-target on the
  // protocol detail page, aggregated to protocol level for sorting here.
  const rows = await sql<ProtocolRow[]>`
    SELECT sp.at_uri, sp.rkey, sp.cid, sp.record, u.handle, u.avatar_url,
           pf.created_at AS followed_at,
           ls.last_survey_at
    FROM protocol_follows pf
    JOIN survey_protocols sp ON sp.at_uri = pf.protocol_uri
    JOIN users u ON u.did = sp.did
    LEFT JOIN (
      SELECT
        s.protocol_uri,
        MAX(COALESCE(s.event_date, s.created_at)) AS last_survey_at
      FROM surveys s
      WHERE s.protocol_uri IN (
        SELECT protocol_uri FROM protocol_follows WHERE did = ${did}
      )
      AND s.did = ${did}
      GROUP BY s.protocol_uri
    ) ls ON ls.protocol_uri = sp.at_uri
    WHERE pf.did = ${did}
    ORDER BY pf.created_at DESC
  `;
  const protocolUris = rows.map((r) => r.at_uri);
  const targetRows = await getProtocolTargetsForProtocols(protocolUris);
  const byProtocol = groupTargetsByProtocol(targetRows);
  return rows.map((p) => toProtocol(p, byProtocol.get(p.at_uri) ?? []));
}

export async function getProtocolsPage(
  offset: number = 0,
  limit: number = 100,
) {
  const rows = await sql<ProtocolRow[]>`
    SELECT sp.at_uri, sp.rkey, sp.cid, sp.record, u.handle, u.avatar_url
    FROM survey_protocols sp
    JOIN users u ON u.did = sp.did
    ORDER BY sp.indexed_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  const protocolUris = rows.map((r) => r.at_uri);
  const targetRows = await getProtocolTargetsForProtocols(protocolUris);
  const byProtocol = groupTargetsByProtocol(targetRows);
  return rows.map((p) => toProtocol(p, byProtocol.get(p.at_uri) ?? []));
}

export async function getProtocolsPageByDid(
  did: string,
  offset: number = 0,
  limit: number = 100,
) {
  const rows = await sql<ProtocolRow[]>`
    SELECT
      sp.at_uri, sp.rkey, sp.cid, sp.record, u.handle, u.avatar_url
    FROM survey_protocols sp
    JOIN users u ON u.did = sp.did
    WHERE sp.did = ${did}
    ORDER BY sp.indexed_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return rows.map((r) => toProtocol(r, []));
}

export type ProtocolSearchResult = {
  atUri: string;
  handle: string;
  title: string;
};

export async function getProtocolsByUris(
  uris: string[],
): Promise<ProtocolSearchResult[]> {
  if (uris.length === 0) return [];
  const rows = await sql<{ at_uri: string; handle: string; title: string }[]>`
    SELECT sp.at_uri, u.handle, sp.record->>'title' AS title
    FROM survey_protocols sp
    JOIN users u ON u.did = sp.did
    WHERE sp.at_uri = ANY(${uris})
  `;
  const byUri = new Map(
    rows.map((r) => [
      r.at_uri,
      { atUri: r.at_uri, handle: r.handle, title: r.title },
    ]),
  );
  return uris.flatMap((uri) => {
    const entry = byUri.get(uri);
    return entry ? [entry] : [];
  });
}

export async function searchProtocols(
  query: string,
  limit: number = 10,
): Promise<ProtocolSearchResult[]> {
  const rows = await sql<{ at_uri: string; handle: string; title: string }[]>`
    SELECT sp.at_uri, u.handle, sp.record->>'title' AS title
    FROM survey_protocols sp
    JOIN users u ON u.did = sp.did
    WHERE sp.record->>'title' ILIKE ${`%${query}%`}
    ORDER BY sp.indexed_at DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    atUri: r.at_uri,
    handle: r.handle,
    title: r.title,
  }));
}
