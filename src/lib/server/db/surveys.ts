import type { Main as AtOccurrence } from '$lib/lexicons/bio/lexicons/temp/occurrence.defs.js';
import type { Main as AtSurvey } from '$lib/lexicons/bio/lexicons/temp/survey.defs.js';
import type { Survey } from '$lib/offline/db';
import sql from './index.js';

export interface SurveyListRow {
  at_uri: string;
  rkey: string;
  event_date: string | null;
  event_duration_value: number | null;
  event_duration_unit: string | null;
  location_name: string;
  protocol_title: string;
  protocol_rkey: string;
  protocol_handle: string;
  protocol_uri: string;
  handle: string;
}

export interface OccurrenceListRow {
  survey_uri: string;
  at_uri: string;
  organism_quantity: string | null;
  survey_target_uri: string | null;
}

export async function getSurveysByDid(
  did: string,
  limit?: number,
): Promise<SurveyListRow[]> {
  return sql<SurveyListRow[]>`
    SELECT
      s.at_uri,
      s.rkey,
      s.event_date,
      s.event_duration_value,
      s.event_duration_unit,
      s.location->>'name' AS location_name,
      s.protocol_uri,
      sp.title AS protocol_title,
      sp.rkey AS protocol_rkey,
      pu.handle AS protocol_handle,
      u.handle
    FROM surveys s
    JOIN survey_protocols sp ON sp.at_uri = s.protocol_uri
    JOIN users pu ON pu.did = sp.did
    JOIN users u ON u.did = s.did
    WHERE s.did = ${did}
    ORDER BY s.event_date DESC NULLS LAST, s.indexed_at DESC
    ${limit != null ? sql`LIMIT ${limit}` : sql``}
  `;
}

export async function getSurveyByDidAndRkey(did: string, rkey: string) {
  const [row] = await sql<SurveyListRow[]>`
    SELECT
      s.at_uri,
      s.rkey,
      s.event_date,
      s.event_duration_value,
      s.event_duration_unit,
      s.location->>'name' AS location_name,
      s.protocol_uri,
      sp.title AS protocol_title,
      sp.rkey AS protocol_rkey,
      pu.handle AS protocol_handle,
      u.handle
    FROM surveys s
    JOIN survey_protocols sp ON sp.at_uri = s.protocol_uri
    JOIN users pu ON pu.did = sp.did
    JOIN users u ON u.did = s.did
    WHERE s.did = ${did} AND s.rkey = ${rkey}
    LIMIT 1
  `;
  return row ?? null;
}

export async function getOccurrencesForSurveys(
  surveyUris: string[],
): Promise<OccurrenceListRow[]> {
  if (surveyUris.length === 0) return [];
  return sql<OccurrenceListRow[]>`
    SELECT
      o.survey_uri,
      o.at_uri,
      o.organism_quantity,
      o.survey_target_uri
    FROM occurrences o
    WHERE o.survey_uri = ANY(${sql.array(surveyUris)})
  `;
}

export function groupOccurrencesBySurvey(
  occurrences: OccurrenceListRow[],
): Map<string, Survey['occurrences']> {
  const map = new Map<string, Survey['occurrences']>();
  for (const o of occurrences) {
    const list = map.get(o.survey_uri) ?? [];
    list.push({
      atUri: o.at_uri,
      organismQuantity: o.organism_quantity,
      surveyTargetUri: o.survey_target_uri,
    });
    map.set(o.survey_uri, list);
  }
  return map;
}

export function toSurveyResponse(
  surveys: SurveyListRow[],
  occurrencesBySurvey: Map<string, Survey['occurrences']>,
): Survey[] {
  return surveys.map((s) => ({
    atUri: s.at_uri,
    rkey: s.rkey,
    eventDate: s.event_date,
    eventDurationValue: s.event_duration_value,
    eventDurationUnit: s.event_duration_unit,
    locationName: s.location_name,
    protocolTitle: s.protocol_title,
    protocolRkey: s.protocol_rkey,
    protocolHandle: s.protocol_handle,
    protocolUri: s.protocol_uri,
    handle: s.handle,
    occurrences: occurrencesBySurvey.get(s.at_uri) ?? [],
  }));
}

export async function getSurveyDetailByHandleAndRkey(
  handle: string,
  rkey: string,
): Promise<Survey | null> {
  const [user] = await sql<{ did: string }[]>`
    SELECT did FROM users WHERE handle = ${handle.toLowerCase()}
  `;
  if (!user) return null;
  const survey = await getSurveyByDidAndRkey(user.did, rkey);
  if (!survey) return null;
  const occurrences = await getOccurrencesForSurveys([survey.at_uri]);
  return toSurveyResponse([survey], groupOccurrencesBySurvey(occurrences))[0];
}

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
  record: AtSurvey,
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
    ON CONFLICT (at_uri) DO UPDATE SET
      protocol_uri = EXCLUDED.protocol_uri,
      protocol_cid = EXCLUDED.protocol_cid,
      event_date = EXCLUDED.event_date,
      event_duration_value = EXCLUDED.event_duration_value,
      event_duration_unit = EXCLUDED.event_duration_unit,
      location = EXCLUDED.location,
      created_at = EXCLUDED.created_at
  `;
}

export async function insertOccurrence(
  did: string,
  rkey: string,
  record: AtOccurrence,
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
    ON CONFLICT (at_uri) DO UPDATE SET
      survey_uri = EXCLUDED.survey_uri,
      survey_target_uri = EXCLUDED.survey_target_uri,
      taxon_id = EXCLUDED.taxon_id,
      organism_quantity = EXCLUDED.organism_quantity,
      organism_quantity_type = EXCLUDED.organism_quantity_type,
      geom = EXCLUDED.geom
  `;
}
