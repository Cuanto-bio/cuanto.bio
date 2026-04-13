import { assureAdminAuth, parseTapEvent } from '@atproto/tap';
import { json } from '@sveltejs/kit';
import { TAP_ADMIN_PASSWORD } from '$env/static/private';
import logger from '$lib/server/logger';
import { insertProtocol, insertTarget } from '$lib/server/protocols';
import type { RequestHandler } from './$types';

const PROTOCOL_NSID = 'bio.lexicons.temp.surveyProtocol';
const TARGET_NSID = 'bio.lexicons.temp.surveyTarget';

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
    await insertProtocol(evt.did, evt.rkey, evt.record as any, atUri);
    log.info({ atUri }, 'ingested survey protocol');
  } else if (evt.collection === TARGET_NSID) {
    await insertTarget(evt.did, evt.rkey, evt.record as any, atUri);
    log.info({ atUri }, 'ingested survey target');
  }

  return json({ ok: true });
};
