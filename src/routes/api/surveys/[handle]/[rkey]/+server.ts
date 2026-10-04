import type { l } from '@atproto/lex';
import { error, json } from '@sveltejs/kit';
import { didFromAtUri, parseAtUri } from '$lib/atUri';
import {
  type TaxonScope,
  taxonScope as taxonScopeType,
} from '$lib/lexicons/bio/cuanto/protocolTarget.defs';
import * as Survey from '$lib/lexicons/bio/cuanto/survey';
import * as Occurrence from '$lib/lexicons/bio/lexicons/temp/v0-1/occurrence';
import { bbox, geo } from '$lib/lexicons/community/lexicon/location';
import * as Place from '$lib/lexicons/org/atgeo/place';
import type { Main as AtgeoPlace } from '$lib/lexicons/org/atgeo/place.defs';
import {
  mergeOccurrenceMetadata,
  occurrenceMetadataFromSurveyInput,
} from '$lib/occurrenceMetadata';
import { type RemarkInput, validateRemark } from '$lib/remarks';
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
import {
  gcSurveyTargetsIfUnused,
  materializeSurveyTargets,
} from '$lib/server/materialize-targets';
import { createRecord, deleteRecord, putRecord } from '$lib/server/pds';
import { pdsAuthErrorResponse } from '$lib/server/pds-error-response';
import {
  attachIdentificationToOccurrence,
  deleteRemark,
  remarkLicenseResolver,
  writeRemark,
} from '$lib/server/survey-records';
import { eventDateIsInFuture } from '$lib/server/survey-validation';
import { surveyTargetUriFor } from '$lib/surveyTargets';
import { generateTid } from '$lib/tid';
import type { RequestHandler } from './$types';

const log = logger.child({ component: 'api-surveys-detail' });

// A remark reference (eventRemarksID, occurrenceRemarksID), but only if it is
// in the surveyor's own repo. Another client can put any AT-URI there, and
// deleteRecord signs in as the DID in the URI, so following a foreign one would
// touch another user's records.
function ownRemarkUri(did: string, uri: string | undefined) {
  return uri && didFromAtUri(uri) === did ? uri : undefined;
}

/**
 * Applies an edit to the remark a survey or occurrence references, and returns
 * the reference to write on that subject plus, when the remark was cleared, the
 * remark to delete once the subject no longer names it.
 *
 * `input` is a tri-state: undefined preserves the existing remark, null (or a
 * blank body) removes it, a body replaces it. The remark is written here,
 * before the subject, and deleted by the caller after it, because the forward
 * reference is authoritative: the subject must never name a record that does
 * not exist.
 *
 * A reference into another user's repo is never ours to rewrite or delete: an
 * edit that sets or clears the remark replaces or drops the reference without
 * touching the record it names.
 *
 * `licenseFor` is the request's remarkLicenseResolver.
 */
async function resolveRemarkEdit(
  did: string,
  dwcTerm: 'eventRemarks' | 'occurrenceRemarks',
  subjectRkey: string,
  subjectUri: string,
  existingID: string | undefined,
  input: RemarkInput | null | undefined,
  licenseFor: (picked?: string) => Promise<string>,
): Promise<{ remarksID?: string; remarkUriToDelete?: string }> {
  if (input === undefined) return { remarksID: existingID };
  const existingOwnUri = ownRemarkUri(did, existingID);
  const body = input?.body.trim() ?? '';
  if (!body) return { remarkUriToDelete: existingOwnUri };
  // Follow the rkey the remark already has: another client may have written
  // it at a key of its own choosing, and overwriting our derived key instead
  // would leave that record orphaned.
  const remarkRkey = existingOwnUri
    ? parseAtUri(existingOwnUri).rkey
    : subjectRkey;
  // On failure keep the old reference: the previous record is still there
  // untouched, so dropping the link would orphan it.
  const written = await writeRemark(
    did,
    dwcTerm,
    remarkRkey,
    subjectUri,
    body,
    await licenseFor(input?.license),
  );
  return { remarksID: written ?? existingID };
}

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

  // The survey's remark goes with it, and goes first: deleteRemark
  // rethrows auth failures, and on one we stop before touching anything so the
  // surveyor can sign in and retry with the survey and index still intact.
  const remarkUri = ownRemarkUri(did, survey.record.eventRemarksID);
  if (remarkUri) {
    try {
      await deleteRemark(remarkUri);
    } catch (err) {
      const authResp = pdsAuthErrorResponse(err);
      if (authResp) return authResp;
      throw err;
    }
  }

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
    // Occurrence remarks go only with their occurrences (an occurrence kept on
    // the PDS still references its remark), and only after them, so a failed
    // occurrence delete never leaves it naming a deleted remark.
    const remarkUriByOccurrence = new Map(
      survey.occurrences.map((o) => [
        o.atUri,
        ownRemarkUri(did, o.record.occurrenceRemarksID),
      ]),
    );
    for (const { at_uri } of deletedOccs) {
      try {
        await deleteRecord(at_uri);
      } catch (err) {
        log.error({ err, at_uri }, 'Failed to delete occurrence from PDS');
        continue;
      }
      const occRemarkUri = remarkUriByOccurrence.get(at_uri);
      if (!occRemarkUri) continue;
      try {
        await deleteRemark(occRemarkUri);
      } catch (err) {
        // Past the point of stopping: the occurrence is already gone, so an
        // auth failure here can only orphan the remark.
        log.error({ err, occRemarkUri }, 'Failed to delete occurrence remark');
      }
    }
  }

  await deleteSurveyByAtUri(survey.atUri);
  try {
    await deleteRecord(survey.atUri);
  } catch (err) {
    log.error({ err }, 'Failed to delete survey from PDS');
  }

  // Clean up materialized surveyTargets if this was the last survey for the
  // protocol and the user no longer follows it.
  await gcSurveyTargetsIfUnused(did, survey.record.protocol.uri);

  return new Response(null, { status: 204 });
};

