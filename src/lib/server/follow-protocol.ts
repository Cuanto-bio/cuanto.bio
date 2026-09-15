import { createFollow } from '$lib/server/db/protocol-follows';
import logger from '$lib/server/logger';
import { materializeSurveyTargets } from '$lib/server/materialize-targets';
import { createRecord } from '$lib/server/pds';

const log = logger.child({ component: 'follow-protocol' });

// Creates a bio.cuanto.surveyProtocol.follow record for `did` on `protocolUri`,
// indexes it, and materializes the surveyor's own copies of the protocol's
// targets. Shared by the follow endpoint and protocol creation (a protocol
// author automatically follows their own protocol). PDS errors propagate to
// the caller.
export async function followProtocol(
  did: string,
  protocolUri: string,
): Promise<void> {
  const createdAt = new Date().toISOString();
  const { uri } = await createRecord(did, 'bio.cuanto.surveyProtocol.follow', {
    $type: 'bio.cuanto.surveyProtocol.follow',
    subject: protocolUri,
    createdAt,
  });

  await createFollow({
    atUri: uri,
    did,
    rkey: uri.split('/').at(-1) ?? '',
    protocolUri,
    createdAt,
  });

  // Adopting a protocol materializes the surveyor's own copies of its targets.
  // Caught rather than left to propagate: the follow record and DB row above
  // already succeeded, so a materialize failure here must not read back to
  // the caller as the follow itself having failed. The survey-creation path
  // re-ensures materialization, so a miss here is recovered on first survey.
  try {
    await materializeSurveyTargets(did, protocolUri);
  } catch (err) {
    log.error(
      { err, did, protocolUri },
      'failed to materialize survey targets on follow',
    );
  }
}
