import type { Main as SurveyProtocol } from '$lib/lexicons/bio/lexicons/temp/surveyProtocol.defs.js';
import type { Main as SurveyTarget } from '$lib/lexicons/bio/lexicons/temp/surveyTarget.defs.js';
import sql from './index.js';

export async function insertProtocol(
  did: string,
  rkey: string,
  record: SurveyProtocol,
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
  record: SurveyTarget,
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
  created_at: string | null;
  cid: string | null;
  handle: string;
}

export interface TargetListRow {
  protocol_uri: string;
  at_uri: string;
  scope: unknown[];
}

export async function getTargetsForProtocols(
  protocolUris: string[],
): Promise<TargetListRow[]> {
  if (protocolUris.length === 0) return [];
  return sql<TargetListRow[]>`
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
