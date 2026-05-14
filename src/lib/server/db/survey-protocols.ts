import type { Main as AtSurveyProtocol } from '$lib/lexicons/bio/lexicons/temp/v0-1/surveyProtocol.defs.js';
import type { Main as AtSurveyTarget } from '$lib/lexicons/bio/lexicons/temp/v0-1/surveyTarget.defs.js';
import type { Protocol, Target } from '$lib/offline/db.js';
import sql from './index.js';

export async function insertProtocol(
  did: string,
  rkey: string,
  record: AtSurveyProtocol,
  atUri: string,
  cid: string,
): Promise<void> {
  await sql`
    INSERT INTO survey_protocols (at_uri, did, rkey, cid, record, indexed_at)
    VALUES (
      ${atUri},
      ${did},
      ${rkey},
      ${cid},
      ${sql.json(record as Parameters<typeof sql.json>[0])},
      now()
    )
    ON CONFLICT (at_uri) DO UPDATE SET
      cid = EXCLUDED.cid,
      record = EXCLUDED.record
  `;
}

export async function insertTarget(
  did: string,
  rkey: string,
  record: AtSurveyTarget,
  atUri: string,
): Promise<void> {
  await sql`
    INSERT INTO survey_targets (at_uri, did, rkey, protocol_uri, record, indexed_at)
    VALUES (
      ${atUri},
      ${did},
      ${rkey},
      ${record.protocol},
      ${sql.json(record as Parameters<typeof sql.json>[0])},
      now()
    )
    ON CONFLICT (at_uri) DO UPDATE SET
      protocol_uri = EXCLUDED.protocol_uri,
      record = EXCLUDED.record
  `;
}

export async function deleteTargetsByUris(uris: string[]): Promise<void> {
  if (uris.length === 0) return;
  await sql`DELETE FROM survey_targets WHERE at_uri = ANY(${sql.array(uris)})`;
}

export interface ProtocolRow {
  at_uri: string;
  rkey: string;
  cid: string | null;
  handle: string;
  avatar_url: string | null;
  record: AtSurveyProtocol;
}

interface TargetRow {
  protocol_uri: string;
  at_uri: string;
  record: AtSurveyTarget;
}

export async function getTargetsForProtocols(
  protocolUris: string[],
): Promise<TargetRow[]> {
  if (protocolUris.length === 0) return [];
  return sql<TargetRow[]>`
    SELECT protocol_uri, at_uri, record
    FROM survey_targets
    WHERE protocol_uri = ANY(${sql.array(protocolUris)})
  `;
}

function toTarget(row: TargetRow): Target {
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

function toProtocol(row: ProtocolRow, targets: TargetRow[]): Protocol {
  return {
    atUri: row.at_uri,
    rkey: row.rkey,
    handle: row.handle,
    avatarUrl: row.avatar_url ?? undefined,
    record: row.record,
    targets: targets.map(toTarget),
  };
}

function groupTargetsByProtocol(
  targets: TargetRow[],
): Map<string, TargetRow[]> {
  const map = new Map<string, TargetRow[]>();
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
  const targets = await getTargetsForProtocols([protocol.at_uri]);
  return toProtocol(protocol, targets);
}

export async function getFollowedProtocolsByDid(
  did: string,
): Promise<Protocol[]> {
  const rows = await sql<ProtocolRow[]>`
    SELECT sp.at_uri, sp.rkey, sp.cid, sp.record, u.handle, u.avatar_url
    FROM protocol_follows pf
    JOIN survey_protocols sp ON sp.at_uri = pf.protocol_uri
    JOIN users u ON u.did = sp.did
    WHERE pf.did = ${did}
  `;
  const protocolUris = rows.map((r) => r.at_uri);
  const targetRows = await getTargetsForProtocols(protocolUris);
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
  return rows.map((r) => toProtocol(r, []));
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
