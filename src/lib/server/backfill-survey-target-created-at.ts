import type { Main as AtSurveyTarget } from '$lib/lexicons/bio/cuanto/surveyTarget.defs.js';
import { insertSurveyTarget } from '$lib/server/db/survey-targets.js';
import logger from '$lib/server/logger.js';
import { PdsSessionExpiredError, putRecord } from '$lib/server/pds.js';
import sql from './db/index.js';

const log = logger.child({ component: 'backfill-survey-target-created-at' });

interface TargetRow {
  at_uri: string;
  did: string;
  rkey: string;
  protocol_uri: string;
  protocol_target_uri: string;
  record: AtSurveyTarget;
  protocol_created_at: string;
}

// Sets createdAt on all bio.cuanto.surveyTarget PDS records to the creation
// date of the survey protocol. This is a one-off backfill: not strictly
// accurate for targets added after the protocol was created, but conservative
// (earlier dates allow more notDetected through the temporal gate).
// Skips users with expired OAuth sessions.
export async function backfillSurveyTargetCreatedAt(): Promise<{
  updated: number;
  skipped: number;
  failed: number;
  total: number;
}> {
  const rows = await sql<TargetRow[]>`
    SELECT st.at_uri, st.did, st.rkey, st.protocol_uri, st.protocol_target_uri,
           st.record, sp.record->>'createdAt' AS protocol_created_at
    FROM survey_targets st
    JOIN survey_protocols sp ON sp.at_uri = st.protocol_uri
    ORDER BY st.did, st.at_uri
  `;

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const createdAt = row.protocol_created_at as AtSurveyTarget['createdAt'];
    const updatedRecord: AtSurveyTarget = { ...row.record, createdAt };
    try {
      await putRecord(
        row.did,
        'bio.cuanto.surveyTarget',
        row.rkey,
        updatedRecord,
      );
      await insertSurveyTarget(
        row.did,
        row.rkey,
        updatedRecord,
        row.at_uri,
        row.protocol_target_uri,
      );
      updated++;
      log.info({ atUri: row.at_uri }, 'backfilled survey target createdAt');
    } catch (err) {
      if (err instanceof PdsSessionExpiredError) {
        log.warn({ did: row.did }, 'skipping: stored session expired');
        skipped++;
      } else {
        log.error(
          { err, atUri: row.at_uri },
          'failed to backfill survey target',
        );
        failed++;
      }
    }
  }

  return { updated, skipped, failed, total: rows.length };
}
