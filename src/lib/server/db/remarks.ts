import type { Main as AtRemark } from '$lib/lexicons/bio/lexicons/temp/v0-1/remark.defs.js';
import sql from './index.js';

export interface RemarkRow {
  atUri: string;
  body: string;
  license?: string;
}

function toRemarkRow(row: { at_uri: string; record: AtRemark }): RemarkRow {
  return {
    atUri: row.at_uri,
    body: row.record.body,
    license: row.record.license,
  };
}

/**
 * Looks a remark up by its own AT-URI, which is how the record that describes
 * it points at it (e.g. survey.eventRemarksID). The lexicon treats that forward
 * reference as authoritative, so this is the only lookup the read path needs:
 * a remark whose subject names a record that does not point back at it fills no
 * term and must not be displayed.
 */
export async function getRemarkByUri(atUri: string): Promise<RemarkRow | null> {
  const [row] = await sql<{ at_uri: string; record: AtRemark }[]>`
    SELECT at_uri, record FROM remarks WHERE at_uri = ${atUri}
  `;
  return row ? toRemarkRow(row) : null;
}

/** The same lookup for many remarks at once, keyed by AT-URI. */
export async function getRemarksByUris(
  atUris: string[],
): Promise<Map<string, RemarkRow>> {
  if (atUris.length === 0) return new Map();
  const rows = await sql<{ at_uri: string; record: AtRemark }[]>`
    SELECT at_uri, record FROM remarks WHERE at_uri = ANY(${atUris})
  `;
  return new Map(rows.map((row) => [row.at_uri, toRemarkRow(row)]));
}

export async function insertRemark(
  did: string,
  rkey: string,
  record: AtRemark,
  atUri: string,
): Promise<void> {
  await sql`
    INSERT INTO remarks (at_uri, did, rkey, subject_uri, dwc_term, record, indexed_at)
    VALUES (
      ${atUri},
      ${did},
      ${rkey},
      ${record.subject},
      ${record.dwcTerm},
      ${sql.json(record as Parameters<typeof sql.json>[0])},
      now()
    )
    ON CONFLICT (at_uri) DO UPDATE SET
      subject_uri = EXCLUDED.subject_uri,
      dwc_term = EXCLUDED.dwc_term,
      record = EXCLUDED.record
  `;
}

// Hard delete, like occurrences and identifications: nothing references a
// remark row, and the record it described keeps its own tombstoning rules.
export async function deleteRemarkByAtUri(atUri: string): Promise<void> {
  await sql`DELETE FROM remarks WHERE at_uri = ${atUri}`;
}
