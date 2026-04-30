import type { l } from '@atproto/lex';
import { json } from '@sveltejs/kit';
import * as Occurrence from '$lib/lexicons/bio/lexicons/temp/occurrence';
import * as Survey from '$lib/lexicons/bio/lexicons/temp/survey';
import type { Main as AtgeoPlace } from '$lib/lexicons/org/atgeo/place.defs';
import sql from '$lib/server/db';
import {
  getOccurrencesForSurveys,
  getSurveysByDid,
  groupOccurrencesBySurvey,
  insertOccurrence,
  insertSurvey,
  toSurveyResponse,
} from '$lib/server/db/surveys';
import logger from '$lib/server/logger';
import { createRecord } from '$lib/server/pds';
import type { RequestHandler } from './$types';

const log = logger.child({ component: 'api-surveys' });

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });

  const surveys = await getSurveysByDid(locals.did);
  const occurrences = await getOccurrencesForSurveys(
    surveys.map((s) => s.at_uri),
  );
  return json(toSurveyResponse(surveys, groupOccurrencesBySurvey(occurrences)));
};

type OccurrenceInput = {
  surveyTargetUri: string;
  taxonID?: string;
  organismQuantity?: string;
};

type SurveyInput = {
  protocolUri: string;
  protocolRkey: string;
  locationName: string;
  latitude: string | null;
  longitude: string | null;
  eventDate: string;
  eventDurationValue: number;
  occurrences: OccurrenceInput[];
};

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });
  const did = locals.did;

  const body = (await request.json()) as SurveyInput;

  const [protocol] = await sql<{ at_uri: string; cid: string | null }[]>`
    SELECT at_uri, cid FROM survey_protocols WHERE at_uri = ${body.protocolUri} LIMIT 1
  `;
  if (!protocol) return json({ error: 'Protocol not found' }, { status: 422 });

  if (!protocol.cid) {
    log.warn(
      { protocolUri: protocol.at_uri },
      'protocol has no cid; using empty string',
    );
  }

  const location: AtgeoPlace = {
    $type: 'org.atgeo.place',
    name: body.locationName,
    ...(body.latitude && body.longitude
      ? {
          locations: [
            {
              $type: 'community.lexicon.location.geo' as const,
              latitude: body.latitude,
              longitude: body.longitude,
            },
          ],
        }
      : {}),
  };

  const surveyRecord = Survey.$build({
    protocol: {
      uri: protocol.at_uri as l.AtUriString,
      cid: (protocol.cid ?? '') as l.CidString,
    },
    createdAt: new Date().toISOString() as l.DatetimeString,
    eventDate: body.eventDate,
    eventDurationValue: body.eventDurationValue,
    eventDurationUnit: 'minutes',
    location,
  });

  let surveyUri: string;
  try {
    ({ uri: surveyUri } = await createRecord(
      did,
      'bio.lexicons.temp.survey',
      surveyRecord,
    ));
  } catch (err) {
    return json({ error: `PDS error: ${String(err)}` }, { status: 502 });
  }
  const surveyRkey = surveyUri.split('/').at(-1) ?? '';

  await insertSurvey(did, surveyRkey, surveyRecord, surveyUri);

  for (const input of body.occurrences) {
    if (!input.organismQuantity) continue;

    const occurrenceRecord = Occurrence.$build({
      eventID: surveyUri as l.AtUriString,
      surveyTargetID: input.surveyTargetUri as l.AtUriString,
      ...(input.taxonID ? { taxonID: input.taxonID as l.UriString } : {}),
      organismQuantity: input.organismQuantity,
      organismQuantityType: 'individuals',
    });

    try {
      const { uri: occUri } = await createRecord(
        did,
        'bio.lexicons.temp.occurrence',
        occurrenceRecord,
      );
      const occRkey = occUri.split('/').at(-1) ?? '';
      await insertOccurrence(did, occRkey, occurrenceRecord, occUri);
    } catch (err) {
      log.error({ surveyUri }, 'Failed to create occurrence: %s', err);
    }
  }

  const [user] = await sql<{ handle: string }[]>`
    SELECT handle FROM users WHERE did = ${did}
  `;
  return json({ surveyUri, handle: user?.handle ?? '' });
};
