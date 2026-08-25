import { assureAdminAuth, parseTapEvent } from '@atproto/tap';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { Main as ProtocolTarget } from '$lib/lexicons/bio/cuanto/protocolTarget.defs';
import type { Main as Survey } from '$lib/lexicons/bio/cuanto/survey.defs';
import type { Main as Follow } from '$lib/lexicons/bio/cuanto/surveyProtocol/follow.defs';
import type { Main as SurveyProtocol } from '$lib/lexicons/bio/cuanto/surveyProtocol.defs';
import type { Main as SurveyTarget } from '$lib/lexicons/bio/cuanto/surveyTarget.defs';
import type { Main as Identification } from '$lib/lexicons/bio/lexicons/temp/v0-1/identification.defs';
import type { Main as Occurrence } from '$lib/lexicons/bio/lexicons/temp/v0-1/occurrence.defs';
import sql from '$lib/server/db';
import {
  deleteIdentificationByAtUri,
  deleteIdentificationsByOccurrenceUris,
  insertIdentification,
} from '$lib/server/db/identifications';
import { createFollow, deleteFollow } from '$lib/server/db/protocol-follows';
import {
  insertProtocol,
  insertProtocolTarget,
  tombstoneProtocolTargetsByUris,
} from '$lib/server/db/survey-protocols';
import {
  insertSurveyTarget,
  tombstoneSurveyTargetByUri,
} from '$lib/server/db/survey-targets';
import {
  countOccurrencesBySurveyTargetUri,
  deleteOccurrenceByAtUri,
  insertOccurrence,
  insertSurvey,
} from '$lib/server/db/surveys';
import { insertUser } from '$lib/server/db/users';
import logger from '$lib/server/logger';
import {
  fetchAtRecord,
  fetchAvatarUrl,
  listAtRecords,
  parseAtUri,
  resolveHandle,
} from '$lib/server/pds';
import type { RequestHandler } from './$types';

const PROTOCOL_NSID = 'bio.cuanto.surveyProtocol';
const PROTOCOL_TARGET_NSID = 'bio.cuanto.protocolTarget';
const SURVEY_NSID = 'bio.cuanto.survey';
const SURVEY_TARGET_NSID = 'bio.cuanto.surveyTarget';
const OCCURRENCE_NSID = 'bio.lexicons.temp.v0-1.occurrence';
const IDENTIFICATION_NSID = 'bio.lexicons.temp.v0-1.identification';
const FOLLOW_NSID = 'bio.cuanto.surveyProtocol.follow';

const log = logger.child({ component: 'tap-webhook' });

function isFkViolation(e: unknown): boolean {
  return (e as { code?: string }).code === '23503';
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string }).code === '23505';
}

async function ensureUser(did: string): Promise<void> {
  const [handle, avatarUrl] = await Promise.all([
    resolveHandle(did),
    fetchAvatarUrl(did),
  ]);
  if (handle) await insertUser(did, handle, avatarUrl);
}

async function backfillProtocol(protocolUri: string): Promise<boolean> {
  const rec = await fetchAtRecord(protocolUri);
  if (!rec) {
    log.warn({ protocolUri }, 'protocol not found on PDS; skipping backfill');
    return false;
  }
  // A URI referenced from another record (e.g. an eventID) can resolve to a
  // record from an unexpected or migrated collection. Only insert it as a
  // protocol if it actually is one, or we'd corrupt the protocols table (#22).
  if ((rec.value as { $type?: string }).$type !== PROTOCOL_NSID) {
    log.warn(
      { protocolUri, type: (rec.value as { $type?: string }).$type },
      'fetched record has unexpected $type; skipping protocol backfill',
    );
    return false;
  }
  const { did, rkey } = parseAtUri(protocolUri);
  await ensureUser(did);

  // listAtRecords has no server-side field filter, so we fetch all targets for
  // the DID and filter client-side. Fetched before opening the transaction so
  // the PDS round-trip doesn't hold the transaction open.
  const allTargets = (await listAtRecords(did, PROTOCOL_TARGET_NSID)) ?? [];
  const targets = allTargets.filter(
    (t) => (t.value as ProtocolTarget).protocol === protocolUri,
  );

  // Insert the protocol and its targets in one transaction. Otherwise a reader
  // between the two writes (e.g. reconcileRetirements in materialize-targets.ts)
  // sees the protocol as indexed with zero targets and mistakes "not yet
  // backfilled" for "the author deleted every target," mass-retiring every
  // surveyor's targets for it.
  await sql.begin(async (tx) => {
    await insertProtocol(
      did,
      rkey,
      rec.value as SurveyProtocol,
      rec.uri,
      rec.cid,
      tx,
    );
    for (const t of targets) {
      const { rkey: tRkey } = parseAtUri(t.uri);
      await insertProtocolTarget(
        did,
        tRkey,
        t.value as ProtocolTarget,
        t.uri,
        tx,
      );
    }
  });

  log.info({ protocolUri }, 'backfilled missing protocol');
  return true;
}

