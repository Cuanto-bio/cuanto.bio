import { assureAdminAuth, parseTapEvent } from '@atproto/tap';
import { json } from '@sveltejs/kit';
import { TAP_ADMIN_PASSWORD } from '$env/static/private';
import type { Main as Occurrence } from '$lib/lexicons/bio/lexicons/temp/occurrence.defs';
import type { Main as Survey } from '$lib/lexicons/bio/lexicons/temp/survey.defs';
import type { Main as SurveyProtocol } from '$lib/lexicons/bio/lexicons/temp/surveyProtocol.defs';
import type { Main as SurveyTarget } from '$lib/lexicons/bio/lexicons/temp/surveyTarget.defs';
import logger from '$lib/server/logger';
import { insertProtocol, insertTarget } from '$lib/server/protocols';
import { insertOccurrence, insertSurvey } from '$lib/server/surveys';
import type { RequestHandler } from './$types';

const PROTOCOL_NSID = 'bio.lexicons.temp.surveyProtocol';
const TARGET_NSID = 'bio.lexicons.temp.surveyTarget';
const SURVEY_NSID = 'bio.lexicons.temp.survey';
const OCCURRENCE_NSID = 'bio.lexicons.temp.occurrence';

const log = logger.child({ component: 'tap-webhook' });

export const POST: RequestHandler = async ({ request }) => {
  try {
    assureAdminAuth(
      TAP_ADMIN_PASSWORD,
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

  if (evt.type !== 'record' || evt.action !== 'create' || !evt.record) {
    return json({ ok: true });
  }

  const atUri = `at://${evt.did}/${evt.collection}/${evt.rkey}`;

  if (evt.collection === PROTOCOL_NSID) {
    await insertProtocol(
      evt.did,
      evt.rkey,
      evt.record as unknown as SurveyProtocol,
      atUri,
      evt.cid ?? '',
    );
    log.info({ atUri }, 'ingested survey protocol');
  } else if (evt.collection === TARGET_NSID) {
    await insertTarget(
      evt.did,
      evt.rkey,
      evt.record as unknown as SurveyTarget,
      atUri,
    );
    log.info({ atUri }, 'ingested survey target');
  } else if (evt.collection === SURVEY_NSID) {
    await insertSurvey(
      evt.did,
      evt.rkey,
      evt.record as unknown as Survey,
      atUri,
    );
    log.info({ atUri }, 'ingested survey');
  } else if (evt.collection === OCCURRENCE_NSID) {
    await insertOccurrence(
      evt.did,
      evt.rkey,
      evt.record as unknown as Occurrence,
      atUri,
    );
    log.info({ atUri }, 'ingested occurrence');
  }

  return json({ ok: true });
};
