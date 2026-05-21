import type { Main as AtIdentification } from '$lib/lexicons/bio/lexicons/temp/v0-1/identification.defs.js';
import sql from './index.js';

export interface IdentificationRow {
  scientificName: string;
  vernacularName?: string;
  taxonRank?: string;
}

export async function getIdentificationsForOccurrences(
  occurrenceUris: string[],
): Promise<Map<string, { scientificName: string; vernacularName?: string }>> {
  if (occurrenceUris.length === 0) return new Map();
  const rows = await sql<
    { occurrence_uri: string; record: AtIdentification }[]
  >`
    SELECT occurrence_uri, record FROM identifications
    WHERE occurrence_uri = ANY(${sql.array(occurrenceUris)})
  `;
  const map = new Map<string, IdentificationRow>();
  for (const row of rows) {
    map.set(row.occurrence_uri, {
      scientificName: row.record.scientificName,
      vernacularName: row.record.vernacularName,
      taxonRank: row.record.taxonRank,
    });
  }
  return map;
}

export async function insertIdentification(
  did: string,
  rkey: string,
  record: AtIdentification,
  atUri: string,
): Promise<void> {
  await sql`
    INSERT INTO identifications (at_uri, did, rkey, occurrence_uri, record, indexed_at)
    VALUES (
      ${atUri},
      ${did},
      ${rkey},
      ${record.occurrence.uri},
      ${sql.json(record as Parameters<typeof sql.json>[0])},
      now()
    )
    ON CONFLICT (at_uri) DO UPDATE SET
      record = EXCLUDED.record
  `;
}
