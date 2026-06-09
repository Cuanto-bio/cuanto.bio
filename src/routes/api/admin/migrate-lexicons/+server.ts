import { assureAdminAuth } from '@atproto/tap';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import sql from '$lib/server/db';
import logger from '$lib/server/logger';
import {
  migrateUser,
  migrateUserProtocols,
} from '$lib/server/migrate-lexicons';
import { PdsSessionExpiredError } from '$lib/server/pds';
import type { RequestHandler } from './$types';

const log = logger.child({ component: 'admin-migrate-lexicons' });

// Bulk-migrates every flagged user. migrateUser writes via each user's stored
// OAuth session, which only works inside the app runtime, so this is an
// admin-authed endpoint (the equivalent of a back-office script). Trigger once
// after deploy, e.g.:
//   curl -X POST -H "Authorization: Basic $(echo -n admin:PASSWORD | base64)" \
//     https://HOST/api/admin/migrate-lexicons
export const POST: RequestHandler = async ({ request }) => {
  try {
    assureAdminAuth(
      env.TAP_ADMIN_PASSWORD,
      request.headers.get('Authorization') ?? '',
    );
  } catch {
    log.warn('unauthorized admin migration request');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await sql<{ did: string }[]>`
    SELECT did FROM users WHERE needs_lexicon_migration = true
  `;

  // Migrating every user is far too long for one request, so run it in the
  // background (un-awaited on the persistent server process) and return
  // immediately. migrateUser is idempotent, so re-running this endpoint resumes
  // anything an interruption left unfinished.
  //
  // Two-phase approach: phase 1 indexes every user's own protocols before phase
  // 2 does the full migration. This ensures cross-author follow re-indexing
  // (which has a FK on survey_protocols) finds its target instead of deferring
  // with a warning when the followed protocol author comes later in the loop.
  void (async () => {
    // Phase 1: protocols and targets only.
    for (const { did } of rows) {
      try {
        await migrateUserProtocols(did);
      } catch (err) {
        if (err instanceof PdsSessionExpiredError) {
          log.warn({ did }, 'phase 1: skipping expired session');
        } else {
          log.error({ err, did }, 'phase 1: protocol migration failed');
        }
      }
    }

    // Phase 2: full migration (idempotent; protocol steps are fast no-ops).
    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    for (const { did } of rows) {
      try {
        await migrateUser(did);
        migrated++;
      } catch (err) {
        if (err instanceof PdsSessionExpiredError) {
          log.warn({ did }, 'skipping: stored session expired');
          skipped++;
        } else {
          log.error({ err, did }, 'migration failed');
          failed++;
        }
      }
    }
    log.info(
      { total: rows.length, migrated, skipped, failed },
      'bulk lexicon migration complete',
    );
  })();

  return json({ status: 'started', total: rows.length }, { status: 202 });
};
