import type { l } from '@atproto/lex';
import type { TaxonScope } from '$lib/lexicons/bio/cuanto/protocolTarget.defs';
import * as Identification from '$lib/lexicons/bio/lexicons/temp/v0-1/identification';
import * as Occurrence from '$lib/lexicons/bio/lexicons/temp/v0-1/occurrence';
import { insertIdentification } from '$lib/server/db/identifications';
import { insertOccurrence } from '$lib/server/db/surveys';
import logger from '$lib/server/logger';
import { createRecord, putRecord } from '$lib/server/pds';

const log = logger.child({ component: 'survey-records' });

async function createIdentification(
  occUri: string,
  occCid: string,
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
  const { uri: identUri, cid: identCid } = await createRecord(
    did,
    Identification.$nsid,
    identRecord,
  );
  const identRkey = identUri.split('/').at(-1) ?? '';
  await insertIdentification(did, identRkey, identRecord, identUri);
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
    ident = await createIdentification(occUri, occCid, taxonScope, did);
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
