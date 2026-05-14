import { json } from '@sveltejs/kit';
import { getIdentificationsForOccurrences } from '$lib/server/db/identifications';
import { getFollowedProtocolsByDid } from '$lib/server/db/survey-protocols';
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

  const followedProtocols = await getFollowedProtocolsByDid(locals.did);

  const surveys = await getSurveysByDid(locals.did, SYNC_SURVEY_LIMIT);
  const occurrences = await getOccurrencesForSurveys(
    surveys.map((s) => s.at_uri),
  );
  const incidentalUris = occurrences
    .filter((o) => !o.record.surveyTargetID)
    .map((o) => o.at_uri);
  const identsByOccurrence =
    await getIdentificationsForOccurrences(incidentalUris);
  const occurrencesWithIdents = occurrences.map((o) => ({
    ...o,
    identification: identsByOccurrence.get(o.at_uri),
  }));

  return json({
    followedProtocols,
    surveys: toSurveyResponse(
      surveys,
      groupOccurrencesBySurvey(occurrencesWithIdents),
    ),
  });
};
