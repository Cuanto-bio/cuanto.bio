import type { l } from '@atproto/lex';
import { json } from '@sveltejs/kit';
import * as Identification from '$lib/lexicons/bio/lexicons/temp/v0-1/identification';
import logger from '$lib/logger';
import { insertIdentification } from '$lib/server/db/identifications';
import {
  deleteOccurrenceByUri,
  getOccurrenceByRkeyAndDid,
  updateOccurrenceRecord,
} from '$lib/server/db/occurrences';
import {
  createRecord,
  deleteRecord,
  fetchAtRecord,
  putRecord,
} from '$lib/server/pds';
import type { RequestHandler } from './$types';

const log = logger.child({ component: 'occurrences-api' });

type InatTaxon = {
  id: number;
  name: string;
  rank: string;
  preferred_common_name?: string;
  ancestors?: { rank: string; name: string }[];
};

async function lookupInatTaxon(taxonId: number): Promise<InatTaxon | null> {
  const params = new URLSearchParams({
    fields: 'id,name,rank,preferred_common_name,ancestors.rank,ancestors.name',
  });
  const resp = await fetch(
    `https://api.inaturalist.org/v2/taxa/${taxonId}?${params}`,
    { headers: { 'User-Agent': 'cuanto.bio/0.1 (prototype)' } },
  );
  if (!resp.ok) return null;
  const data = (await resp.json()) as { results: InatTaxon[] };
  return data.results[0] ?? null;
}

function extractInatId(taxonID: string): number | null {
  const match = /\/taxa\/(\d+)$/.exec(taxonID);
  return match ? parseInt(match[1], 10) : null;
}

export const PATCH: RequestHandler = async ({ request, locals, params }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });
  const { did } = locals;

  const occurrence = await getOccurrenceByRkeyAndDid(params.rkey, did);
  if (!occurrence) return json({ error: 'Not found' }, { status: 404 });

  const body = (await request.json()) as {
    action?: string;
    surveyTargetID?: string;
  };
  const { action } = body;

  if (action === 'relink') {
    const { surveyTargetID } = body;
    if (!surveyTargetID)
      return json({ error: 'surveyTargetID required' }, { status: 422 });

    const updated = {
      ...occurrence.record,
      surveyTargetID: surveyTargetID as l.AtUriString,
    };
    try {
      await putRecord(
        did,
        'bio.lexicons.temp.v0-1.occurrence',
        occurrence.rkey,
        updated,
      );
      await updateOccurrenceRecord(occurrence.at_uri, updated);
    } catch (err) {
      log.error({ err }, 'Failed to relink occurrence');
      return json({ error: 'Failed to update occurrence' }, { status: 502 });
    }
    return json({ ok: true });
  }

  if (action === 'convert-to-incidental') {
    const { surveyTargetID: _, ...rest } = occurrence.record;
    let updated = { ...rest };

    const { taxonID } = occurrence.record;
    if (taxonID) {
      const inatId = extractInatId(taxonID);
      if (inatId !== null) {
        const taxon = await lookupInatTaxon(inatId);
        if (taxon) {
          try {
            const occRecord = await fetchAtRecord(occurrence.at_uri);
            const identRecord = Identification.$build({
              occurrence: {
                uri: occurrence.at_uri as l.AtUriString,
                cid: occRecord.cid,
              },
              scientificName: taxon.name,
              taxonRank: taxon.rank,
              taxonID: taxonID as l.UriString,
              vernacularName: taxon.preferred_common_name,
              kingdom: taxon.ancestors?.find((a) => a.rank === 'kingdom')?.name,
            });
            const { uri: identUri, cid: identCid } = await createRecord(
              did,
              'bio.lexicons.temp.v0-1.identification',
              identRecord,
            );
            const identRkey = identUri.split('/').at(-1) ?? '';
            await insertIdentification(did, identRkey, identRecord, identUri);
            updated = {
              ...updated,
              acceptedIdentificationID: {
                uri: identUri as l.AtUriString,
                cid: identCid,
              },
            };
          } catch (err) {
            log.error(
              { err },
              'Failed to create identification during convert-to-incidental',
            );
          }
        }
      }
    }

    try {
      await putRecord(
        did,
        'bio.lexicons.temp.v0-1.occurrence',
        occurrence.rkey,
        updated,
      );
      await updateOccurrenceRecord(occurrence.at_uri, updated);
    } catch (err) {
      log.error(
        { err },
        'Failed to update occurrence during convert-to-incidental',
      );
      return json({ error: 'Failed to update occurrence' }, { status: 502 });
    }
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, { status: 422 });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });
  const { did } = locals;

  const occurrence = await getOccurrenceByRkeyAndDid(params.rkey, did);
  if (!occurrence) return json({ error: 'Not found' }, { status: 404 });

  try {
    await deleteRecord(occurrence.at_uri);
    await deleteOccurrenceByUri(occurrence.at_uri);
  } catch (err) {
    log.error({ err }, 'Failed to delete occurrence');
    return json({ error: 'Failed to delete occurrence' }, { status: 502 });
  }
  return json({ ok: true });
};
