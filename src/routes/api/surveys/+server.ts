import type { l } from '@atproto/lex';
import { error, json } from '@sveltejs/kit';
import {
  type TaxonScope,
  taxonScope as taxonScopeType,
} from '$lib/lexicons/bio/cuanto/protocolTarget.defs';
import * as Survey from '$lib/lexicons/bio/cuanto/survey';
import * as Occurrence from '$lib/lexicons/bio/lexicons/temp/v0-1/occurrence';
import { bbox, geo } from '$lib/lexicons/community/lexicon/location';
import * as Place from '$lib/lexicons/org/atgeo/place';
import type { Main as AtgeoPlace } from '$lib/lexicons/org/atgeo/place.defs';
import sql from '$lib/server/db';
import { getIdentificationsForOccurrences } from '$lib/server/db/identifications';
import type { ProtocolRow } from '$lib/server/db/survey-protocols';
import { getProtocolByUri } from '$lib/server/db/survey-protocols';
import {
  getOccurrencesForSurveys,
  getProtocolTargetsByUri,
  getSurveysByDid,
  groupOccurrencesBySurvey,
  insertOccurrence,
  insertSurvey,
  toSurveyResponse,
} from '$lib/server/db/surveys';
import logger from '$lib/server/logger';
import { createRecord, PdsSessionExpiredError } from '$lib/server/pds';
import { attachIdentificationToOccurrence } from '$lib/server/survey-records';
import { eventDateIsInFuture } from '$lib/server/survey-validation';
import type { IncidentalInput } from '$lib/surveys';
import type { RequestHandler } from './$types';

const log = logger.child({ component: 'api-surveys' });

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });

  const surveys = await getSurveysByDid(locals.did);
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
  return json(
    toSurveyResponse(surveys, groupOccurrencesBySurvey(occurrencesWithIdents)),
  );
};

type OccurrenceInput = {
  surveyTargetUri: string;
  taxonID?: string;
  organismQuantity?: string;
};

type TrackInput = {
  gpx: l.BlobRef;
  source: string;
};

type SurveyInput = {
  protocolUri: string;
  protocolRkey: string;
  locationName: string;
  latitude: string | null;
  longitude: string | null;
  gpsBbox?: { north: string; south: string; east: string; west: string };
  track?: TrackInput;
  eventDate: string;
  eventDurationValue: number;
  surveyorCount?: number | null;
  occurrences: OccurrenceInput[];
  incidentals?: IncidentalInput[];
};

async function fetchProtocolRecords(body: SurveyInput) {
  const protocol = await getProtocolByUri(body.protocolUri);
  if (!protocol) throw error(422, 'Protocol not found');

  if (!protocol.cid) {
    log.warn(
      { protocolUri: protocol.at_uri },
      'protocol has no cid; using empty string',
    );
  }

  // Pre-fetch targets for all occurrences in one query; build taxon-scope map.
  const targetUris = body.occurrences.map((o) => o.surveyTargetUri);
  const targetRows = await getProtocolTargetsByUri(targetUris);
  const taxonScopeMap = new Map<string, TaxonScope>();
  for (const row of targetRows) {
    const taxonScopeEntry = row.record.scope?.find((s) =>
      taxonScopeType.isTypeOf(s as Record<string, unknown>),
    );
    if (taxonScopeEntry) {
      taxonScopeMap.set(row.at_uri, taxonScopeEntry as TaxonScope);
    }
  }

  return { protocol, taxonScopeMap };
}

async function createSurvey(
  protocol: ProtocolRow,
  body: SurveyInput,
  location: AtgeoPlace,
  did: string,
) {
  const surveyRecord = Survey.$build({
    protocol: {
      uri: protocol.at_uri as l.AtUriString,
      cid: (protocol.cid ?? '') as l.CidString,
    },
    createdAt: new Date().toISOString() as l.DatetimeString,
    eventDate: body.eventDate,
    eventDurationValue: body.eventDurationValue,
    eventDurationUnit: 'minutes',
    ...(body.surveyorCount != null
      ? { surveyorCount: body.surveyorCount }
      : {}),
    location,
    ...(body.track
      ? {
          track: {
            gpx: body.track.gpx,
            source: body.track.source as 'device' | 'uploaded',
          },
        }
      : {}),
  });

  let surveyUri: string;
  try {
    ({ uri: surveyUri } = await createRecord(did, Survey.$nsid, surveyRecord));
  } catch (err) {
    if (err instanceof PdsSessionExpiredError) throw err;
    throw error(502, `PDS error: ${String(err)}`);
  }

  const surveyRkey = surveyUri.split('/').at(-1) ?? '';

  await insertSurvey(did, surveyRkey, surveyRecord, surveyUri);

  return surveyUri;
}

async function createOccurrence(
  inputOcc: OccurrenceInput,
  surveyUri: string,
  did: string,
) {
  const occurrenceRecord = Occurrence.$build({
    eventID: surveyUri as l.AtUriString,
    surveyTargetID: inputOcc.surveyTargetUri as l.AtUriString,
    ...(inputOcc.taxonID ? { taxonID: inputOcc.taxonID as l.UriString } : {}),
    organismQuantity: inputOcc.organismQuantity,
    organismQuantityType: 'individuals',
  });
  const { uri: occUri, cid: occCid } = await createRecord(
    did,
    Occurrence.$nsid,
    occurrenceRecord,
  );
  const occRkey = occUri.split('/').at(-1) ?? '';
  await insertOccurrence(did, occRkey, occurrenceRecord, occUri);

  return { occUri, occCid, occRkey, occurrenceRecord };
}