async function ingestOccurrencesForSurvey(
  did: string,
  surveyUri: string,
): Promise<void> {
  // listAtRecords has no server-side field filter, so we fetch all occurrences
  // for the DID and filter client-side.
  const occurrences = (await listAtRecords(did, OCCURRENCE_NSID)) ?? [];
  for (const o of occurrences) {
    const occurrence = o.value as Occurrence;
    if (occurrence.eventID === surveyUri) {
      const { rkey: oRkey } = parseAtUri(o.uri);
      await insertOccurrence(did, oRkey, occurrence, o.uri);
    }
  }
}

async function backfillSurvey(surveyUri: string): Promise<boolean> {
  const rec = await fetchAtRecord(surveyUri);
  if (!rec) {
    log.warn({ surveyUri }, 'survey not found on PDS; skipping backfill');
    return false;
  }
  // An occurrence's eventID can point at a record from an unexpected or migrated
  // collection. Only insert it as a survey if it actually is one; blindly
  // inserting mismatched records is what duplicated every survey in prod (#22).
  if ((rec.value as { $type?: string }).$type !== SURVEY_NSID) {
    log.warn(
      { surveyUri, type: (rec.value as { $type?: string }).$type },
      'fetched record has unexpected $type; skipping survey backfill',
    );
    return false;
  }
  const { did, rkey } = parseAtUri(surveyUri);
  const surveyRecord = rec.value as Survey;
  await ensureUser(did);
  try {
    await insertSurvey(did, rkey, surveyRecord, rec.uri);
  } catch (e) {
    if (isFkViolation(e)) {
      // The protocol backfill, and the insertSurvey retry after it, can each
      // fail on their own (a genuinely missing/unexpected protocol, or an FK
      // that's still unsatisfiable for reasons the retry can't fix). Either
      // failure means the survey could not be backfilled, not a 500 (#43).
      try {
        const backfilled = await backfillProtocol(surveyRecord.protocol.uri);
        if (!backfilled) return false;
        await insertSurvey(did, rkey, surveyRecord, rec.uri);
      } catch (retryErr) {
        log.warn(
          { surveyUri, err: retryErr },
          'survey backfill retry failed; skipping backfill',
        );
        return false;
      }
    } else {
      throw e;
    }
  }
  await ingestOccurrencesForSurvey(did, surveyUri);
  log.info({ surveyUri }, 'backfilled missing survey');
  return true;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    assureAdminAuth(
      env.TAP_ADMIN_PASSWORD,
      request.headers.get('Authorization') ?? '',
    );
  } catch {
    log.warn('Unauthorized webhook request');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const evt = parseTapEvent(body);

  log.info(
    {
      type: evt.type,
      ...(evt.type === 'record'
        ? { collection: evt.collection, did: evt.did, action: evt.action }
        : {}),
    },
    'tap event received',
  );

  if (evt.type === 'identity') {
    const avatarUrl = await fetchAvatarUrl(evt.did);
    await insertUser(evt.did, evt.handle, avatarUrl);
    log.info({ did: evt.did }, 'upserted user from identity event');
    return json({ ok: true });
  }

  if (evt.type !== 'record') {
    return json({ ok: true });
  }

  const atUri = `at://${evt.did}/${evt.collection}/${evt.rkey}`;

  if (evt.collection === FOLLOW_NSID) {
    if (evt.action === 'create' && evt.record) {
      const follow = evt.record as unknown as Follow;
      const followRecord = {
        atUri,
        did: evt.did,
        rkey: evt.rkey,
        protocolUri: follow.subject,
        createdAt: follow.createdAt,
      };
      try {
        await createFollow(followRecord);
      } catch (e) {
        if (isFkViolation(e)) {
          const backfilled = await backfillProtocol(followRecord.protocolUri);
          if (backfilled) await createFollow(followRecord);
        } else if (isUniqueViolation(e)) {
          log.info({ atUri }, 'follow already exists, skipping');
        } else {
          throw e;
        }
      }
      log.info({ atUri }, 'ingested protocol follow');
    } else if (evt.action === 'delete') {
      await deleteFollow(atUri);
      log.info({ atUri }, 'deleted protocol follow');
    }
    return json({ ok: true });
  }

  if (evt.collection === SURVEY_TARGET_NSID) {
    if (evt.action === 'create' && evt.record) {
      const target = evt.record as unknown as SurveyTarget;
      await insertSurveyTarget(
        evt.did,
        evt.rkey,
        target,
        atUri,
        target.protocolTargetID,
        evt.rev,
      );
      log.info({ atUri }, 'ingested survey target');
    } else if (evt.action === 'delete') {
      // Tombstoned, not removed: the row is what keeps already-recorded
      // detections joinable and remembers the original adoption time (#41).
      const occurrences = await countOccurrencesBySurveyTargetUri(atUri);
      await tombstoneSurveyTargetByUri(atUri, evt.rev);
      if (occurrences > 0) {
        log.warn(
          { atUri, occurrences },
          'tombstoned survey target that has occurrences',
        );
      } else {
        log.info({ atUri }, 'tombstoned survey target');
      }
    }
    return json({ ok: true });
  }

  if (evt.collection === PROTOCOL_TARGET_NSID && evt.action === 'delete') {
    await tombstoneProtocolTargetsByUris([atUri]);
    log.info({ atUri }, 'deleted protocol target');
    return json({ ok: true });
  }

  if (evt.collection === OCCURRENCE_NSID && evt.action === 'delete') {
    // Remove dependent identifications first; identifications.occurrence_uri has
    // no ON DELETE CASCADE, so deleting the occurrence while they exist fails the
    // identifications_occurrence_uri_fkey constraint.
    await deleteIdentificationsByOccurrenceUris([atUri]);
    await deleteOccurrenceByAtUri(atUri);
    log.info({ atUri }, 'deleted occurrence');
    return json({ ok: true });
  }

  if (evt.collection === IDENTIFICATION_NSID && evt.action === 'delete') {
    await deleteIdentificationByAtUri(atUri);
    log.info({ atUri }, 'deleted identification');
    return json({ ok: true });
  }

  if (!evt.record || evt.action === 'delete') {
    return json({ ok: true });
  }

  if (evt.collection === PROTOCOL_NSID) {
    await ensureUser(evt.did);
    await insertProtocol(
      evt.did,
      evt.rkey,
      evt.record as unknown as SurveyProtocol,
      atUri,
      evt.cid ?? '',
    );
    log.info({ atUri }, 'ingested survey protocol');
  } else if (evt.collection === PROTOCOL_TARGET_NSID) {
    const target = evt.record as unknown as ProtocolTarget;
    try {
      await insertProtocolTarget(evt.did, evt.rkey, target, atUri);
    } catch (e) {
      if (isFkViolation(e)) {
        const backfilled = await backfillProtocol(target.protocol);
        if (backfilled)
          await insertProtocolTarget(evt.did, evt.rkey, target, atUri);
      } else throw e;
    }
    log.info({ atUri }, 'ingested protocol target');
  } else if (evt.collection === SURVEY_NSID) {
    await ensureUser(evt.did);
    const survey = evt.record as unknown as Survey;
    try {
      await insertSurvey(evt.did, evt.rkey, survey, atUri);
    } catch (e) {
      if (isFkViolation(e)) {
        const backfilled = await backfillProtocol(survey.protocol.uri);
        if (backfilled) await insertSurvey(evt.did, evt.rkey, survey, atUri);
      } else throw e;
    }
    await ingestOccurrencesForSurvey(evt.did, atUri);
    log.info({ atUri }, 'ingested survey');
  } else if (evt.collection === OCCURRENCE_NSID) {
    const occurrence = evt.record as unknown as Occurrence;
    const surveyUri = occurrence.eventID;
    let inserted = false;
    let backfillErr: unknown;
    try {
      await insertOccurrence(evt.did, evt.rkey, occurrence, atUri);
      inserted = true;
    } catch (e) {
      if (isFkViolation(e) && surveyUri) {
        // backfillSurvey, and the insertOccurrence retry after it, can each
        // fail on their own: a genuinely missing/unexpected survey, or an FK
        // that's still unsatisfiable for reasons the retry can't fix. Either
        // failure means the occurrence could not be ingested, not a 500 (#43).
        try {
          const backfilled = await backfillSurvey(surveyUri);
          if (backfilled) {
            await insertOccurrence(evt.did, evt.rkey, occurrence, atUri);
            inserted = true;
          }
        } catch (retryErr) {
          backfillErr = retryErr;
        }
      } else throw e;
    }
    if (inserted) {
      log.info({ atUri }, 'ingested occurrence');
    } else {
      // backfillSurvey returned false, or the recovery attempt itself failed
      // (backfillErr): the eventID resolved to a missing record or one from
      // an unexpected collection (#22), or its FK was otherwise unsatisfiable,
      // so the occurrence was not ingested.
      log.warn(
        { atUri, surveyUri, ...(backfillErr ? { err: backfillErr } : {}) },
        'occurrence references unknown survey; skipping ingestion',
      );
    }
  } else if (evt.collection === IDENTIFICATION_NSID) {
    const identification = evt.record as unknown as Identification;
    try {
      await insertIdentification(evt.did, evt.rkey, identification, atUri);
    } catch (e) {
      if (isFkViolation(e)) {
        const occurrenceUri = identification.occurrence?.uri;
        log.warn(
          { atUri, occurrenceUri, errorCode: (e as { code?: string }).code },
          'identification FK violation; attempting backfill',
        );
        if (!occurrenceUri) {
          log.warn({ atUri }, 'identification has no occurrence.uri; skipping');
        } else {
          const occRec = await fetchAtRecord(occurrenceUri);
          if (!occRec) {
            log.warn(
              { atUri, occurrenceUri },
              'occurrence not found on PDS; skipping identification',
            );
          } else if (
            (occRec.value as { $type?: string }).$type !== OCCURRENCE_NSID
          ) {
            // The referenced URI resolved to a record from an unexpected or
            // migrated collection; do not insert it as an occurrence (#22).
            log.warn(
              {
                atUri,
                occurrenceUri,
                type: (occRec.value as { $type?: string }).$type,
              },
              'fetched record has unexpected $type; skipping occurrence backfill',
            );
          } else {
            const occ = occRec.value as Occurrence;
            const { did: occDid, rkey: occRkey } = parseAtUri(occurrenceUri);
            let occurrenceInserted = false;
            try {
              await insertOccurrence(occDid, occRkey, occ, occurrenceUri);
              log.info(
                { atUri, occurrenceUri },
                'backfilled missing occurrence',
              );
              occurrenceInserted = true;
            } catch (occErr) {
              if (isFkViolation(occErr) && occ.eventID) {
                log.warn(
                  { atUri, occurrenceUri, surveyUri: occ.eventID },
                  'occurrence FK violation; backfilling survey',
                );
                // TODO: backfillSurvey fetches all occurrences for the DID via
                // listAtRecords, which becomes expensive at scale. Consider
                // running this in a background job, or relying on tap delivering
                // the survey and occurrence events independently before the
                // identification event arrives.
                const backfilled = await backfillSurvey(occ.eventID);
                if (backfilled) {
                  await insertOccurrence(occDid, occRkey, occ, occurrenceUri);
                  log.info(
                    { atUri, occurrenceUri, surveyUri: occ.eventID },
                    'backfilled missing survey and occurrence',
                  );
                  occurrenceInserted = true;
                }
              } else throw occErr;
            }
            if (occurrenceInserted) {
              try {
                await insertIdentification(
                  evt.did,
                  evt.rkey,
                  identification,
                  atUri,
                );
              } catch (idErr) {
                if (isFkViolation(idErr)) {
                  log.warn(
                    { atUri, occurrenceUri },
                    'identification FK violation after backfill; skipping',
                  );
                } else throw idErr;
              }
            }
          }
        }
      } else throw e;
    }
    log.info({ atUri }, 'ingested identification');
  }

  return json({ ok: true });
};