type OccurrenceEditInput = {
  atUri?: string;
  surveyTargetUri: string;
  taxonID?: string;
  organismQuantity: string;
  // Same tri-state as eventRemark, for this occurrence's remark.
  remark?: RemarkInput | null;
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
  // Same tri-state as `track`: undefined preserves the survey's existing
  // remark, null removes it, an object replaces it. An object whose body is
  // blank is a removal too, so clearing the textarea deletes the record rather
  // than publishing an empty one. `license` works as on create: omitted means
  // the account default.
  eventRemark?: RemarkInput | null;
  occurrences: OccurrenceEditInput[];
  incidentals: IncidentalEditInput[];
  // Explicit deletions (#24). Only occurrences/incidentals whose at-uri appears
  // here are removed; anything omitted from the payload is preserved. This
  // replaces the previous implicit "zero count or absent means delete", which
  // could silently destroy data on a partial or buggy payload.
  deletedOccurrenceUris?: string[];
  deletedIncidentalUris?: string[];
};

// Deletes an occurrence and its identification(s) from both the local DB and the
// PDS. Identifications go first, or the occurrence delete can trip the
// identifications_occurrence_uri_fkey constraint. PDS delete failures are logged
// but non-fatal (the local record is already gone).
//
// The occurrence's own remark goes too, after the occurrence: a remark nothing
// references fills no term, so keeping it would only leave an orphan. If the
// occurrence could not be deleted from the PDS it still names the remark, so
// the remark is kept rather than left as a dangling reference.
async function deleteOccurrenceAndIdentifications(
  atUri: string,
  remarkUri: string | undefined,
): Promise<void> {
  const identRows = await deleteIdentificationsByOccurrenceUris([atUri]);
  for (const { at_uri } of identRows) {
    try {
      await deleteRecord(at_uri);
    } catch (err) {
      log.error({ err, at_uri }, 'Failed to delete identification from PDS');
    }
  }
  await deleteOccurrenceByAtUri(atUri);
  try {
    await deleteRecord(atUri);
  } catch (err) {
    log.error({ err, atUri }, 'Failed to delete occurrence from PDS');
    return;
  }
  // An auth failure here propagates after the occurrence is already gone, and
  // a retried PUT no longer finds it in the survey, so the remark is orphaned.
  // The session would have to expire between these two calls; accepted.
  if (remarkUri) await deleteRemark(remarkUri);
}

export const PUT: RequestHandler = async (event) => {
  if (!event.locals.did) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return await putSurvey(event, event.locals.did);
  } catch (err) {
    // writeRemark and deleteRemark rethrow auth failures so the
    // client can prompt for sign-in or the missing scope rather than show a
    // generic error.
    const authResp = pdsAuthErrorResponse(err);
    if (authResp) return authResp;
    throw err;
  }
};

