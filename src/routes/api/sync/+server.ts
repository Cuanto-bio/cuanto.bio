import { json } from '@sveltejs/kit';
import {
  getFollowedProtocolsByDid,
  getTargetsForProtocols,
  groupTargetsByProtocol,
  toProtocolResponse,
} from '$lib/server/db/survey-protocols';
import {
  getOccurrencesForSurveys,
  getSurveysByDid,
  groupOccurrencesBySurvey,
  toSurveyResponse,
} from '$lib/server/db/surveys';
import type { RequestHandler } from './$types';

const SYNC_SURVEY_LIMIT = 100;

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });

  const protocolRows = await getFollowedProtocolsByDid(locals.did);
  const targetRows = await getTargetsForProtocols(
    protocolRows.map((p) => p.at_uri),
  );
  const followedProtocols = toProtocolResponse(
    protocolRows,
    groupTargetsByProtocol(targetRows),
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
