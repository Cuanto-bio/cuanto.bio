import type { Main as AtProtocolTarget } from '$lib/lexicons/bio/cuanto/protocolTarget.defs.js';
import type { Main as AtSurvey } from '$lib/lexicons/bio/cuanto/survey.defs.js';
import type { Main as AtOccurrence } from '$lib/lexicons/bio/lexicons/temp/v0-1/occurrence.defs.js';
import type { Occurrence, Survey } from '$lib/offline/db';
import { getIdentificationsForOccurrences } from './identifications.js';
import sql from './index.js';

interface SurveyRow {
  at_uri: string;
  did: string;
  rkey: string;
  handle: string;
  avatar_url: string | null;
  protocol_handle: string;
  protocol_rkey: string;
  protocol_title: string;
  record: AtSurvey;
}

interface OccurrenceRowForSurvey {
  at_uri: string;
  survey_uri: string;
  record: AtOccurrence;
}

interface ProtocolTargetRow {
  at_uri: string;
  record: AtProtocolTarget;
}

const surveysFromJoin = sql`
  SELECT
    s.at_uri,
    s.did,
    s.rkey,
    u.handle,
    u.avatar_url,
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
    ORDER BY s.created_at DESC NULLS LAST
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
): Promise<OccurrenceRowForSurvey[]> {
  if (surveyUris.length === 0) return [];
  return sql<OccurrenceRowForSurvey[]>`
    SELECT at_uri, survey_uri, record
    FROM occurrences
    WHERE survey_uri = ANY(${sql.array(surveyUris)})
  `;
}

export interface LastSurveyRow {
  target_uri: string;
  survey_date: Date;
  survey_handle: string;
  survey_rkey: string;
}

export type LastSurveyByTargetUri = Record<
  string,
  { date: string; handle: string; rkey: string }
>;

// Most recent survey (across all users) with an occurrence linked to each
// target. Display and ordering both use COALESCE(event_date, created_at) so
// they can never diverge.
export async function getLastSurveyByTargetUris(
  targetUris: string[],
): Promise<LastSurveyRow[]> {
  if (targetUris.length === 0) return [];
  return sql<LastSurveyRow[]>`
    SELECT DISTINCT ON (o.record->>'surveyTargetID')
      o.record->>'surveyTargetID'          AS target_uri,
      COALESCE(s.event_date, s.created_at) AS survey_date,
      u.handle                             AS survey_handle,
      s.rkey                               AS survey_rkey
    FROM occurrences o
    JOIN surveys s ON s.at_uri = o.survey_uri
    JOIN users u   ON u.did    = s.did
    WHERE o.record->>'surveyTargetID' = ANY(${sql.array(targetUris)})
    ORDER BY
      o.record->>'surveyTargetID',
      COALESCE(s.event_date, s.created_at) DESC NULLS LAST
  `;
}

export function toLastSurveyMap(rows: LastSurveyRow[]): LastSurveyByTargetUri {
  const map: LastSurveyByTargetUri = {};
  for (const r of rows) {
    map[r.target_uri] = {
      date: r.survey_date.toISOString(),
      handle: r.survey_handle,
      rkey: r.survey_rkey,
    };
  }
  return map;
}

export function groupOccurrencesBySurvey(
  occurrences: (OccurrenceRowForSurvey & {
    identification?: Occurrence['identification'];
  })[],
): Map<string, Occurrence[]> {
  const map = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const list = map.get(o.survey_uri) ?? [];
    list.push({
      atUri: o.at_uri,
      record: o.record,
      identification: o.identification,
    });
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
    did: s.did,
    rkey: s.rkey,
    handle: s.handle,
    avatarUrl: s.avatar_url ?? undefined,
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
  const incidentalUris = occurrences
    .filter((o) => !o.record.surveyTargetID)
    .map((o) => o.at_uri);
  const identsByOccurrence =
    await getIdentificationsForOccurrences(incidentalUris);
  const occurrencesWithIdents = occurrences.map((o) => ({
    ...o,
    identification: identsByOccurrence.get(o.at_uri),
  }));
  return toSurveyResponse(
    [survey],
    groupOccurrencesBySurvey(occurrencesWithIdents),
  )[0];
}

export async function getSurveysPage(limit: number = 100, offset: number = 0) {
  const surveyRows = await sql<SurveyRow[]>`
    SELECT
      s.at_uri,
      s.did,
      s.rkey,
      u.handle,
      u.avatar_url,
      spu.handle                              AS protocol_handle,
      sp.rkey                                 AS protocol_rkey,
      sp.record->>'title'                     AS protocol_title,
      s.record
    FROM surveys s
    JOIN survey_protocols sp ON sp.at_uri = s.protocol_uri
    JOIN users u ON u.did = s.did
    JOIN users spu ON spu.did = sp.did
    ORDER BY s.created_at DESC NULLS LAST
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  const occurrences = await getOccurrencesForSurveys(
    surveyRows.map((s) => s.at_uri),
  );
  return toSurveyResponse(surveyRows, groupOccurrencesBySurvey(occurrences));
}

