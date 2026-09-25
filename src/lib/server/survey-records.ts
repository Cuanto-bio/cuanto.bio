import type { l } from '@atproto/lex';
import type { TaxonScope } from '$lib/lexicons/bio/cuanto/protocolTarget.defs';
import * as Identification from '$lib/lexicons/bio/lexicons/temp/v0-1/identification';
import * as Occurrence from '$lib/lexicons/bio/lexicons/temp/v0-1/occurrence';
import * as Remark from '$lib/lexicons/bio/lexicons/temp/v0-1/remark';
import { DEFAULT_REMARK_LICENSE, isKnownLicense } from '$lib/licenses';
import { insertIdentification } from '$lib/server/db/identifications';
import { deleteRemarkByAtUri, insertRemark } from '$lib/server/db/remarks';
import { insertOccurrence } from '$lib/server/db/surveys';
import { getDefaultRemarkLicense } from '$lib/server/db/users';
import logger from '$lib/server/logger';
import {
  deleteRecord,
  PdsSessionExpiredError,
  putRecord,
} from '$lib/server/pds';

const log = logger.child({ component: 'survey-records' });

async function createIdentification(
  occUri: string,
  occCid: string,
  occRkey: string,
  taxonScope: TaxonScope,
  did: string,
) {
  const identRecord = Identification.$build({
    occurrence: {
      uri: occUri as l.AtUriString,
      cid: occCid as l.CidString,
    },
    scientificName: taxonScope.scientificName,
    taxonRank: taxonScope.taxonRank,
    ...(taxonScope.kingdom ? { kingdom: taxonScope.kingdom } : {}),
    ...(taxonScope.taxonID
      ? { taxonID: taxonScope.taxonID as l.UriString }
      : {}),
    ...(taxonScope.vernacularName
      ? { vernacularName: taxonScope.vernacularName }
      : {}),
  });
  // Reuse the occurrence's (stable) rkey for its 1:1 identification — a
  // different collection, so no key collision — and putRecord so a retried
  // survey POST overwrites instead of creating a duplicate identification (#13).
  const { uri: identUri, cid: identCid } = await putRecord(
    did,
    Identification.$nsid,
    occRkey,
    identRecord,
  );
  await insertIdentification(did, occRkey, identRecord, identUri);
  return { uri: identUri, cid: identCid };
}

// Creates an identification for an occurrence and updates the occurrence record
// to reference it via acceptedIdentificationID. Failures are non-fatal: if
// identification creation fails the occurrence is preserved without one.
export async function attachIdentificationToOccurrence(
  did: string,
  occUri: string,
  occCid: string,
  occRkey: string,
  occRecord: ReturnType<typeof Occurrence.$build>,
  taxonScope: TaxonScope,
): Promise<void> {
  let ident: { uri: string; cid: string } | undefined;
  try {
    ident = await createIdentification(
      occUri,
      occCid,
      occRkey,
      taxonScope,
      did,
    );
  } catch (err) {
    log.error({ err, occUri }, 'Failed to create identification');
    return;
  }
  const updatedOcc = {
    ...occRecord,
    acceptedIdentificationID: {
      uri: ident.uri as l.AtUriString,
      cid: ident.cid as l.CidString,
    },
  };
  await putRecord(did, Occurrence.$type, occRkey, updatedOcc);
  await insertOccurrence(did, occRkey, updatedOcc, occUri);
}

// Resolves the license URI to stamp onto a remark. The surveyor picks this once
// on /app/account rather than per remark (#75), and it is applied here rather
// than sent by the client so a survey drafted offline days ago publishes under
// whatever default is in force when it finally uploads. A stored value we no
// longer offer is ignored rather than trusted onto the record.
async function resolveRemarkLicense(did: string) {
  let stored: string | null = null;
  try {
    stored = await getDefaultRemarkLicense(did);
  } catch (err) {
    log.warn({ err, did }, 'Failed to read default remark license');
  }
  return isKnownLicense(stored) ? stored : DEFAULT_REMARK_LICENSE;
}

/**
 * Writes the bio.lexicons.temp.v0-1.remark record holding a survey's
 * eventRemarks, and returns its AT-URI for the caller to set as the survey's
 * eventRemarksID. Call this *before* writing the survey so the survey never
 * points at a record that does not exist; the lexicon treats that forward
 * reference as authoritative.
 *
 * Returns null when the write fails for an ordinary reason, so a lost remark
 * never costs the surveyor the survey (same bargain as an identification that
 * fails to attach to its occurrence). Auth failures are the exception and
 * propagate: the remark would otherwise vanish with no explanation on exactly the
 * sessions that predate the remark collection joining our OAuth scope.
 */
export async function writeEventRemark(
  did: string,
  surveyRkey: string,
  surveyUri: string,
  body: string,
): Promise<string | null> {
  const license = await resolveRemarkLicense(did);
  const record = Remark.$build({
    subject: surveyUri as l.AtUriString,
    dwcTerm: 'eventRemarks',
    body,
    license,
  });
  try {
    // Reuse the survey's own rkey, as an identification reuses its
    // occurrence's: a different collection, so no key collision, and putRecord
    // at a stable key means a retried survey POST overwrites instead of
    // creating a second remark (#13).
    const { uri } = await putRecord(did, Remark.$nsid, surveyRkey, record);
    await insertRemark(did, surveyRkey, record, uri);
    return uri;
  } catch (err) {
    if (err instanceof PdsSessionExpiredError) throw err;
    log.error({ err, surveyUri }, 'Failed to write event remark');
    return null;
  }
}

/**
 * Removes a survey's event remark. The caller is responsible for also clearing
 * eventRemarksID on the survey record; a remark nothing references fills no
 * term, but leaving a dangling reference would point at a deleted record.
 */
export async function deleteEventRemark(remarkUri: string): Promise<void> {
  try {
    await deleteRecord(remarkUri);
  } catch (err) {
    if (err instanceof PdsSessionExpiredError) throw err;
    // A record that is already gone from the PDS still has a mirror row to
    // clear, so this is logged rather than fatal.
    log.error({ err, remarkUri }, 'Failed to delete event remark record');
  }
  await deleteRemarkByAtUri(remarkUri);
}
