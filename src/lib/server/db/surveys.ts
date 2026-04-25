import type { Main as AtOccurrence } from '$lib/lexicons/bio/lexicons/temp/occurrence.defs.js';
import type { Main as AtSurvey } from '$lib/lexicons/bio/lexicons/temp/survey.defs.js';
import type { Occurrence, Survey } from '$lib/offline/db';
import sql from './index.js';

interface SurveyRow {
  at_uri: string;
  rkey: string;
  handle: string;
  protocol_handle: string;
  protocol_rkey: string;
  protocol_title: string;
  record: AtSurvey;
}

interface OccurrenceRow {
  at_uri: string;
  survey_uri: string;
  record: AtOccurrence;
}

const surveysFromJoin = sql`
  SELECT
    s.at_uri,
    s.rkey,
    u.handle,
    pu.handle           AS protocol_handle,
    sp.rkey             AS protocol_rkey,
    sp.record->>'title' AS protocol_title,
    s.record
  FROM surveys s
  JOIN survey_protocols sp ON sp.at_uri = s.protocol_uri
  JOIN users pu ON pu.did = sp.did
  JOIN users u  ON u.did  = s.did
`;

export async function getSurveysByDid(
  did: string,
  limit?: number,
): Promise<SurveyRow[]> {
  return sql<SurveyRow[]>`
    ${surveysFromJoin}
    WHERE s.did = ${did}
    ORDER BY s.event_date DESC NULLS LAST, s.indexed_at DESC
    ${limit != null ? sql`LIMIT ${limit}` : sql``}
  `;
}

async function getSurveyByDidAndRkey(
  did: string,
  rkey: string,
): Promise<SurveyRow | null> {
  const [row] = await sql<SurveyRow[]>`
    ${surveysFromJoin}
    WHERE s.did = ${did} AND s.rkey = ${rkey}
    LIMIT 1
  `;
  return row ?? null;
}

export async function getOccurrencesForSurveys(
  surveyUris: string[],
): Promise<OccurrenceRow[]> {
  if (surveyUris.length === 0) return [];
  return sql<OccurrenceRow[]>`
    SELECT at_uri, survey_uri, record
    FROM occurrences
    WHERE survey_uri = ANY(${sql.array(surveyUris)})
  `;
}

export function groupOccurrencesBySurvey(
  occurrences: OccurrenceRow[],
): Map<string, Occurrence[]> {
  const map = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const list = map.get(o.survey_uri) ?? [];
    list.push({ atUri: o.at_uri, record: o.record });
    map.set(o.survey_uri, list);
  }
  return map;
}

export function toSurveyResponse(
  surveys: SurveyRow[],
  occurrencesBySurvey: Map<string, Occurrence[]>,
): Survey[] {
  return surveys.map((s) => ({
    atUri: s.at_uri,
    rkey: s.rkey,
    handle: s.handle,
    protocolHandle: s.protocol_handle,
    protocolRkey: s.protocol_rkey,
    protocolTitle: s.protocol_title,
    record: s.record,
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

  // event_date is stored separately for ORDER BY; record contains the full lexicon record.
  await sql`
    INSERT INTO surveys (at_uri, did, rkey, protocol_uri, event_date, record, indexed_at)
    VALUES (
      ${atUri},
      ${did},
      ${rkey},
      ${record.protocol.uri},
      ${eventDate},
      ${sql.json(record as Parameters<typeof sql.json>[0])},
      now()
    )
    ON CONFLICT (at_uri) DO UPDATE SET
      protocol_uri = EXCLUDED.protocol_uri,
      event_date = EXCLUDED.event_date,
      record = EXCLUDED.record
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
    INSERT INTO occurrences (at_uri, did, rkey, survey_uri, record, geom, indexed_at)
    VALUES (
      ${atUri},
      ${did},
      ${rkey},
      ${surveyUri},
      ${sql.json(record as Parameters<typeof sql.json>[0])},
      ${geomExpr},
      now()
    )
    ON CONFLICT (at_uri) DO UPDATE SET
      survey_uri = EXCLUDED.survey_uri,
      record = EXCLUDED.record,
      geom = EXCLUDED.geom
  `;
}
