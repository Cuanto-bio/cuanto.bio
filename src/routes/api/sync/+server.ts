import { json } from '@sveltejs/kit';
import type { CachedProtocol } from '$lib/offline/db';
import sql from '$lib/server/db';
import {
  getOccurrencesForSurveys,
  getSurveysByDid,
  groupOccurrencesBySurvey,
  toSurveyResponse,
} from '$lib/server/db/surveys';
import type { RequestHandler } from './$types';

const SYNC_SURVEY_LIMIT = 100;

interface ProtocolRow {
  at_uri: string;
  rkey: string;
  title: string;
  description: string;
  handle: string;
}

interface TargetRow {
  protocol_uri: string;
  at_uri: string;
  scope: unknown[];
}

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });

  const protocols = await sql<ProtocolRow[]>`
    SELECT
      sp.at_uri,
      sp.rkey,
      sp.title,
      sp.description,
      u.handle
    FROM protocol_follows pf
    JOIN survey_protocols sp ON sp.at_uri = pf.protocol_uri
    JOIN users u ON u.did = sp.did
    WHERE pf.did = ${locals.did}
  `;

  const protocolUris = protocols.map((p) => p.at_uri);

  const targets =
    protocolUris.length > 0
      ? await sql<TargetRow[]>`
          SELECT protocol_uri, at_uri, scope
          FROM survey_targets
          WHERE protocol_uri = ANY(${sql.array(protocolUris)})
          ORDER BY indexed_at ASC
        `
      : [];

  const targetsByProtocol = new Map<
    string,
    { atUri: string; scope: unknown[] }[]
  >();
  for (const t of targets) {
    const list = targetsByProtocol.get(t.protocol_uri) ?? [];
    list.push({ atUri: t.at_uri, scope: t.scope });
    targetsByProtocol.set(t.protocol_uri, list);
  }

  const followedProtocols: Omit<CachedProtocol, 'cachedAt'>[] = protocols.map(
    (p) => ({
      atUri: p.at_uri,
      rkey: p.rkey,
      title: p.title,
      description: p.description,
      handle: p.handle,
      targets: targetsByProtocol.get(p.at_uri) ?? [],
    }),
  );

  const surveys = await getSurveysByDid(locals.did, SYNC_SURVEY_LIMIT);
  const occurrences = await getOccurrencesForSurveys(
    surveys.map((s) => s.at_uri),
  );

  return json({
    followedProtocols,
    surveys: toSurveyResponse(surveys, groupOccurrencesBySurvey(occurrences)),
  });
};
