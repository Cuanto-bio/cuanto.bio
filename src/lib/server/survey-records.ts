import type { l } from '@atproto/lex';
import type { TaxonScope } from '$lib/lexicons/bio/cuanto/protocolTarget.defs';
import * as Identification from '$lib/lexicons/bio/lexicons/temp/v0-1/identification';
import * as Occurrence from '$lib/lexicons/bio/lexicons/temp/v0-1/occurrence';
import * as Remark from '$lib/lexicons/bio/lexicons/temp/v0-1/remark';
import {
  DEFAULT_REMARK_LICENSE,
  isKnownLicense,
  type RemarkLicense,
} from '$lib/licenses';
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

// Resolves the account default license to stamp onto a remark whose surveyor
// did not pick one for it. The default is applied here rather than sent by the
// client so a survey drafted offline days ago publishes under whatever default
// is in force when it finally uploads. A stored value we no longer offer is
// ignored rather than trusted onto the record.
async function resolveRemarkLicense(did: string): Promise<RemarkLicense> {
  let stored: string | null = null;
  try {
    stored = await getDefaultRemarkLicense(did);
  } catch (err) {
    log.warn({ err, did }, 'Failed to read default remark license');
  }
  return isKnownLicense(stored) ? stored : DEFAULT_REMARK_LICENSE;
}

/**
 * Returns a function giving the license for each remark in one request: the
 * one picked for it if any, else the account default. The default is looked up
 * at most once, however many remarks (one per counted target) need it.
 */
export function remarkLicenseResolver(
  did: string,
): (picked?: string) => Promise<string> {
  let accountDefault: Promise<RemarkLicense> | undefined;
  return async (picked) => {
    if (picked) return picked;
    accountDefault ??= resolveRemarkLicense(did);
    return accountDefault;
  };
}

/**
 * Writes the bio.lexicons.temp.v0-1.remark record filling `dwcTerm` on
 * `subjectUri` (a survey's eventRemarks or an occurrence's occurrenceRemarks),
 * and returns its AT-URI for the caller to set as the subject's forward
 * reference (eventRemarksID, occurrenceRemarksID). Call this *before* writing
 * the subject so it never points at a record that does not exist; the lexicon
 * treats that forward reference as authoritative.
 *
 * `rkey` is normally the subject's own rkey, as an identification reuses its
 * occurrence's: a different collection, so no key collision, and putRecord at a
 * stable key means a retried survey POST overwrites instead of creating a
 * second remark (#13).
 *
 * Returns null when the write fails for an ordinary reason, so a lost remark
 * never costs the surveyor the survey (same bargain as an identification that
 * fails to attach to its occurrence). Auth failures are the exception and
 * propagate: the remark would otherwise vanish with no explanation on exactly the
 * sessions that predate the remark collection joining our OAuth scope.
 *
 * `license` comes from remarkLicenseResolver. Callers validate a picked one
 * with validateRemark, which also admits a license the remark already had.
 */
export async function writeRemark(
  did: string,
  dwcTerm: 'eventRemarks' | 'occurrenceRemarks',
  rkey: string,
  subjectUri: string,
  body: string,
  license: string,
): Promise<string | null> {
  const record = Remark.$build({
    subject: subjectUri as l.AtUriString,
    dwcTerm,
    body,
    license,
  });
  try {
    const { uri } = await putRecord(did, Remark.$nsid, rkey, record);
    await insertRemark(did, rkey, record, uri);
    return uri;
  } catch (err) {
    if (err instanceof PdsSessionExpiredError) throw err;
    log.error({ err, subjectUri, dwcTerm }, 'Failed to write remark');
    return null;
  }
}

/**
 * Removes a remark. The caller is responsible for also clearing the forward
 * reference on its subject; a remark nothing references fills no term, but
 * leaving a dangling reference would point at a deleted record.
 */
export async function deleteRemark(remarkUri: string): Promise<void> {
  try {
    await deleteRecord(remarkUri);
  } catch (err) {
    if (err instanceof PdsSessionExpiredError) throw err;
    // A record that is already gone from the PDS still has a mirror row to
    // clear, so this is logged rather than fatal.
    log.error({ err, remarkUri }, 'Failed to delete remark record');
  }
  await deleteRemarkByAtUri(remarkUri);
}
