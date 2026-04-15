import type { l } from '@atproto/lex';
import { error, fail, redirect } from '@sveltejs/kit';
import * as Occurrence from '$lib/lexicons/bio/lexicons/temp/occurrence';
import * as Survey from '$lib/lexicons/bio/lexicons/temp/survey';
import type { Main as AtgeoPlace } from '$lib/lexicons/org/atgeo/place.defs';
import sql from '$lib/server/db';
import { insertOccurrence, insertSurvey } from '$lib/server/db/surveys';
import logger from '$lib/server/logger';
import { createRecord } from '$lib/server/pds';
import type { Actions, PageServerLoad } from './$types';

const log = logger.child({ component: 'survey-new' });

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.did) redirect(302, '/auth/signin');

  const [protocol] = await sql<
    {
      at_uri: string;
      rkey: string;
      title: string;
      cid: string | null;
      handle: string;
    }[]
  >`
    SELECT sp.at_uri, sp.rkey, sp.title, sp.cid, u.handle
    FROM survey_protocols sp
    JOIN users u ON u.did = sp.did
    WHERE sp.rkey = ${params.protocolRkey}
    LIMIT 1
  `;

  if (!protocol) error(404, 'Protocol not found');

  const targets = await sql<{ at_uri: string; scope: unknown[] }[]>`
    SELECT at_uri, scope
    FROM survey_targets
    WHERE protocol_uri = ${protocol.at_uri}
    ORDER BY indexed_at ASC
  `;

  return { protocol, targets };
};

type OccurrenceInput = {
  surveyTargetUri: string;
  taxonID?: string;
  count: number;
};

export const actions: Actions = {
  default: async ({ request, locals, params }) => {
    if (!locals.did) redirect(302, '/auth/signin');
    const did = locals.did;

    const formData = await request.formData();
    const locationName = (
      formData.get('locationName') as string | null
    )?.trim();
    const latitude = (formData.get('latitude') as string | null) || null;
    const longitude = (formData.get('longitude') as string | null) || null;
    const eventDate = formData.get('eventDate') as string | null;
    const eventDurationRaw = formData.get('eventDurationValue') as
      | string
      | null;
    const occurrencesJson = formData.get('occurrences') as string | null;

    if (!locationName) return fail(422, { error: 'Location name is required' });
    if (!eventDate) return fail(422, { error: 'Event date is required' });

    const eventDurationValue = eventDurationRaw
      ? parseInt(eventDurationRaw, 10)
      : 1;

    let occurrenceInputs: OccurrenceInput[] = [];
    try {
      occurrenceInputs = JSON.parse(occurrencesJson ?? '[]');
    } catch {
      return fail(422, { error: 'Invalid occurrences data' });
    }

    // Re-fetch protocol to get at_uri and cid for the strongRef
    const [protocol] = await sql<{ at_uri: string; cid: string | null }[]>`
      SELECT at_uri, cid
      FROM survey_protocols
      WHERE rkey = ${params.protocolRkey}
      LIMIT 1
    `;

    if (!protocol) return fail(422, { error: 'Protocol not found' });

    if (!protocol.cid) {
      log.warn(
        { protocolUri: protocol.at_uri },
        'protocol has no cid; using empty string',
      );
    }

    const location: AtgeoPlace = {
      $type: 'org.atgeo.place',
      name: locationName,
      ...(latitude && longitude
        ? {
            locations: [
              {
                $type: 'community.lexicon.location.geo' as const,
                latitude,
                longitude,
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
      eventDate,
      eventDurationValue,
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
      return fail(502, { error: `PDS error: ${String(err)}` });
    }
    const surveyRkey = surveyUri.split('/').at(-1) ?? '';

    await insertSurvey(did, surveyRkey, surveyRecord, surveyUri);

    for (const input of occurrenceInputs) {
      if (input.count <= 0) continue;

      const occurrenceRecord = Occurrence.$build({
        eventID: surveyUri as l.AtUriString,
        surveyTargetID: input.surveyTargetUri as l.AtUriString,
        ...(input.taxonID ? { taxonID: input.taxonID as l.UriString } : {}),
        organismQuantity: String(input.count),
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
        log.error(
          { surveyUri, surveyTargetUri: input.surveyTargetUri },
          'Failed to create occurrence: %s',
          err,
        );
      }
    }

    const [user] = await sql<{ handle: string }[]>`
      SELECT handle FROM users WHERE did = ${did}
    `;
    if (!user?.handle)
      return fail(500, {
        error: 'User handle not found after survey creation',
      });

    redirect(302, `/surveys/${user.handle}/${surveyRkey}`);
  },
};
