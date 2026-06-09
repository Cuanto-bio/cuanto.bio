import { assureAdminAuth } from '@atproto/tap';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import sql from '$lib/server/db';
import logger from '$lib/server/logger';
import { cleanupMigratedRecords } from '$lib/server/migrate-lexicons';
import { PdsSessionExpiredError } from '$lib/server/pds';
import type { RequestHandler } from './$types';

const log = logger.child({ component: 'admin-cleanup-old-lexicons' });

// Deletes the retained old-NSID records once you're confident the migration
// landed. Safe per record: cleanupMigratedRecords only removes an old record
// whose bio.cuanto.* counterpart exists, so running this on an un-migrated user
// is a no-op. Background + 202 like the migration endpoint. Trigger after
// verifying, e.g.:
//   curl -X POST -H "Authorization: Basic $(echo -n admin:PASSWORD | base64)" \
//     https://HOST/api/admin/cleanup-old-lexicons
export const POST: RequestHandler = async ({ request }) => {
  try {
    assureAdminAuth(
      env.TAP_ADMIN_PASSWORD,
      request.headers.get('Authorization') ?? '',
    );
  } catch {
    log.warn('unauthorized admin cleanup request');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Every user with a stored session can have their session used to delete.
  const rows = await sql<{ key: string }[]>`SELECT key FROM oauth_sessions`;

  void (async () => {
    let cleaned = 0;
    let skipped = 0;
    let failed = 0;
    for (const { key: did } of rows) {
      try {
        await cleanupMigratedRecords(did);
        cleaned++;
      } catch (err) {
        if (err instanceof PdsSessionExpiredError) {
          log.warn({ did }, 'skipping: stored session expired');
          skipped++;
        } else {
          log.error({ err, did }, 'cleanup failed');
          failed++;
        }
      }
    }
    log.info(
      { total: rows.length, cleaned, skipped, failed },
      'bulk old-record cleanup complete',
    );
  })();

  return json({ status: 'started', total: rows.length }, { status: 202 });
};
