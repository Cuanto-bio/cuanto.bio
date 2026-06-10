import type { Main as AtSurveyTarget } from '$lib/lexicons/bio/cuanto/surveyTarget.defs.js';
import sql from './index.js';

export interface SurveyTargetRow {
  at_uri: string;
  rkey: string;
  protocol_uri: string;
  protocol_target_uri: string;
  record: AtSurveyTarget;
}

export async function insertSurveyTarget(
  did: string,
  rkey: string,
  record: AtSurveyTarget,
  atUri: string,
  protocolTargetUri: string,
): Promise<void> {
  const targetCreatedAt = record.createdAt ? new Date(record.createdAt) : null;
  await sql`
    INSERT INTO survey_targets (
      at_uri, did, rkey, protocol_uri, protocol_target_uri, record,
      indexed_at, created_at
    )
    VALUES (
      ${atUri},
      ${did},
      ${rkey},
      ${record.protocol},
      ${protocolTargetUri},
      ${sql.json(record as Parameters<typeof sql.json>[0])},
      now(),
      ${targetCreatedAt}
    )
    ON CONFLICT (at_uri) DO UPDATE SET
      protocol_uri = EXCLUDED.protocol_uri,
      protocol_target_uri = EXCLUDED.protocol_target_uri,
      record = EXCLUDED.record,
      created_at = EXCLUDED.created_at
  `;
}

export async function getSurveyTargetsByDidAndProtocol(
  did: string,
  protocolUri: string,
): Promise<SurveyTargetRow[]> {
  return sql<SurveyTargetRow[]>`
    SELECT at_uri, rkey, protocol_uri, protocol_target_uri, record
    FROM survey_targets
    WHERE did = ${did} AND protocol_uri = ${protocolUri}
  `;
}

// Deletes all of a surveyor's targets for a protocol and returns their AT-URIs so
// the caller can delete the corresponding PDS records.
export async function deleteSurveyTargetsByDidAndProtocol(
  did: string,
  protocolUri: string,
): Promise<string[]> {
  const rows = await sql<{ at_uri: string }[]>`
    DELETE FROM survey_targets
    WHERE did = ${did} AND protocol_uri = ${protocolUri}
    RETURNING at_uri
  `;
  return rows.map((r) => r.at_uri);
}

export async function deleteSurveyTargetByUri(atUri: string): Promise<void> {
  await sql`DELETE FROM survey_targets WHERE at_uri = ${atUri}`;
}
