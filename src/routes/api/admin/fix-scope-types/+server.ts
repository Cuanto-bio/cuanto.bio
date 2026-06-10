import { assureAdminAuth } from '@atproto/tap';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import sql from '$lib/server/db';
import logger from '$lib/server/logger';
import { fixProtocolTargetScopes } from '$lib/server/migrate-lexicons';
import { PdsSessionExpiredError } from '$lib/server/pds';
import type { RequestHandler } from './$types';

const log = logger.child({ component: 'admin-fix-scope-types' });

// Rewrites stale scope item $type values in bio.cuanto.protocolTarget records
// on the PDS and in the local index. Run once after deploying the corrected
// migration code. Idempotent: already-correct records are skipped.
//   curl -X POST -H "Authorization: Basic $(echo -n admin:PASSWORD | base64)" \
//     https://HOST/api/admin/fix-scope-types
export const POST: RequestHandler = async ({ request }) => {
  try {
    assureAdminAuth(
      env.TAP_ADMIN_PASSWORD,
      request.headers.get('Authorization') ?? '',
    );
  } catch {
    log.warn('unauthorized fix-scope-types request');
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await sql<{ key: string }[]>`SELECT key FROM oauth_sessions`;

  void (async () => {
    let fixed = 0;
    let skipped = 0;
    let failed = 0;
    for (const { key: did } of rows) {
      try {
        await fixProtocolTargetScopes(did);
        fixed++;
      } catch (err) {
        if (err instanceof PdsSessionExpiredError) {
          log.warn({ did }, 'skipping: stored session expired');
          skipped++;
        } else {
          log.error({ err, did }, 'fix-scope-types failed');
          failed++;
        }
      }
    }
    log.info(
      { total: rows.length, fixed, skipped, failed },
      'bulk scope type fix complete',
    );
  })();

  return json({ status: 'started', total: rows.length }, { status: 202 });
};
