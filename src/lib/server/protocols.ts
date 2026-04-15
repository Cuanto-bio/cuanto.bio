import type { Main as SurveyProtocol } from '$lib/lexicons/bio/lexicons/temp/surveyProtocol.defs.js';
import type { Main as SurveyTarget } from '$lib/lexicons/bio/lexicons/temp/surveyTarget.defs.js';
import sql from './db.js';

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