async function putSurvey(
  { params, request }: Parameters<RequestHandler>[0],
  did: string,
) {
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

  // A license we do not offer passes only if the remark already has it.
  if (body.eventRemark != null) {
    const remarkError = validateRemark(
      body.eventRemark,
      'eventRemark',
      survey.eventRemark?.license,
    );
    if (remarkError) error(422, remarkError);
  }

  for (const [i, occ] of body.occurrences.entries()) {
    if (occ.remark == null) continue;
    const existing = survey.occurrences.find((o) => o.atUri === occ.atUri);
    const remarkError = validateRemark(
      occ.remark,
      `occurrences[${i}].remark`,
      existing?.remark?.license,
    );
    if (remarkError) error(422, remarkError);
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
      ? [geo.$build({ latitude: body.latitude, longitude: body.longitude })]
      : []),
    ...(body.gpsBbox ? [bbox.$build({ ...body.gpsBbox })] : []),
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

  // eventRemark: see resolveRemarkEdit. Written before the survey record, and
  // deleted after it, for the same reason as on create.
  const licenseFor = remarkLicenseResolver(did);
  const { remarksID: eventRemarksID, remarkUriToDelete } =
    await resolveRemarkEdit(
      did,
      'eventRemarks',
      survey.rkey,
      survey.atUri,
      survey.record.eventRemarksID,
      body.eventRemark,
      licenseFor,
    );

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
    ...(eventRemarksID
      ? { eventRemarksID: eventRemarksID as l.AtUriString }
      : {}),
  });
  const surveyRkey = survey.rkey;
  await putRecord(did, Survey.$type, surveyRkey, surveyRecord);
  await insertSurvey(did, surveyRkey, surveyRecord, survey.atUri);
  if (remarkUriToDelete) await deleteRemark(remarkUriToDelete);

  // Survey-derived metadata for occurrences. On edit we fill gaps but never
  // clobber metadata already on an occurrence (see mergeOccurrenceMetadata).
  const occMeta = occurrenceMetadataFromSurveyInput({
    eventDate: body.eventDate,
    latitude: body.latitude,
    longitude: body.longitude,
    gpsBbox: body.gpsBbox,
  });

  // Ensure surveyTargets exist before occurrences reference them (idempotent).
  await materializeSurveyTargets(did, survey.record.protocol.uri);

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

  // Deletions are explicit (#24): only these at-uris are removed. Restrict to
  // occurrences that actually belong to this survey so a bad payload can't ask
  // us to delete arbitrary records.
  const ownOccurrenceUris = new Set(survey.occurrences.map((o) => o.atUri));
  const deletedOccurrenceUris = new Set(body.deletedOccurrenceUris ?? []);
  const deletedIncidentalUris = new Set(body.deletedIncidentalUris ?? []);

  // Process protocol-target occurrences (create/update only; deletes below).
  for (const occ of body.occurrences) {
    const hasCount = occ.organismQuantity && Number(occ.organismQuantity) > 0;

    // Skip anything queued for explicit deletion; it's removed in the pass below.
    if (occ.atUri && deletedOccurrenceUris.has(occ.atUri)) continue;

    if (occ.atUri) {
      // The record key, and the remark's subject, both come from atUri, so it
      // has to be one of this survey's own occurrences.
      if (!ownOccurrenceUris.has(occ.atUri)) {
        log.warn(
          { atUri: occ.atUri },
          'update requested for an occurrence not in this survey; skipping',
        );
        continue;
      }
      // Existing occurrence. A zero count no longer deletes it — omitting it
      // from deletedOccurrenceUris preserves it.
      if (hasCount) {
        const occRkey = occ.atUri.split('/').at(-1) ?? '';
        // Fill-but-don't-clobber survey metadata and preserve the existing
        // acceptedIdentificationID (both read from the existing record).
        const existingOcc = survey.occurrences.find(
          (o) => o.atUri === occ.atUri,
        );
        const occRecord = Occurrence.$build({
          ...mergeOccurrenceMetadata(existingOcc?.record, occMeta),
          eventID: survey.atUri as l.AtUriString,
          surveyTargetID: surveyTargetUriFor(
            did,
            occ.surveyTargetUri,
          ) as l.AtUriString,
          ...(occ.taxonID ? { taxonID: occ.taxonID as l.UriString } : {}),
          organismQuantity: occ.organismQuantity,
          organismQuantityType: 'individuals',
        });
        const { remarksID: occurrenceRemarksID, remarkUriToDelete } =
          await resolveRemarkEdit(
            did,
            'occurrenceRemarks',
            occRkey,
            occ.atUri,
            existingOcc?.record.occurrenceRemarksID,
            occ.remark,
            licenseFor,
          );
        const withIdent = {
          ...occRecord,
          ...(existingOcc?.record.acceptedIdentificationID
            ? {
                acceptedIdentificationID:
                  existingOcc.record.acceptedIdentificationID,
              }
            : {}),
          ...(occurrenceRemarksID
            ? { occurrenceRemarksID: occurrenceRemarksID as l.AtUriString }
            : {}),
        };
        await putRecord(did, Occurrence.$type, occRkey, withIdent);
        await insertOccurrence(did, occRkey, withIdent, occ.atUri);
        if (remarkUriToDelete) await deleteRemark(remarkUriToDelete);
      }
      // else: zero count and not explicitly deleted — preserve as-is.
    } else if (hasCount) {
      // New occurrence. putRecord at a fresh rkey rather than createRecord, so
      // the occurrence's AT-URI is known before the write and its remark can be
      // written first.
      const occRkey = generateTid();
      const occUri = `at://${did}/${Occurrence.$nsid}/${occRkey}`;
      const { remarksID: occurrenceRemarksID } = await resolveRemarkEdit(
        did,
        'occurrenceRemarks',
        occRkey,
        occUri,
        undefined,
        occ.remark,
        licenseFor,
      );
      const occRecord = Occurrence.$build({
        ...occMeta,
        eventID: survey.atUri as l.AtUriString,
        surveyTargetID: surveyTargetUriFor(
          did,
          occ.surveyTargetUri,
        ) as l.AtUriString,
        ...(occ.taxonID ? { taxonID: occ.taxonID as l.UriString } : {}),
        organismQuantity: occ.organismQuantity,
        organismQuantityType: 'individuals',
        ...(occurrenceRemarksID
          ? { occurrenceRemarksID: occurrenceRemarksID as l.AtUriString }
          : {}),
      });
      const { cid: occCid } = await putRecord(
        did,
        Occurrence.$nsid,
        occRkey,
        occRecord,
      );
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

  // Process incidental occurrences (create/update only; deletes below).
  for (const inc of body.incidentals) {
    const hasCount = inc.organismQuantity && Number(inc.organismQuantity) > 0;

    // Skip anything queued for explicit deletion; it's removed in the pass below.
    if (inc.atUri && deletedIncidentalUris.has(inc.atUri)) continue;

    if (inc.atUri) {
      if (!ownOccurrenceUris.has(inc.atUri)) {
        log.warn(
          { atUri: inc.atUri },
          'update requested for an incidental not in this survey; skipping',
        );
        continue;
      }
      // Existing incidental. Omitting it from the payload no longer deletes it.
      if (hasCount) {
        const occRkey = inc.atUri.split('/').at(-1) ?? '';
        const existingOcc = survey.occurrences.find(
          (o) => o.atUri === inc.atUri,
        );
        const occRecord = Occurrence.$build({
          ...mergeOccurrenceMetadata(existingOcc?.record, occMeta),
          eventID: survey.atUri as l.AtUriString,
          taxonID: inc.taxonID as l.UriString,
          organismQuantity: inc.organismQuantity,
          organismQuantityType: 'individuals',
        });
        // The form has no remark field for incidentals, but one converted from
        // a target occurrence keeps the remark it had, so carry the reference.
        const withIdent = {
          ...occRecord,
          ...(existingOcc?.record.acceptedIdentificationID
            ? {
                acceptedIdentificationID:
                  existingOcc.record.acceptedIdentificationID,
              }
            : {}),
          ...(existingOcc?.record.occurrenceRemarksID
            ? { occurrenceRemarksID: existingOcc.record.occurrenceRemarksID }
            : {}),
        };
        await putRecord(did, Occurrence.$type, occRkey, withIdent);
        await insertOccurrence(did, occRkey, withIdent, inc.atUri);
      }
      // else: zero count and not explicitly deleted — preserve as-is.
    } else if (hasCount) {
      // New incidental
      const occRecord = Occurrence.$build({
        ...occMeta,
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

  // Explicit deletion pass (#24): remove exactly the occurrences and incidentals
  // the client named, and only if they belong to this survey. Nothing is deleted
  // by absence or by zero count.
  for (const atUri of new Set([
    ...deletedOccurrenceUris,
    ...deletedIncidentalUris,
  ])) {
    if (!ownOccurrenceUris.has(atUri)) {
      log.warn(
        { atUri },
        'delete requested for an occurrence not in this survey; skipping',
      );
      continue;
    }
    const existing = survey.occurrences.find((o) => o.atUri === atUri);
    await deleteOccurrenceAndIdentifications(
      atUri,
      ownRemarkUri(did, existing?.record.occurrenceRemarksID),
    );
  }

  const updated = await getSurveyDetailByHandleAndRkey(
    params.handle,
    params.rkey,
  );
  return json(updated);
}