export async function getSurveysPageByDid(
  did: string,
  limit: number = 100,
  offset: number = 0,
) {
  const surveyRows = await sql<SurveyRow[]>`
    SELECT
      s.at_uri,
      s.did,
      s.rkey,
      u.handle,
      u.avatar_url,
      spu.handle                              AS protocol_handle,
      sp.rkey                                 AS protocol_rkey,
      sp.record->>'title'                     AS protocol_title,
      s.record
    FROM surveys s
    JOIN survey_protocols sp ON sp.at_uri = s.protocol_uri
    JOIN users u ON u.did = s.did
    JOIN users spu ON spu.did = sp.did
    WHERE s.did = ${did}
    ORDER BY s.event_date DESC NULLS LAST, s.indexed_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  const occurrences = await getOccurrencesForSurveys(
    surveyRows.map((s) => s.at_uri),
  );
  return toSurveyResponse(surveyRows, groupOccurrencesBySurvey(occurrences));
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

  // event_date and created_at are stored separately for ORDER BY; record contains the full lexicon record.
  await sql`
    INSERT INTO surveys (at_uri, did, rkey, protocol_uri, event_date, created_at, record, indexed_at)
    VALUES (
      ${atUri},
      ${did},
      ${rkey},
      ${record.protocol.uri},
      ${eventDate},
      ${new Date(record.createdAt)},
      ${sql.json(record as Parameters<typeof sql.json>[0])},
      now()
    )
    ON CONFLICT (at_uri) DO UPDATE SET
      protocol_uri = EXCLUDED.protocol_uri,
      event_date = EXCLUDED.event_date,
      created_at = EXCLUDED.created_at,
      record = EXCLUDED.record
  `;
}

export interface SurveyExportRow {
  at_uri: string;
  did: string;
  handle: string;
  record: AtSurvey;
  protocol_title: string;
}

export interface OccurrenceExportRow {
  occurrence_at_uri: string | null;
  survey_at_uri: string;
  survey_target_at_uri: string | null;
  occurrence_did: string | null;
  survey_did: string;
  occurrence_record: AtOccurrence | null;
  scientific_name: string | null;
  taxon_rank: string | null;
  taxon_id: string | null;
  is_presence: boolean;
}

// Note: handle is captured at export time. ATProto handles are mutable — a
// user who changes their handle after a survey is exported will appear under
// the old handle in that export.
export function streamSurveysByProtocolUri(protocolUri: string) {
  return sql<SurveyExportRow[]>`
    SELECT
      s.at_uri,
      s.did,
      u.handle,
      s.record,
      sp.record->>'title' AS protocol_title
    FROM surveys s
    JOIN survey_protocols sp ON sp.at_uri = s.protocol_uri
    JOIN users u ON u.did = s.did
    WHERE s.protocol_uri = ${protocolUri}
    ORDER BY s.event_date ASC NULLS LAST, s.indexed_at ASC
  `.cursor(50);
}

export interface SurveyTargetExportRow {
  survey_at_uri: string;
  survey_target_at_uri: string;
  scientific_name: string | null;
  taxon_id: string | null;
  verbatim_scope: string | null;
}

// One row per (survey × protocol target) pair, ordered by survey then target.
// This expansion is needed because DwC-DP's survey-target table links individual
// surveys to their targets — our targets are defined at the protocol level but
// apply to every survey under that protocol.
export function streamSurveyTargetsByProtocolUri(protocolUri: string) {
  return sql<SurveyTargetExportRow[]>`
    SELECT
      s.at_uri                                    AS survey_at_uri,
      st.at_uri                                   AS survey_target_at_uri,
      st.record->'scope'->0->>'scientificName'       AS scientific_name,
      st.record->'scope'->0->>'taxonID'              AS taxon_id,
      st.record->'scope'->0->>'verbatimTargetScope'  AS verbatim_scope
    FROM surveys s
    JOIN protocol_targets st ON st.protocol_uri = s.protocol_uri
    WHERE s.protocol_uri = ${protocolUri}
    ORDER BY s.at_uri, st.at_uri
  `.cursor(100);
}

// Presence rows for occurrences explicitly linked to a survey target.
export function streamTargetedOccurrencesByProtocolUri(protocolUri: string) {
  return sql<OccurrenceExportRow[]>`
    SELECT
      o.at_uri           AS occurrence_at_uri,
      s.at_uri           AS survey_at_uri,
      st.at_uri          AS survey_target_at_uri,
      o.did              AS occurrence_did,
      s.did              AS survey_did,
      o.record           AS occurrence_record,
      COALESCE(
        i.record->>'scientificName',
        st.record->'scope'->0->>'scientificName'
      )                  AS scientific_name,
      COALESCE(
        i.record->>'taxonRank',
        st.record->'scope'->0->>'taxonRank'
      )                  AS taxon_rank,
      COALESCE(
        i.record->>'taxonID',
        o.record->>'taxonID',
        st.record->'scope'->0->>'taxonID'
      )                  AS taxon_id,
      true               AS is_presence
    FROM surveys s
    JOIN protocol_targets st ON st.protocol_uri = s.protocol_uri
    JOIN occurrences o
      ON o.survey_uri = s.at_uri
      AND o.record->>'surveyTargetID' = st.at_uri
    LEFT JOIN identifications i
      ON i.occurrence_uri = o.at_uri
      AND i.at_uri = o.record->'acceptedIdentificationID'->>'uri'
    WHERE s.protocol_uri = ${protocolUri}
    ORDER BY s.at_uri, o.at_uri
  `.cursor(100);
}

// Synthesized absence rows: one per (survey × target) pair where no occurrence was recorded.
export function streamAbsencesByProtocolUri(protocolUri: string) {
  return sql<OccurrenceExportRow[]>`
    SELECT
      NULL               AS occurrence_at_uri,
      s.at_uri           AS survey_at_uri,
      st.at_uri          AS survey_target_at_uri,
      NULL               AS occurrence_did,
      s.did              AS survey_did,
      NULL               AS occurrence_record,
      st.record->'scope'->0->>'scientificName' AS scientific_name,
      st.record->'scope'->0->>'taxonRank'      AS taxon_rank,
      st.record->'scope'->0->>'taxonID'        AS taxon_id,
      false              AS is_presence
    FROM surveys s
    JOIN protocol_targets st ON st.protocol_uri = s.protocol_uri
    LEFT JOIN occurrences o
      ON o.survey_uri = s.at_uri
      AND o.record->>'surveyTargetID' = st.at_uri
    WHERE s.protocol_uri = ${protocolUri}
      AND o.at_uri IS NULL
    ORDER BY s.at_uri, st.at_uri
  `.cursor(100);
}

// Incidental occurrences: linked to a survey in this protocol but without a surveyTargetID.
// survey_target_at_uri is NULL for these rows.
export function streamIncidentalOccurrencesByProtocolUri(protocolUri: string) {
  return sql<OccurrenceExportRow[]>`
    SELECT
      o.at_uri           AS occurrence_at_uri,
      s.at_uri           AS survey_at_uri,
      NULL               AS survey_target_at_uri,
      o.did              AS occurrence_did,
      s.did              AS survey_did,
      o.record           AS occurrence_record,
      COALESCE(
        i.record->>'scientificName',
        o.record->>'scientificName'
      )                  AS scientific_name,
      COALESCE(
        i.record->>'taxonRank',
        o.record->>'taxonRank'
      )                  AS taxon_rank,
      COALESCE(
        i.record->>'taxonID',
        o.record->>'taxonID'
      )                  AS taxon_id,
      true               AS is_presence
    FROM surveys s
    JOIN occurrences o
      ON o.survey_uri = s.at_uri
      AND (o.record->>'surveyTargetID' IS NULL OR o.record->>'surveyTargetID' = '')
    LEFT JOIN identifications i
      ON i.occurrence_uri = o.at_uri
      AND i.at_uri = o.record->'acceptedIdentificationID'->>'uri'
    WHERE s.protocol_uri = ${protocolUri}
    ORDER BY s.at_uri, o.at_uri
  `.cursor(100);
}

export async function getSurveyOwnerDid(atUri: string): Promise<string | null> {
  const [row] = await sql<{ did: string }[]>`
    SELECT did FROM surveys WHERE at_uri = ${atUri}
  `;
  return row?.did ?? null;
}

export async function deleteSurveyByAtUri(atUri: string): Promise<void> {
  await sql`DELETE FROM surveys WHERE at_uri = ${atUri}`;
}

export async function deleteOccurrencesBySurveyUri(
  surveyUri: string,
): Promise<{ at_uri: string }[]> {
  return sql<{ at_uri: string }[]>`
    DELETE FROM occurrences WHERE survey_uri = ${surveyUri} RETURNING at_uri
  `;
}

export async function deleteOccurrenceByAtUri(atUri: string): Promise<void> {
  await sql`DELETE FROM occurrences WHERE at_uri = ${atUri}`;
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

export async function getProtocolTargetsByUri(uris: string[]) {
  return sql<ProtocolTargetRow[]>`
    SELECT at_uri, record FROM protocol_targets WHERE at_uri = ANY(${sql.array(uris)})
  `;
}
