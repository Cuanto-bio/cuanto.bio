import type { Main as AtOccurrence } from '$lib/lexicons/bio/lexicons/temp/v0-1/occurrence.defs.js';
import sql from './index.js';

export interface OccurrenceRow {
  at_uri: string;
  did: string;
  rkey: string;
  record: AtOccurrence;
}

export async function getOccurrenceByRkeyAndDid(
  rkey: string,
  did: string,
): Promise<OccurrenceRow | null> {
  const [row] = await sql<OccurrenceRow[]>`
    SELECT at_uri, did, rkey, record
    FROM occurrences
    WHERE rkey = ${rkey} AND did = ${did}
    LIMIT 1
  `;
  return row ?? null;
}

export async function updateOccurrenceRecord(
  atUri: string,
  record: AtOccurrence,
): Promise<void> {
  await sql`
    UPDATE occurrences
    SET record = ${sql.json(record as Parameters<typeof sql.json>[0])}
    WHERE at_uri = ${atUri}
  `;
}

export async function deleteOccurrenceByUri(atUri: string): Promise<void> {
  await sql`DELETE FROM occurrences WHERE at_uri = ${atUri}`;
}
