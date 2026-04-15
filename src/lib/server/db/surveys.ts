import type { Main as Occurrence } from '$lib/lexicons/bio/lexicons/temp/occurrence.defs.js';
import type { Main as Survey } from '$lib/lexicons/bio/lexicons/temp/survey.defs.js';
import sql from './index.js';

export function parseCoords(
  lat?: string,
  lon?: string,
): { lat: number; lon: number } | null {
  if (!lat || !lon) return null;
  const latN = parseFloat(lat);
  const lonN = parseFloat(lon);
  if (!Number.isFinite(latN) || !Number.isFinite(lonN)) return null;
  return { lat: latN, lon: lonN };
}

export async function insertSurvey(
  did: string,
  rkey: string,
  record: Survey,
  atUri: string,
): Promise<void> {
  const eventDate = (() => {
    if (!record.eventDate) return null;
    const d = new Date(record.eventDate);
    return Number.isNaN(d.getTime()) ? null : d;
  })();

  await sql`
    INSERT INTO surveys (
      at_uri, did, rkey, protocol_uri, protocol_cid,
      event_date, event_duration_value, event_duration_unit,
      location, created_at
    )
    VALUES (
      ${atUri},
      ${did},
      ${rkey},
      ${record.protocol.uri},
      ${record.protocol.cid},
      ${eventDate},
      ${record.eventDurationValue ?? null},
      ${record.eventDurationUnit ?? null},
      ${sql.json(record.location as Parameters<typeof sql.json>[0])},
      ${record.createdAt}
    )
    ON CONFLICT (at_uri) DO NOTHING
  `;
}

export async function insertOccurrence(
  did: string,
  rkey: string,
  record: Occurrence,
  atUri: string,
): Promise<void> {
  const surveyUri = record.eventID ?? null;
  if (!surveyUri) return;

  const coords = parseCoords(record.decimalLatitude, record.decimalLongitude);
  const geomExpr = coords
    ? sql`ST_SetSRID(ST_MakePoint(${coords.lon}, ${coords.lat}), 4326)`
    : sql`NULL`;

  await sql`
    INSERT INTO occurrences (
      at_uri, did, rkey, survey_uri, survey_target_uri,
      taxon_id, organism_quantity, organism_quantity_type, geom
    )
    VALUES (
      ${atUri},
      ${did},
      ${rkey},
      ${surveyUri},
      ${record.surveyTargetID ?? null},
      ${record.taxonID ?? null},
      ${record.organismQuantity ?? null},
      ${record.organismQuantityType ?? null},
      ${geomExpr}
    )
    ON CONFLICT (at_uri) DO NOTHING
  `;
}
