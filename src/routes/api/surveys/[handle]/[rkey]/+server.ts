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
import { deleteIdentificationsByOccurrenceUris } from '$lib/server/db/identifications';
import {
  deleteOccurrenceByAtUri,
  deleteOccurrencesBySurveyUri,
  deleteSurveyByAtUri,
  getOccurrencesForSurveys,
  getProtocolTargetsByUri,
  getSurveyDetailByHandleAndRkey,
  getSurveyOwnerDid,
  insertOccurrence,
  insertSurvey,
} from '$lib/server/db/surveys';
import logger from '$lib/server/logger';
import { createRecord, deleteRecord, putRecord } from '$lib/server/pds';
import { attachIdentificationToOccurrence } from '$lib/server/survey-records';
import { eventDateIsInFuture } from '$lib/server/survey-validation';
import type { RequestHandler } from './$types';

const log = logger.child({ component: 'api-surveys-detail' });

// Surveys are publicly readable. Auth is required only to prevent anonymous
// scraping; any authenticated user may view any other user's survey.
export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });

  const result = await getSurveyDetailByHandleAndRkey(
    params.handle,
    params.rkey,
  );
  if (!result) error(404, 'Survey not found');

  return json(result);
};

export const DELETE: RequestHandler = async ({ params, locals, url }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });
  const { did } = locals;

  const survey = await getSurveyDetailByHandleAndRkey(
    params.handle,
    params.rkey,
  );
  if (!survey) error(404, 'Survey not found');

  const ownerDid = await getSurveyOwnerDid(survey.atUri);
  if (ownerDid !== did) error(403, 'Forbidden');

  const deleteOccurrences =
    url.searchParams.get('deleteOccurrences') !== 'false';

  const occurrences = await getOccurrencesForSurveys([survey.atUri]);
  const occurrenceUris = occurrences.map((o) => o.at_uri);

  // Whether or not the user wants to preserve their occurrences on their PDS,
  // we need to delete our local records of the idents before deleting the
  // survey and its occurrence or we might get foreign key violations in our
  // local db
  const identRows = await deleteIdentificationsByOccurrenceUris(occurrenceUris);

  if (deleteOccurrences) {
    const deletedOccs = await deleteOccurrencesBySurveyUri(survey.atUri);
    for (const { at_uri } of identRows) {
      try {
        await deleteRecord(at_uri);
      } catch (err) {
        log.error({ err, at_uri }, 'Failed to delete identification from PDS');
      }
    }
    for (const { at_uri } of deletedOccs) {
      try {
        await deleteRecord(at_uri);
      } catch (err) {
        log.error({ err, at_uri }, 'Failed to delete occurrence from PDS');
      }
    }
  }

  await deleteSurveyByAtUri(survey.atUri);
  try {
    await deleteRecord(survey.atUri);
  } catch (err) {
    log.error({ err }, 'Failed to delete survey from PDS');
  }

  return new Response(null, { status: 204 });
};

type OccurrenceEditInput = {
  atUri?: string;
  surveyTargetUri: string;
  taxonID?: string;
  organismQuantity: string;
};

type IncidentalEditInput = {
  atUri?: string;
  taxonID?: string;
  scientificName?: string;
  taxonRank?: string;
  vernacularName?: string;
  kingdom?: string;
  organismQuantity?: string;
};

type SurveyEditInput = {
  eventDate: string;
  eventDurationValue: number | null;
  surveyorCount: number | null;
  locationName: string;
  latitude: string | null;
  longitude: string | null;
  gpsBbox?: { north: string; south: string; east: string; west: string } | null;
  // undefined: preserve the survey's existing track; null: remove it;
  // object: replace it.
  track?: { gpx: l.BlobRef; source: string } | null;
  occurrences: OccurrenceEditInput[];
  incidentals: IncidentalEditInput[];
};

