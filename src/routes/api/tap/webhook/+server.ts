import { assureAdminAuth, parseTapEvent } from '@atproto/tap';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { Main as Follow } from '$lib/lexicons/bio/cuanto/surveyProtocol/follow.defs';
import type { Main as Occurrence } from '$lib/lexicons/bio/lexicons/temp/occurrence.defs';
import type { Main as Survey } from '$lib/lexicons/bio/lexicons/temp/survey.defs';
import type { Main as SurveyProtocol } from '$lib/lexicons/bio/lexicons/temp/surveyProtocol.defs';
import type { Main as SurveyTarget } from '$lib/lexicons/bio/lexicons/temp/surveyTarget.defs';
import { createFollow, deleteFollow } from '$lib/server/db/protocol-follows';
import { insertProtocol, insertTarget } from '$lib/server/db/survey-protocols';
import { insertOccurrence, insertSurvey } from '$lib/server/db/surveys';
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

const PROTOCOL_NSID = 'bio.lexicons.temp.surveyProtocol';
const TARGET_NSID = 'bio.lexicons.temp.surveyTarget';
const SURVEY_NSID = 'bio.lexicons.temp.survey';
const OCCURRENCE_NSID = 'bio.lexicons.temp.occurrence';
const FOLLOW_NSID = 'bio.cuanto.surveyProtocol.follow';

const log = logger.child({ component: 'tap-webhook' });

function isFkViolation(e: unknown): boolean {
  return (e as { code?: string }).code === '23503';
}

async function ensureUser(did: string): Promise<void> {
  const [handle, avatarUrl] = await Promise.all([
    resolveHandle(did),
    fetchAvatarUrl(did),
  ]);
  if (handle) await insertUser(did, handle, avatarUrl);
}

async function backfillProtocol(protocolUri: string): Promise<void> {
  const rec = await fetchAtRecord(protocolUri);
  const { did, rkey } = parseAtUri(protocolUri);
  await ensureUser(did);
  await insertProtocol(
    did,
    rkey,
    rec.value as SurveyProtocol,
    rec.uri,
    rec.cid,
  );

  // listAtRecords has no server-side field filter, so we fetch all targets for
  // the DID and filter client-side.
  const targets = (await listAtRecords(did, TARGET_NSID)) ?? [];
  for (const t of targets) {
    const target = t.value as SurveyTarget;
    if (target.protocol === protocolUri) {
      const { rkey: tRkey } = parseAtUri(t.uri);
      await insertTarget(did, tRkey, target, t.uri);
    }
  }

  log.info({ protocolUri }, 'backfilled missing protocol');
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

async function backfillSurvey(surveyUri: string): Promise<void> {
  const rec = await fetchAtRecord(surveyUri);
  const { did, rkey } = parseAtUri(surveyUri);
  const surveyRecord = rec.value as Survey;
  await ensureUser(did);
  try {
    await insertSurvey(did, rkey, surveyRecord, rec.uri);
  } catch (e) {
    if (isFkViolation(e)) {
      await backfillProtocol(surveyRecord.protocol.uri);
      await insertSurvey(did, rkey, surveyRecord, rec.uri);
    } else {
      throw e;
    }
  }
  await ingestOccurrencesForSurvey(did, surveyUri);
  log.info({ surveyUri }, 'backfilled missing survey');
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
          await backfillProtocol(followRecord.protocolUri);
          await createFollow(followRecord);
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
  } else if (evt.collection === TARGET_NSID) {
    const target = evt.record as unknown as SurveyTarget;
    try {
      await insertTarget(evt.did, evt.rkey, target, atUri);
    } catch (e) {
      if (isFkViolation(e)) {
        await backfillProtocol(target.protocol);
        await insertTarget(evt.did, evt.rkey, target, atUri);
      } else throw e;
    }
    log.info({ atUri }, 'ingested survey target');
  } else if (evt.collection === SURVEY_NSID) {
    await ensureUser(evt.did);
    const survey = evt.record as unknown as Survey;
    try {
      await insertSurvey(evt.did, evt.rkey, survey, atUri);
    } catch (e) {
      if (isFkViolation(e)) {
        await backfillProtocol(survey.protocol.uri);
        await insertSurvey(evt.did, evt.rkey, survey, atUri);
      } else throw e;
    }
    await ingestOccurrencesForSurvey(evt.did, atUri);
    log.info({ atUri }, 'ingested survey');
  } else if (evt.collection === OCCURRENCE_NSID) {
    const occurrence = evt.record as unknown as Occurrence;
    const surveyUri = occurrence.eventID;
    try {
      await insertOccurrence(evt.did, evt.rkey, occurrence, atUri);
    } catch (e) {
      if (isFkViolation(e) && surveyUri) {
        await backfillSurvey(surveyUri);
        await insertOccurrence(evt.did, evt.rkey, occurrence, atUri);
      } else throw e;
    }
    log.info({ atUri }, 'ingested occurrence');
  }

  return json({ ok: true });
};
