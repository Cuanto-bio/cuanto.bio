import { parseAtUri } from '$lib/atUri';

export const SURVEY_TARGET_NSID = 'bio.cuanto.surveyTarget';

// A surveyor's surveyTarget reuses its source protocolTarget's rkey in the
// surveyor's own repo, so its AT-URI is derivable without a lookup. Used to
// repoint occurrence.surveyTargetID from the author's protocolTarget to the
// surveyor's own surveyTarget.
export function surveyTargetUriFor(
  did: string,
  protocolTargetUri: string,
): string {
  const { rkey } = parseAtUri(protocolTargetUri);
  return `at://${did}/${SURVEY_TARGET_NSID}/${rkey}`;
}
