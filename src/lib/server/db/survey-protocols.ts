import type { Main as AtProtocol } from '$lib/lexicons/bio/lexicons/temp/surveyProtocol.defs.js';
import type { Main as AtTarget } from '$lib/lexicons/bio/lexicons/temp/surveyTarget.defs.js';
import type {
  Protocol,
  TargetScope,
  TaxonScope,
  VerbatimScope,
} from '$lib/offline/db.js';
import sql from './index.js';

export async function insertProtocol(
  did: string,
  rkey: string,
  record: AtProtocol,
  atUri: string,
  cid: string,
): Promise<void> {
  await sql`
    INSERT INTO survey_protocols (at_uri, did, rkey, title, description, required_fields, created_at, cid)
    VALUES (
      ${atUri},
      ${did},
      ${rkey},
      ${record.title},
      ${record.description},
      ${sql.array(record.requiredFields ?? [])},
      ${record.createdAt},
      ${cid}
    )
    ON CONFLICT (at_uri) DO NOTHING
  `;
}

export async function insertTarget(
  did: string,
  rkey: string,
  record: AtTarget,
  atUri: string,
): Promise<void> {
  await sql`
    INSERT INTO survey_targets (at_uri, did, rkey, protocol_uri, scope)
    VALUES (
      ${atUri},
      ${did},
      ${rkey},
      ${record.protocol},
      ${sql.json(record.scope as Parameters<typeof sql.json>[0])}
    )
    ON CONFLICT (at_uri) DO NOTHING
  `;
}

export interface ProtocolRow {
  at_uri: string;
  did: string;
  rkey: string;
  title: string;
  description: string;
  required_fields: string | null;
  created_at: string;
  cid: string | null;
  handle: string;
}

export interface TargetRow {
  protocol_uri: string;
  at_uri: string;
  // Since this is stored as JSON blob, the shape matches the lexicon and
  // offline schemas
  scope: TargetScope[];
}

export async function getTargetsForProtocols(
  protocolUris: string[],
): Promise<TargetRow[]> {
  if (protocolUris.length === 0) return [];
  return sql<TargetRow[]>`
    SELECT
      t.protocol_uri,
      t.at_uri,
      t.scope
    FROM survey_targets t
    WHERE t.protocol_uri = ANY(${sql.array(protocolUris)})
  `;
}

export async function getProtocolByUri(uri: string) {
  const [row] = await sql<ProtocolRow[]>`
    SELECT
      survey_protocols.*,
      u.handle
    FROM survey_protocols
      JOIN users u ON u.did = survey_protocols.did
    WHERE at_uri = ${uri}
    LIMIT 1
  `;
  return row ?? null;
}

export async function getProtocolByDidAndRkey(did: string, rkey: string) {
  const [row] = await sql<ProtocolRow[]>`
    SELECT
      sp.at_uri,
      sp.rkey,
      sp.title,
      sp.description,
      sp.required_fields,
      sp.created_at,
      sp.cid,
      u.handle
    FROM survey_protocols sp
      JOIN users u ON u.did = sp.did
    WHERE sp.did = ${did} AND sp.rkey = ${rkey}
    LIMIT 1
  `;
  return row ?? null;
}

export function groupTargetsByProtocol(
  targets: TargetRow[],
): Map<string, Protocol['targets']> {
  const map = new Map<string, Protocol['targets']>();
  for (const t of targets) {
    const list = map.get(t.protocol_uri) ?? [];
    const scope = t.scope.map((s) => {
      if (s.$type.endsWith('taxonScope')) {
        return s as TaxonScope;
      }
      return s as VerbatimScope;
    });
    list.push({
      atUri: t.at_uri,
      scope,
    });
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
  return toProtocolResponse([protocol], groupTargetsByProtocol(targets))[0];
}

export async function getFollowedProtocolsByDid(did: string) {
  return sql<ProtocolRow[]>`
    SELECT
      sp.at_uri,
      sp.rkey,
      sp.title,
      sp.description,
      sp.required_fields,
      sp.created_at,
      sp.cid,
      u.handle
    FROM protocol_follows pf
    JOIN survey_protocols sp ON sp.at_uri = pf.protocol_uri
    JOIN users u ON u.did = sp.did
    WHERE pf.did = ${did}
  `;
}

export function toProtocolResponse(
  protocols: ProtocolRow[],
  targetsByProtocol: Map<string, Protocol['targets']>,
): Protocol[] {
  return protocols.map((p) => ({
    atUri: p.at_uri,
    rkey: p.rkey,
    handle: p.handle,
    targets: targetsByProtocol.get(p.at_uri) ?? [],
    title: p.title,
    description: p.description,
    createdAt: p.created_at,
  }));
}
