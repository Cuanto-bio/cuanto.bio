import { assureAdminAuth } from '@atproto/tap';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { backfillSurveyTargetCreatedAt } from '$lib/server/backfill-survey-target-created-at.js';
import sql from '$lib/server/db';
import logger from '$lib/server/logger.js';
import type { RequestHandler } from './$types';

const log = logger.child({
  component: 'admin-backfill-survey-target-created-at',
});

// Adds createdAt to existing bio.cuanto.surveyTarget PDS records that predate
// the field, using indexed_at as a per-target proxy. Runs in the background and
// returns immediately. Idempotent: only touches records where createdAt is absent.
//
//   curl -X POST -H "Authorization: Basic $(echo -n admin:PASSWORD | base64)" \
//     https://HOST/api/admin/backfill-survey-target-created-at
export const POST: RequestHandler = async ({ request }) => {
  try {
    assureAdminAuth(
      env.TAP_ADMIN_PASSWORD,
      request.headers.get('Authorization') ?? '',
    );
  } catch {
    log.warn('unauthorized backfill request');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [{ count: total }] = await sql<[{ count: number }]>`
    SELECT COUNT(*)::int AS count FROM survey_targets WHERE record->>'createdAt' IS NULL
  `;

  void (async () => {
    const result = await backfillSurveyTargetCreatedAt();
    log.info(result, 'backfill survey target createdAt complete');
  })();

  return json({ status: 'started', total }, { status: 202 });
};
