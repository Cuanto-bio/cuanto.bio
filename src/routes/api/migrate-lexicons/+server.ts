import { json } from '@sveltejs/kit';
import logger from '$lib/server/logger';
import { migrateUser } from '$lib/server/migrate-lexicons';
import { assertActiveSession, PdsSessionExpiredError } from '$lib/server/pds';
import type { RequestHandler } from './$types';

const log = logger.child({ component: 'api-migrate-lexicons' });

// Starts a one-off migration of the signed-in user's records to the bio.cuanto.*
// namespace and two-tier target model. The work is many sequential PDS
// round-trips, so it runs in the background (an un-awaited task on the
// persistent server process) and the response returns immediately. The client
// polls /api/me until needs_lexicon_migration clears. migrateUser is idempotent,
// so a process restart mid-run just means the banner reappears and the user can
// retry. We synchronously validate the session first so an expired one prompts
// re-auth instead of silently failing in the background.
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });
  const { did } = locals;

  try {
    await assertActiveSession(did);
  } catch (err) {
    if (err instanceof PdsSessionExpiredError) {
      return json(
        { error: 'pds_session_expired', message: err.message },
        { status: 401 },
      );
    }
    throw err;
  }

  void migrateUser(did).catch((err) => {
    log.error({ err, did }, 'background migration failed');
  });

  return json({ status: 'started' }, { status: 202 });
};