async function createIncidentalOccurrence(
  input: IncidentalInput,
  surveyUri: string,
  did: string,
) {
  const occurrenceRecord = Occurrence.$build({
    eventID: surveyUri as l.AtUriString,
    taxonID: input.taxonID as l.UriString,
    organismQuantity: input.organismQuantity,
    organismQuantityType: 'individuals',
  });
  const { uri: occUri, cid: occCid } = await createRecord(
    did,
    Occurrence.$nsid,
    occurrenceRecord,
  );
  const occRkey = occUri.split('/').at(-1) ?? '';
  await insertOccurrence(did, occRkey, occurrenceRecord, occUri);
  return { occUri, occCid, occRkey, occurrenceRecord };
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });
  const did = locals.did;

  try {
    return await postSurvey(request, did);
  } catch (err) {
    if (err instanceof PdsSessionExpiredError) {
      return json(
        { error: 'pds_session_expired', message: err.message },
        { status: 401 },
      );
    }
    throw err;
  }
};

async function postSurvey(request: Request, did: string) {
  const body = (await request.json()) as SurveyInput;

  if (body.surveyorCount != null) {
    if (!Number.isInteger(body.surveyorCount) || body.surveyorCount < 1) {
      throw error(422, 'surveyorCount must be a positive integer');
    }
  }

  if (eventDateIsInFuture(body.eventDate)) {
    throw error(422, 'eventDate must not be in the future');
  }

  if (body.track) {
    if (typeof body.track.source !== 'string' || !body.track.source) {
      throw error(422, 'track.source must be a non-empty string');
    }
    const ref = body.track.gpx as unknown as { ref?: { $link?: string } };
    if (!ref?.ref?.$link) {
      throw error(422, 'track.gpx must be a blob ref');
    }
  }

  if (body.gpsBbox) {
    const n = parseFloat(body.gpsBbox.north);
    const s = parseFloat(body.gpsBbox.south);
    const e = parseFloat(body.gpsBbox.east);
    const w = parseFloat(body.gpsBbox.west);
    if ([n, s, e, w].some((v) => !Number.isFinite(v))) {
      throw error(422, 'gpsBbox edges must be finite numbers');
    }
    if (n < -90 || n > 90 || s < -90 || s > 90) {
      throw error(422, 'gpsBbox latitude must be between -90 and 90');
    }
    if (e < -180 || e > 180 || w < -180 || w > 180) {
      throw error(422, 'gpsBbox longitude must be between -180 and 180');
    }
    if (n < s) {
      throw error(422, 'gpsBbox north must be >= south');
    }
    // east < west is valid for boxes crossing the antimeridian
  }

  const { protocol, taxonScopeMap } = await fetchProtocolRecords(body);

  const locationEntries = [
    ...(body.latitude && body.longitude
      ? [
          {
            $type: geo.$type,
            latitude: body.latitude,
            longitude: body.longitude,
          },
        ]
      : []),
    ...(body.gpsBbox ? [{ $type: bbox.$type, ...body.gpsBbox }] : []),
  ];
  const location: AtgeoPlace = {
    $type: Place.$type,
    name: body.locationName,
    ...(locationEntries.length > 0 ? { locations: locationEntries } : {}),
  };

  const surveyUri = await createSurvey(protocol, body, location, did);

  for (const input of body.occurrences) {
    // We don't make absence occurrences
    if (!input.organismQuantity || Number(input.organismQuantity) <= 0)
      continue;

    const { occUri, occCid, occRkey, occurrenceRecord } =
      await createOccurrence(input, surveyUri, did);

    // If target has taxon scope, create an Identification and update the Occurrence
    // to indicate that this is the Occurrence user's accepted ident
    const taxonScope = taxonScopeMap.get(input.surveyTargetUri);
    if (taxonScope) {
      await attachIdentificationToOccurrence(
        did,
        occUri,
        occCid,
        occRkey,
        occurrenceRecord,
        taxonScope,
      );
    }
  }

  // Validate all incidentals before creating any incidental records
  for (const incidental of body.incidentals ?? []) {
    if (!incidental.taxonID || !incidental.scientificName) {
      throw error(422, 'Incidental missing taxonID or scientificName');
    }
  }

  for (const incidental of body.incidentals ?? []) {
    const { occUri, occCid, occRkey, occurrenceRecord } =
      await createIncidentalOccurrence(incidental, surveyUri, did);

    // taxonID validated above; cast bridges string → branded l.UriString
    await attachIdentificationToOccurrence(
      did,
      occUri,
      occCid,
      occRkey,
      occurrenceRecord,
      incidental as TaxonScope,
    );
  }

  const [user] = await sql<{ handle: string }[]>`
    SELECT handle FROM users WHERE did = ${did}
  `;
  return json({ surveyUri, handle: user?.handle ?? '' });
}