export const PUT: RequestHandler = async ({ params, locals, request }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });
  const { did } = locals;

  const survey = await getSurveyDetailByHandleAndRkey(
    params.handle,
    params.rkey,
  );
  if (!survey) error(404, 'Survey not found');

  const ownerDid = await getSurveyOwnerDid(survey.atUri);
  if (ownerDid !== did) error(403, 'Forbidden');

  const body = (await request.json()) as SurveyEditInput;

  if (body.surveyorCount != null) {
    if (!Number.isInteger(body.surveyorCount) || body.surveyorCount < 1) {
      error(422, 'surveyorCount must be a positive integer');
    }
  }

  if (eventDateIsInFuture(body.eventDate)) {
    error(422, 'eventDate must not be in the future');
  }

  // Validate incidentals before touching anything
  for (const inc of body.incidentals) {
    if (!inc.taxonID || !inc.scientificName) {
      error(422, 'Incidental missing taxonID or scientificName');
    }
  }

  if (body.gpsBbox) {
    const n = parseFloat(body.gpsBbox.north);
    const s = parseFloat(body.gpsBbox.south);
    const e = parseFloat(body.gpsBbox.east);
    const w = parseFloat(body.gpsBbox.west);
    if ([n, s, e, w].some((v) => !Number.isFinite(v))) {
      error(422, 'gpsBbox edges must be finite numbers');
    }
    if (n < -90 || n > 90 || s < -90 || s > 90) {
      error(422, 'gpsBbox latitude must be between -90 and 90');
    }
    if (e < -180 || e > 180 || w < -180 || w > 180) {
      error(422, 'gpsBbox longitude must be between -180 and 180');
    }
    if (n < s) {
      error(422, 'gpsBbox north must be >= south');
    }
  }

  if (body.track) {
    if (typeof body.track.source !== 'string' || !body.track.source) {
      error(422, 'track.source must be a non-empty string');
    }
    const ref = body.track.gpx as unknown as { ref?: { $link?: string } };
    if (!ref?.ref?.$link) {
      error(422, 'track.gpx must be a blob ref');
    }
  }

  // The point and bbox have no preserve semantics: `locations` is rebuilt in full
  // from the payload every time, so the client must always send the current point
  // and bbox state (a missing value means "removed"). This is intentionally
  // unlike `track` below, which is a tri-state (undefined preserves, null removes).
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

  // track: undefined preserves the existing one, null removes it, object replaces
  const track =
    body.track === undefined
      ? survey.record.track
      : body.track === null
        ? undefined
        : {
            gpx: body.track.gpx,
            source: body.track.source as 'device' | 'uploaded',
          };

  // Update the survey record (preserve original createdAt and protocol ref)
  const surveyRecord = Survey.$build({
    protocol: survey.record.protocol,
    createdAt: survey.record.createdAt,
    eventDate: body.eventDate,
    eventDurationValue: body.eventDurationValue ?? undefined,
    ...(body.eventDurationValue != null
      ? { eventDurationUnit: 'minutes' }
      : {}),
    ...(body.surveyorCount != null
      ? { surveyorCount: body.surveyorCount }
      : {}),
    location,
    ...(track ? { track } : {}),
  });
  const surveyRkey = survey.rkey;
  await putRecord(did, Survey.$type, surveyRkey, surveyRecord);
  await insertSurvey(did, surveyRkey, surveyRecord, survey.atUri);

  // Pre-fetch taxon scopes for new occurrences in one batch query
  const newTargetUris = body.occurrences
    .filter(
      (o) => !o.atUri && o.organismQuantity && Number(o.organismQuantity) > 0,
    )
    .map((o) => o.surveyTargetUri);
  const taxonScopeMap = new Map<string, TaxonScope>();
  if (newTargetUris.length > 0) {
    const targetRows = await getProtocolTargetsByUri(newTargetUris);
    for (const row of targetRows) {
      const entry = row.record.scope?.find((s) =>
        taxonScopeType.isTypeOf(s as Record<string, unknown>),
      );
      if (entry) taxonScopeMap.set(row.at_uri, entry as TaxonScope);
    }
  }

  // Process protocol-target occurrences
  for (const occ of body.occurrences) {
    const hasCount = occ.organismQuantity && Number(occ.organismQuantity) > 0;

    if (occ.atUri) {
      // Existing occurrence
      if (hasCount) {
        const occRkey = occ.atUri.split('/').at(-1) ?? '';
        const occRecord = Occurrence.$build({
          eventID: survey.atUri as l.AtUriString,
          surveyTargetID: occ.surveyTargetUri as l.AtUriString,
          ...(occ.taxonID ? { taxonID: occ.taxonID as l.UriString } : {}),
          organismQuantity: occ.organismQuantity,
          organismQuantityType: 'individuals',
        });
        // Preserve acceptedIdentificationID if it exists on the existing record
        const existingOcc = survey.occurrences.find(
          (o) => o.atUri === occ.atUri,
        );
        const withIdent = existingOcc?.record.acceptedIdentificationID
          ? {
              ...occRecord,
              acceptedIdentificationID:
                existingOcc.record.acceptedIdentificationID,
            }
          : occRecord;
        await putRecord(did, Occurrence.$type, occRkey, withIdent);
        await insertOccurrence(did, occRkey, withIdent, occ.atUri);
      } else {
        // Zero count — delete the occurrence (and its identification)
        await deleteIdentificationsByOccurrenceUris([occ.atUri]).then(
          async (rows) => {
            for (const { at_uri } of rows) {
              try {
                await deleteRecord(at_uri);
              } catch (err) {
                log.error({ err }, 'Failed to delete identification from PDS');
              }
            }
          },
        );
        await deleteOccurrenceByAtUri(occ.atUri);
        try {
          await deleteRecord(occ.atUri);
        } catch (err) {
          log.error({ err }, 'Failed to delete occurrence from PDS');
        }
      }
    } else if (hasCount) {
      // New occurrence
      const occRecord = Occurrence.$build({
        eventID: survey.atUri as l.AtUriString,
        surveyTargetID: occ.surveyTargetUri as l.AtUriString,
        ...(occ.taxonID ? { taxonID: occ.taxonID as l.UriString } : {}),
        organismQuantity: occ.organismQuantity,
        organismQuantityType: 'individuals',
      });
      const { uri: occUri, cid: occCid } = await createRecord(
        did,
        Occurrence.$nsid,
        occRecord,
      );
      const occRkey = occUri.split('/').at(-1) ?? '';
      await insertOccurrence(did, occRkey, occRecord, occUri);

      const taxonScope = taxonScopeMap.get(occ.surveyTargetUri);
      if (taxonScope) {
        await attachIdentificationToOccurrence(
          did,
          occUri,
          occCid,
          occRkey,
          occRecord,
          taxonScope,
        );
      }
    }
  }

  // Process incidental occurrences
  for (const inc of body.incidentals) {
    const hasCount = inc.organismQuantity && Number(inc.organismQuantity) > 0;

    if (inc.atUri) {
      // Existing incidental
      if (hasCount) {
        const occRkey = inc.atUri.split('/').at(-1) ?? '';
        const occRecord = Occurrence.$build({
          eventID: survey.atUri as l.AtUriString,
          taxonID: inc.taxonID as l.UriString,
          organismQuantity: inc.organismQuantity,
          organismQuantityType: 'individuals',
        });
        const existingOcc = survey.occurrences.find(
          (o) => o.atUri === inc.atUri,
        );
        const withIdent = existingOcc?.record.acceptedIdentificationID
          ? {
              ...occRecord,
              acceptedIdentificationID:
                existingOcc.record.acceptedIdentificationID,
            }
          : occRecord;
        await putRecord(did, Occurrence.$type, occRkey, withIdent);
        await insertOccurrence(did, occRkey, withIdent, inc.atUri);
      } else {
        // Zero count — delete
        await deleteIdentificationsByOccurrenceUris([inc.atUri]).then(
          async (rows) => {
            for (const { at_uri } of rows) {
              try {
                await deleteRecord(at_uri);
              } catch (err) {
                log.error({ err }, 'Failed to delete identification from PDS');
              }
            }
          },
        );
        await deleteOccurrenceByAtUri(inc.atUri);
        try {
          await deleteRecord(inc.atUri);
        } catch (err) {
          log.error({ err }, 'Failed to delete incidental occurrence from PDS');
        }
      }
    } else if (hasCount) {
      // New incidental
      const occRecord = Occurrence.$build({
        eventID: survey.atUri as l.AtUriString,
        taxonID: inc.taxonID as l.UriString,
        organismQuantity: inc.organismQuantity,
        organismQuantityType: 'individuals',
      });
      const { uri: occUri, cid: occCid } = await createRecord(
        did,
        Occurrence.$nsid,
        occRecord,
      );
      const occRkey = occUri.split('/').at(-1) ?? '';
      await insertOccurrence(did, occRkey, occRecord, occUri);

      await attachIdentificationToOccurrence(
        did,
        occUri,
        occCid,
        occRkey,
        occRecord,
        {
          $type: taxonScopeType.$type,
          scientificName: inc.scientificName ?? '',
          taxonRank: inc.taxonRank ?? 'unknown',
          ...(inc.kingdom ? { kingdom: inc.kingdom } : {}),
          ...(inc.taxonID ? { taxonID: inc.taxonID as l.UriString } : {}),
          ...(inc.vernacularName ? { vernacularName: inc.vernacularName } : {}),
        },
      );
    }
  }

  const updated = await getSurveyDetailByHandleAndRkey(
    params.handle,
    params.rkey,
  );
  return json(updated);
};
